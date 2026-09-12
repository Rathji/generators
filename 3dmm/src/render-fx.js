/* Realism post-processing — the viewport's grade + lens + bloom chain.
 *
 * The scene is rendered once into an offscreen target, then a fixed chain of full-screen shader
 * passes produces the final image blitted to the canvas. Because the live viewport, the PNG export
 * and the Studio snapshot all funnel through `render()`, they always show the same graded frame.
 *
 * Colour handling follows the same trick the reference node compositor uses: the scene target is
 * flagged `isXRRenderTarget` with a plain RGBA8 internal format, which makes three apply the
 * renderer's tone mapping and output (sRGB) encoding when rendering into it, and nothing when we
 * sample it back. So every pass below works on the same display-referred bytes the screen would
 * have shown, an empty chain is pixel-identical to an un-post-processed viewport, and no pass can
 * accidentally encode twice.
 *
 * `FX_PARAMS` is the full parameter set. Effects whose strength is 0 compile to a skipped pass, so
 * the cost tracks what is actually switched on. `LOOK_PRESETS` bundle a full look (environment +
 * light rig + fx) for one-click realism.
 */

import { THREE } from "./three.js";

const { WebGLRenderTarget, Scene, OrthographicCamera, Mesh, PlaneGeometry, ShaderMaterial,
  Vector2, RGBAFormat, LinearFilter, SRGBColorSpace, NoColorSpace, NoBlending } = THREE;

const VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = {
  grade: /* glsl */`
    uniform sampler2D tA;
    uniform float uExposure, uContrast, uSaturation, uTemperature, uTint, uLift, uGamma, uGain;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tA, vUv);
      vec3 col = c.rgb * uExposure;
      // white balance: warm pushes red, pulls blue; tint pushes green
      col.r *= 1.0 + uTemperature * 0.35;
      col.b *= 1.0 - uTemperature * 0.35;
      col.g *= 1.0 + uTint * 0.35;
      // lift / gamma / gain (as in a colour-balance node)
      col = max(col * uGain + uLift, 0.0);
      col = pow(col, vec3(1.0 / max(uGamma, 0.01)));
      // contrast about mid grey, then saturation
      col = (col - 0.5) * (1.0 + uContrast) + 0.5;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
  bright: /* glsl */`
    uniform sampler2D tA;
    uniform float uThreshold;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tA, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      float k = max(l - uThreshold, 0.0) / max(1.0 - uThreshold, 1e-3);
      gl_FragColor = vec4(c.rgb * k, 1.0);
    }`,
  blur: /* glsl */`
    uniform sampler2D tA;
    uniform vec2 uTexel, uDir;
    uniform float uRadius;
    varying vec2 vUv;
    void main(){
      vec2 off = uTexel * uDir * uRadius;
      vec4 s = texture2D(tA, vUv) * 0.2270270270;
      s += (texture2D(tA, vUv + off * 1.3846153846) + texture2D(tA, vUv - off * 1.3846153846)) * 0.3162162162;
      s += (texture2D(tA, vUv + off * 3.2307692308) + texture2D(tA, vUv - off * 3.2307692308)) * 0.0702702703;
      gl_FragColor = s;
    }`,
  add: /* glsl */`
    uniform sampler2D tA, tB;
    uniform float uIntensity;
    varying vec2 vUv;
    void main(){
      vec4 a = texture2D(tA, vUv);
      gl_FragColor = vec4(a.rgb + texture2D(tB, vUv).rgb * uIntensity, a.a);
    }`,
  unsharp: /* glsl */`
    uniform sampler2D tA, tB;
    uniform float uAmount;
    varying vec2 vUv;
    void main(){
      vec4 a = texture2D(tA, vUv);
      vec4 b = texture2D(tB, vUv);
      gl_FragColor = vec4(clamp(a.rgb + (a.rgb - b.rgb) * uAmount, 0.0, 1.0), a.a);
    }`,
  lens: /* glsl */`
    uniform sampler2D tA;
    uniform float uAmount, uCA;
    varying vec2 vUv;
    void main(){
      vec2 cc = vUv - 0.5;
      float r2 = dot(cc, cc);
      vec2 uv = 0.5 + cc * (1.0 + uAmount * r2);
      vec2 dir = cc / max(length(cc), 1e-4);
      float ca = uCA * r2 * 0.03;
      vec3 col;
      col.r = texture2D(tA, uv + dir * ca).r;
      col.g = texture2D(tA, uv).g;
      col.b = texture2D(tA, uv - dir * ca).b;
      gl_FragColor = vec4(col, 1.0);
    }`,
  vignette: /* glsl */`
    uniform sampler2D tA;
    uniform float uAmount, uSoftness;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tA, vUv);
      float d = clamp(length(vUv - 0.5) * 1.41421356, 0.0, 1.0);
      float vig = 1.0 - uAmount * pow(d, 1.0 + (1.0 - uSoftness) * 4.0);
      gl_FragColor = vec4(clamp(c.rgb * vig, 0.0, 1.0), c.a);
    }`,
  grain: /* glsl */`
    uniform sampler2D tA;
    uniform float uAmount, uSize, uTime;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tA, vUv);
      float n = hash(vUv * uSize + uTime) - 0.5;
      gl_FragColor = vec4(clamp(c.rgb + n * uAmount, 0.0, 1.0), c.a);
    }`,
  passthrough: /* glsl */`
    uniform sampler2D tA;
    varying vec2 vUv;
    float dhash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tA, vUv);
      // ±1/2 LSB of ordered-per-pixel noise: kills the banding visible in smooth dark gradients
      // (a dark studio backdrop is exactly where an 8-bit target stair-steps) at no visible cost.
      float d = (dhash(vUv * 4096.0) - 0.5) / 255.0;
      gl_FragColor = vec4(c.rgb + d, c.a);
    }`,
};

export const FX_PARAMS = {
  enabled: false,
  exposure: 1.0,
  contrast: 0.0,
  saturation: 1.0,
  temperature: 0.0,
  tint: 0.0,
  lift: 0.0,
  gamma: 1.0,
  gain: 1.0,
  bloom: 0.0,
  bloomThreshold: 0.85,
  bloomRadius: 10,
  ca: 0.0,
  distort: 0.0,
  sharpen: 0.0,
  vignette: 0.0,
  vignetteSoft: 0.5,
  grain: 0.0,
  grainSize: 400,
};

export const FX_PRESETS = {
  neutral: {},
  cinematic: { enabled: true, contrast: 0.14, saturation: 1.06, temperature: 0.03, bloom: 0.24, bloomThreshold: 0.72, ca: 0.14, vignette: 0.36, grain: 0.03, sharpen: 0.18 },
  product: { enabled: true, contrast: 0.06, saturation: 1.0, exposure: 1.04, bloom: 0.12, bloomThreshold: 0.9, vignette: 0.14, sharpen: 0.4 },
  dramatic: { enabled: true, contrast: 0.26, saturation: 0.92, temperature: -0.05, bloom: 0.36, bloomThreshold: 0.6, vignette: 0.62, grain: 0.05, sharpen: 0.2 },
  vintage: { enabled: true, contrast: 0.08, saturation: 0.82, temperature: 0.14, tint: 0.06, lift: 0.04, gamma: 0.97, vignette: 0.5, grain: 0.13, ca: 0.08 },
  clean: { enabled: true, exposure: 1.05, contrast: 0.04, saturation: 1.03, sharpen: 0.25 },
};

/* Every shader's uniform set, pre-declared. three captures `material.uniforms` when it compiles the
   program, so a pass must MUTATE these entries in place — replacing the whole uniforms object after
   the first frame silently freezes every later pass on the values it was born with. */
const UNIFORMS = {
  grade: { tA: null, uExposure: 1, uContrast: 0, uSaturation: 1, uTemperature: 0, uTint: 0, uLift: 0, uGamma: 1, uGain: 1 },
  bright: { tA: null, uThreshold: 0.85 },
  blur: { tA: null, uTexel: null, uDir: null, uRadius: 6 },
  add: { tA: null, tB: null, uIntensity: 1 },
  unsharp: { tA: null, tB: null, uAmount: 0 },
  lens: { tA: null, uAmount: 0, uCA: 0 },
  vignette: { tA: null, uAmount: 0, uSoftness: 0.5 },
  grain: { tA: null, uAmount: 0, uSize: 400, uTime: 0 },
  passthrough: { tA: null },
};

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.params = { ...FX_PARAMS };
    this._size = new Vector2(1, 1);
    this._quadScene = new Scene();
    this._quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._quad = new Mesh(new PlaneGeometry(2, 2));
    this._quad.frustumCulled = false;
    this._quadScene.add(this._quad);
    this._mats = new Map();
    this._rt = new Map();
    this._time = 0;
  }

  get enabled() {
    return !!this.params.enabled;
  }

  setEnabled(v) {
    this.params.enabled = !!v;
    return this.params.enabled;
  }

  set(patch) {
    Object.assign(this.params, patch);
    return this.params;
  }

  applyPreset(id) {
    const p = FX_PRESETS[id];
    if (!p) return this.params;
    Object.assign(this.params, { ...FX_PARAMS }, p);
    return this.params;
  }

  _material(name) {
    let m = this._mats.get(name);
    if (m) return m;
    const uniforms = {};
    for (const k in UNIFORMS[name]) uniforms[k] = { value: UNIFORMS[name][k] };
    m = new ShaderMaterial({
      uniforms, vertexShader: VERT, fragmentShader: FRAG[name],
      depthTest: false, depthWrite: false, transparent: false, blending: NoBlending,
    });
    this._mats.set(name, m);
    return m;
  }

  _makeRT(depth, display) {
    const rt = new WebGLRenderTarget(Math.max(1, this._size.x), Math.max(1, this._size.y), {
      minFilter: LinearFilter, magFilter: LinearFilter, format: RGBAFormat,
      depthBuffer: !!depth, stencilBuffer: false, samples: display ? 4 : 0,
    });
    rt.texture.generateMipmaps = false;
    rt.texture.colorSpace = display ? SRGBColorSpace : NoColorSpace;
    if (display) {
      rt.texture.internalFormat = "RGBA8";
      rt.isXRRenderTarget = true;
    }
    rt.__depth = !!depth;
    rt.__display = !!display;
    return rt;
  }

  _getRT(key, depth, display) {
    let rt = this._rt.get(key);
    const w = Math.max(1, this._size.x);
    const h = Math.max(1, this._size.y);
    if (!rt) {
      rt = this._makeRT(depth, display);
      this._rt.set(key, rt);
      return rt;
    }
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    if (rt.__depth !== !!depth || rt.__display !== !!display) {
      rt.dispose();
      rt = this._makeRT(depth, display);
      this._rt.set(key, rt);
    }
    return rt;
  }

  _pass(material, target, values) {
    if (values) {
      for (const k in values) {
        const u = material.uniforms[k];
        if (u) u.value = values[k];
      }
    }
    this._quad.material = material;
    this.renderer.setRenderTarget(target || null);
    this.renderer.clear(true, false, false);
    this.renderer.render(this._quadScene, this._quadCam);
  }

  _blur(srcTex, radius) {
    const mat = this._material("blur");
    const a = this._getRT("tmpA", false, false);
    const b = this._getRT("tmpB", false, false);
    const texel = new Vector2(1 / this._size.x, 1 / this._size.y);
    this._pass(mat, a, { tA: srcTex, uTexel: texel, uDir: new Vector2(1, 0), uRadius: radius });
    this._pass(mat, b, { tA: a.texture, uTexel: texel, uDir: new Vector2(0, 1), uRadius: radius });
    return b.texture;
  }

  render(scene, camera) {
    if (!this.enabled) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    this._size.set(size.x, size.y);
    const p = this.params;
    this._time += 0.017;

    const sceneRT = this._getRT("scene", true, true);
    this.renderer.setRenderTarget(sceneRT);
    this.renderer.clear(true, true, true);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);

    let tex = sceneRT.texture;

    // grade (always — exposure/contrast/sat default to a no-op but it is one cheap pass)
    this._pass(this._material("grade"), this._getRT("grade", false, false), {
      tA: tex,
      uExposure: p.exposure, uContrast: p.contrast, uSaturation: p.saturation,
      uTemperature: p.temperature, uTint: p.tint,
      uLift: p.lift, uGamma: p.gamma, uGain: p.gain,
    });
    tex = this._rt.get("grade").texture;

    if (p.bloom > 0.001) {
      this._pass(this._material("bright"), this._getRT("bright", false, false), { tA: tex, uThreshold: p.bloomThreshold });
      const glow = this._blur(this._rt.get("bright").texture, p.bloomRadius);
      this._pass(this._material("add"), this._getRT("bloom", false, false), { tA: tex, tB: glow, uIntensity: p.bloom });
      tex = this._rt.get("bloom").texture;
    }

    if (p.sharpen > 0.001) {
      const blurred = this._blur(tex, 1.0);
      this._pass(this._material("unsharp"), this._getRT("sharp", false, false), { tA: tex, tB: blurred, uAmount: p.sharpen });
      tex = this._rt.get("sharp").texture;
    }

    if (Math.abs(p.ca) > 0.001 || Math.abs(p.distort) > 0.001) {
      this._pass(this._material("lens"), this._getRT("lens", false, false), { tA: tex, uAmount: p.distort, uCA: p.ca });
      tex = this._rt.get("lens").texture;
    }

    if (p.vignette > 0.001) {
      this._pass(this._material("vignette"), this._getRT("vig", false, false), { tA: tex, uAmount: p.vignette, uSoftness: p.vignetteSoft });
      tex = this._rt.get("vig").texture;
    }

    if (p.grain > 0.001) {
      this._pass(this._material("grain"), this._getRT("grain", false, false), { tA: tex, uAmount: p.grain, uSize: p.grainSize, uTime: this._time });
      tex = this._rt.get("grain").texture;
    }

    // final blit to the canvas
    this._pass(this._material("passthrough"), null, { tA: tex });
  }

  dispose() {
    for (const m of this._mats.values()) m.dispose();
    for (const rt of this._rt.values()) rt.dispose();
    this._mats.clear();
    this._rt.clear();
    this._quad.geometry.dispose();
  }
}

/* Bundle a one-click look: which environment, which light rig and which post preset go together. */
export const LOOK_PRESETS = {
  studio: { label: "Studio", env: "studio", rig: "studio", showBackground: false, envIntensity: 1.0, fx: "clean", tone: "aces", shadow: 0.34 },
  cinematic: { label: "Cinematic", env: "studio", rig: "dramatic", showBackground: false, envIntensity: 0.8, fx: "cinematic", tone: "aces", shadow: 0.42 },
  product: { label: "Product", env: "soft", rig: "soft", showBackground: true, envIntensity: 1.15, fx: "product", tone: "linear", shadow: 0.22 },
  outdoor: { label: "Outdoor", env: "outdoor", rig: "outdoor", showBackground: true, envIntensity: 1.0, fx: "clean", tone: "aces", shadow: 0.3 },
  sunset: { label: "Sunset", env: "sunset", rig: "outdoor", showBackground: true, envIntensity: 0.95, fx: "cinematic", tone: "aces", shadow: 0.38 },
  night: { label: "Night", env: "night", rig: "night", showBackground: true, envIntensity: 0.85, fx: "cinematic", tone: "reinhard", shadow: 0.3 },
  dramatic: { label: "Dramatic", env: "neutral", rig: "dramatic", showBackground: false, envIntensity: 0.6, fx: "dramatic", tone: "cineon", shadow: 0.5 },
};
