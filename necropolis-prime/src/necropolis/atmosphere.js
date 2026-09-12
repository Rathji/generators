import * as THREE from "https://esm.sh/three@0.160.0";
import { makeGlowTexture, makeNoiseTexture } from "./lib.js";

export function buildAtmosphere(scene, rng, config){
  scene.fog = new THREE.FogExp2(0x4d6480, config.fogDensity);

  const glowTex = makeGlowTexture(256, "#eaf6ff");

  // ---- sky dome ----
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x060a16) },
      mid: { value: new THREE.Color(0x14243a) },
      bot: { value: new THREE.Color(0x3a4c66) },
      moonDir: { value: new THREE.Vector3(0.62, 0.66, 0.42).normalize() },
      moonColor: { value: new THREE.Color(0xcfe2f2) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 top, mid, bot, moonColor, moonDir;
      void main(){
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(bot, mid, smoothstep(0.0, 0.42, h));
        col = mix(col, top, smoothstep(0.4, 1.0, h));
        // warm-ish haze hugging the horizon
        float horizon = exp(-pow(max(vDir.y, 0.0) * 7.0, 1.4));
        col += vec3(0.10, 0.12, 0.16) * horizon;
        float m = max(dot(normalize(vDir), normalize(moonDir)), 0.0);
        col += moonColor * pow(m, 220.0) * 0.35;
        col += moonColor * pow(m, 14.0) * 0.10;
        col += moonColor * pow(m, 3.0) * 0.035;
        // faint nebular band
        float band = exp(-pow((vDir.y - 0.2) * 4.0, 2.0)) * (0.5 + 0.5 * sin(vDir.x * 4.0 + vDir.z * 3.0));
        col += vec3(0.05, 0.07, 0.12) * band * 0.3;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 16), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // ---- stars (uniform on the sphere, so no clustering near the horizon) ----
  const starCount = 1200;
  const sp = new Float32Array(starCount * 3);
  const sc = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++){
    const y = 1 - 2 * rng.next();
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = rng.next() * Math.PI * 2;
    const R = 1250;
    sp[i * 3] = Math.cos(th) * r * R;
    sp[i * 3 + 1] = y * R;
    sp[i * 3 + 2] = Math.sin(th) * r * R;
    const b = rng.float(0.25, 1.0);
    // fade stars out near the moon so the glow doesn't sit in a starfield
    const dir = new THREE.Vector3(sp[i * 3], sp[i * 3 + 1], sp[i * 3 + 2]).normalize();
    const md = Math.max(0, dir.dot(skyMat.uniforms.moonDir.value));
    const fade = 1 - Math.pow(md, 45);
    sc[i * 3] = b * 0.85 * fade; sc[i * 3 + 1] = b * 0.95 * fade; sc[i * 3 + 2] = b * fade;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  starGeo.setAttribute("color", new THREE.BufferAttribute(sc, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    size: 1.9, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.6,
    depthWrite: false, fog: false, blending: THREE.AdditiveBlending, map: glowTex, alphaTest: 0.01,
  }));
  stars.frustumCulled = false;
  scene.add(stars);

  // ---- moon ----
  const moonDir = skyMat.uniforms.moonDir.value;
  const moonPos = moonDir.clone().multiplyScalar(1200);
  const moonMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xdfeefc, transparent: true, opacity: 0.55, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  const moon = new THREE.Sprite(moonMat);
  moon.position.copy(moonPos);
  moon.scale.set(95, 95, 1);
  scene.add(moon);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(30, 48),
    new THREE.MeshBasicMaterial({ color: 0xeef6ff, transparent: true, opacity: 0.95, fog: false })
  );
  disc.position.copy(moonDir.clone().multiplyScalar(1180));
  disc.lookAt(0, 0, 0);
  scene.add(disc);

  // ---- lights ----
  // Three-part night rig: cool moon (key, casts shadows), sky/ground hemi
  // (broad fill so no face is ever pure black), and a dim opposite bounce
  // so backlit facades still read.
const hemi = new THREE.HemisphereLight(0x6d8cb8, 0x1c2228, 0.62);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0x2b3d55, 0.2);
scene.add(ambient);
const moonLight = new THREE.DirectionalLight(0xe2eefc, 4.6);
  moonLight.position.copy(moonDir.clone().multiplyScalar(400));
  moonLight.castShadow = true;
  const shadowRes = config.quality ? 2048 : 1024;
  moonLight.shadow.mapSize.set(shadowRes, shadowRes);
  const sc2 = 62;
  moonLight.shadow.camera.left = -sc2;
  moonLight.shadow.camera.right = sc2;
  moonLight.shadow.camera.top = sc2;
  moonLight.shadow.camera.bottom = -sc2;
  moonLight.shadow.camera.near = 1;
  moonLight.shadow.camera.far = 900;
  moonLight.shadow.bias = -0.0004;
  moonLight.shadow.normalBias = 0.08;
  moonLight.shadow.camera.updateProjectionMatrix();
  scene.add(moonLight);
  scene.add(moonLight.target);
  // opposite bounce — fills the shadowed side of every building
const bounce = new THREE.DirectionalLight(0x44587a, 0.34);
  bounce.position.copy(moonDir.clone().multiplyScalar(-300));
  scene.add(bounce);
  scene.add(bounce.target);

  // ---- soul motes ----
  const moteCount = config.quality ? 900 : 420;
  const mp = new Float32Array(moteCount * 3);
  const mc = new Float32Array(moteCount * 3);
  const speeds = new Float32Array(moteCount);
  const R = 46;
  for (let i = 0; i < moteCount; i++){
    mp[i * 3] = rng.float(-R, R);
    mp[i * 3 + 1] = rng.float(0.2, 22);
    mp[i * 3 + 2] = rng.float(-R, R);
    const ember = rng.chance(0.18);
    const c = ember ? new THREE.Color(0xff9a4a) : new THREE.Color(0x8fe6c8);
    mc[i * 3] = c.r; mc[i * 3 + 1] = c.g; mc[i * 3 + 2] = c.b;
    speeds[i] = rng.float(0.3, 1.4);
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute("position", new THREE.BufferAttribute(mp, 3));
  moteGeo.setAttribute("color", new THREE.BufferAttribute(mc, 3));
  const moteMat = new THREE.PointsMaterial({
    size: 0.34, vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false,
    blending: THREE.AdditiveBlending, map: glowTex, sizeAttenuation: true,
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  scene.add(motes);

  // ---- ground mist ----
  const mistTex = makeNoiseTexture(256, "mist", { contrast: 1.6, grain: 0 });
  mistTex.repeat.set(4, 4);
  const mistLayers = [];
  for (let i = 0; i < 3; i++){
    const mat = new THREE.MeshBasicMaterial({
      map: mistTex.clone(), transparent: true, opacity: 0.16 - i * 0.03,
      depthWrite: false, fog: true, color: 0x93aac2, side: THREE.DoubleSide,
    });
    mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;
    mat.map.repeat.set(3 + i, 3 + i);
    const geo = new THREE.PlaneGeometry(360, 360);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.35 + i * 1.8;
    mesh.renderOrder = 2 + i;
    scene.add(mesh);
    mistLayers.push(mesh);
  }

  // ---- dynamic lantern light pool ----
  const lanterns = [];
  const grid = new Map();
  const CELL = 22;
  const key = (x, z) => Math.floor(x / CELL) + "," + Math.floor(z / CELL);
  function registerLanterns(list){
    lanterns.length = 0;
    grid.clear();
    for (const l of list){
      lanterns.push(l);
      const k = key(l.x, l.z);
      let arr = grid.get(k);
      if (!arr){ arr = []; grid.set(k, arr); }
      arr.push(l);
    }
  }

  const POOL = 12;
  const pool = [];
  for (let i = 0; i < POOL; i++){
    const pl = new THREE.PointLight(0x8fe6c8, 0, 20, 2);
    pl.castShadow = false;
    scene.add(pl);
    pool.push(pl);
  }
  let poolTimer = 0;
  const cand = [];
  function updateLights(px, pz, dt){
    poolTimer -= dt;
    if (poolTimer <= 0){
      poolTimer = 0.18;
      cand.length = 0;
      const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
      for (let dx = -2; dx <= 2; dx++){
        for (let dz = -2; dz <= 2; dz++){
          const arr = grid.get((cx + dx) + "," + (cz + dz));
          if (arr){
            for (const l of arr){
              const d2 = (l.x - px) ** 2 + (l.z - pz) ** 2;
              if (d2 < 55 * 55) cand.push({ l, d2 });
            }
          }
        }
      }
      cand.sort((a, b) => a.d2 - b.d2);
      for (let i = 0; i < POOL; i++){
        const p = pool[i];
        if (i < cand.length){
          const l = cand[i].l;
          p.position.set(l.x, l.y, l.z);
          p.color.setHex(l.color);
          p.distance = l.radius * 2.8;
          p.intensity = l.power * 42;
        } else {
          p.intensity = 0;
        }
      }
    }
  }

  const glowSprites = [];
  function addLanternGlows(list){
    const gtex = glowTex;
    for (const l of list){
      const mat = new THREE.SpriteMaterial({
        map: gtex, color: l.color, transparent: true, opacity: 0.55,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const s = new THREE.Sprite(mat);
      s.position.set(l.x, l.y, l.z);
      const sz = 2.6 * l.power + 1.6;
      s.scale.set(sz, sz, 1);
      scene.add(s);
      glowSprites.push(s);
    }
  }

  function update(dt, t, playerPos, camera){
    // motes drift upward + wrap around player
    const pos = moteGeo.attributes.position;
    const arr = pos.array;
    for (let i = 0; i < moteCount; i++){
      const i3 = i * 3;
      arr[i3 + 1] += speeds[i] * dt * 0.55;
      arr[i3] += Math.sin(t * 0.5 + i) * dt * 0.15;
      arr[i3 + 2] += Math.cos(t * 0.4 + i * 1.3) * dt * 0.15;
      let rx = arr[i3] - playerPos.x;
      let rz = arr[i3 + 2] - playerPos.z;
      if (rx > R) arr[i3] -= R * 2; else if (rx < -R) arr[i3] += R * 2;
      if (rz > R) arr[i3 + 2] -= R * 2; else if (rz < -R) arr[i3 + 2] += R * 2;
      if (arr[i3 + 1] > 24) arr[i3 + 1] = 0.2 + rng.float(0, 2);
    }
    pos.needsUpdate = true;

    // mist follows player horizontally
    for (let i = 0; i < mistLayers.length; i++){
      const m = mistLayers[i];
      m.position.x = playerPos.x;
      m.position.z = playerPos.z;
      m.material.map.offset.x = t * (0.004 + i * 0.003);
      m.material.map.offset.y = t * (0.002 - i * 0.001);
    }

    // sky + moon follow camera so they never clip
    sky.position.copy(camera.position);
    stars.position.copy(camera.position);

    updateLights(playerPos.x, playerPos.z, dt);
  }

  return {
    update, registerLanterns, addLanternGlows,
    sun: moonLight, moonLight, hemi, sky, moonDir,
    setFogDensity(d){ scene.fog.density = d; },
  };
}
