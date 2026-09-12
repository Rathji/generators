# 3D Model Maker — project notes

> Product name: **3D Model Maker** (previously "Text to 3D"). The scripting/embedding API
> namespace is still `window.textTo3d` (unchanged) — only user-facing copy was renamed.

A Perchance generator that turns a text prompt (or a dropped/pasted image) into a real,
exportable 3D model (`https://perchance.org/<generatorName>`).

Pipeline: **prompt (or image) → AI image → 3D reconstruction → three.js viewer → export**.
Two reconstruction modes share the viewer: **Fast · depth** (monocular depth → displaced cut-out
relief mesh, instant, works everywhere) and **Accurate · AI** (TripoSR single-image → mesh, run
client-side on WebGPU — see below).

## Files

| File | Role |
| --- | --- |
| `../main.pjs` | `$meta`, the `text-to-image-plugin` + `ai-text-plugin` + `kv-plugin` + `server-plugin` imports, random-prompt lists, `getStylePresets()` (style chips). High-level config — tweak copy/params here. |
| `../index.html` | All markup + CSS. Starts with the **`text/x-server-plugin` script** (the authoritative shared-stage relay + durable pose store — see below), then the **`#home` landing page** and the (initially `hidden`) `#app` control panel + `#stage` viewport. Ends with a bootstrap `<script type="module">` that **lazily imports `./src/main.js`** only when the user starts — see *Home page / lazy boot* below. Also holds the inline `<symbol id="mmLogo">` **logo mark** (an isometric cube) used by `.homeMark` / `.mark`. |
| `src/logo.svg` | Canonical **logo mark** source (the bare isometric cube, transparent background, viewBox `0 0 100 100`). `index.html` inlines an identical `<symbol>` so it renders with no fetch; keep the two in sync if the mark changes. `$meta.image` is a 1200×630 brand banner built from this mark. |
| `src/main.js` | The app. three.js scene, UI wiring, generate/upload/drag-drop/paste, mesh build, history, export, `window.textTo3d` scripting API, and `initStudio` wiring / `setStudioMode`. Also owns `renderFrame()` (the one render entry point) and `renderOffscreen(scene, camera, size, opts)` — the `WebGLRenderTarget` readback the VTT-token export renders through. |
| `src/img3d.js` | **Accurate-mode client.** Main-thread wrapper around the TripoSR worker: input framing (`prepareInput`, TripoSR's 85%-of-frame foreground normalisation), RGB packing, phase→progress mapping, and the public `reconstructFromCanvas` / `rebuildMesh` / `probeBackbone` calls. Input packing is **planar NCHW** (`canvasToRgb` writes R plane, then G, then B) — see the gotchas. |
| `src/img3d-worker.js` | **Accurate-mode worker.** Downloads + caches the ~485 MB int8 triplane ONNX graph (+ its `.onnx.data` sidecar) and the matched ~0.2 MB fp32 decoder, creates the WebGPU sessions, runs the pipeline, samples the triplane in JS, decodes the density grid, extracts the surface (marching tetrahedra) and smooths it (Taubin). |
| `src/studio.js` | **Studio mode.** Blender-style editing workspace over the viewport: transform gizmos, outliner, properties, procedural animation timeline, shading modes, add-primitive/light, snapshot, JS scripting console. `initStudio(ctx)`; `ctx` carries the scene objects + `applyShading`/`frameObject`/`export`/`toast`/`setStatus` + `onMode`/`onBaseChange` callbacks. |
| `src/studio-addons.js` | **Studio add-ons manager** (the Studio's `Add-ons` workspace tab). `createStudioAddons(ctx)` mounts a Blender-style add-on manager with three built-in add-ons — **Mixamo Bridge** (import a rigged FBX/GLB and retarget the procedural motion library onto it), **MetaHuman Creator** (parameterised AI portrait → AI 3D build), **MetaRforge** (forge a Mixamo-standard humanoid metarig fitted to the model + proximity auto-weight bind). Its bone spec/weighting comes from `src/auto-armature.js` (`humanoidSpec`/`bonesFromSpec`). See *Studio add-ons* below. |
| `src/auto-armature.js` | **Forge a rig for a model that has none.** `analyzeBody` (bounding box + a per-height lateral profile for `armSpread`/`legStance`), `humanoidSpec` (a Mixamo-named standing-humanoid bone layout fitted to the model height), `bonesFromSpec` (flat spec → real `THREE.Bone` tree, honouring spec `dir`/`len`/`muscle`), `boneSegments`/`bindMeshAuto` (capsule-distance 4-influence automatic weights, with an optional capped secondary **muscle** weighting via `opts.muscleMax`), and `createAutoArmature({getRoot,getRig,refreshRig,render,toast})` → `{forge, bind, generate, remove, state, analyze, setOptions}` (`forge` honours `opts.decorate` + `opts.muscleMax`). This is what makes an unrigged AI / relief / imported mesh animatable by Motion, the Shape keys and the GLB exporter. See *Auto-armature* below. |
| `src/muscle-rig.js` | **Anatomical muscle layer on top of the Auto-armature.** `MUSCLE_DEFS`/`CENTRE_DEFS` (36 muscle bellies with anchors, drivers and gains), `muscleSpec(baseSpec, body, opts)` (extends the humanoid spec with one bone per belly) and `createMuscleRig({…})` → `{generate, remove, update, setOptions, state}`. Each belly scales across its own axis in proportion to the flex of the joint it crosses — read live off the bone rotations every frame — so posing/imported clips/procedural Motion all make the muscles fire with no keyframes. See *Muscle rig* below. |
| `src/scene-base.js` | **Blender scene base.** `createSceneBase()` builds the always-present floor gizmo (full-length red X / blue Z lines + green up-arrow + a 3D-cursor-style origin ring) and the Blender-default objects shown in Studio (starter Cube, Camera marker with wireframe frustum, Light marker). Separate from `modelGroup`, so it never pollutes exports unless explicitly included. |
| `src/depth.js` | Depth-Anything-V2-small via `@huggingface/transformers@3.5.1` (wasm/q8). Lazy singleton pipeline + `normalizeDepth`. |
| `src/matting.js` | Foreground segmentation. `cutoutSubject(canvas)` is the app-facing entry point: it tries a **flat-backdrop colour key** first (`flatBackgroundKey` — the right tool for AI-generated studio images, and it correctly drops the ground shadow), falls back to a learned matte (`estimateMatte`, RMBG-1.4 via transformers.js wasm/q8), then cleans up either with `keepLargestComponent` + `fillHoles`. Returns a 0..1 coverage mask + which method won. |
| `src/relief.js` | **Core geometry.** `computeCutoutMask(alpha, w, h, segments)` (forces the outer grid ring "outside" so contours always close inside the frame), the shared `prepareReliefGrid` / `reliefCellPolys` (marching squares), `bilinear`/`smoothstep`, and `buildReliefGeometry(opts)` — the flat/cut-out relief sheet. |
| `src/volume.js` | **Volume math (pure, Worker-safe).** `analyzeMesh` — welds, then signed volume (divergence theorem), area, centroid, inertia/Jacobi principal moments, and the edge/shell/Euler watertightness report; `closeMesh` — caps every boundary loop so an open surface becomes a watertight solid; `calibrate` (real-world units + mass from density), `integrateDensityVolume`, `fuseDensity`/`rotateDensityY`/`flipDensityX`, `DENSITIES`, `format*`. |
| `src/volume-build.js` | **Closed-solid builder.** `buildSolidGeometry` — the same contour as the relief, closed into a genuinely watertight solid (shared `z=0` rim for cut-outs, subdivided walls for full frames); `BACK_MODES` (`mirror`/`flat`/`dome`). Returns geometry + `analyzeMesh` metrics. |
| `src/volume-panel.js` | **The Volume overlay** (`#volumeBtn`). `createVolume({app, toast})` — six steps (source → shape → closed solid → scale → estimate → save) driving real app state, with a live watertight report and the AI-volume (TripoSR density integration) box. |
| `src/loaders.js` | `fileKind`, `loadModelFile` (GLB/GLTF/OBJ/STL/**FBX/PLY/DAE**/**BLEND**), `normalizeObject`. The single `GLTFLoader` is pre-wired with the glTF extensions real files use — **Draco**, **Meshopt** and **KTX2/Basis** (decoders under `src/decoders/`). `adoptAnimations` parks a file's clips on the object itself so one traversal finds them regardless of which node the loader used. |
| `src/video.js` | **WebCodecs video decoding — the preview-safe path.** `openVideo(file)` demuxes a container and decodes frames with `VideoDecoder` (no media element), returning `{ duration, width, height, frameAt(t), framesAt([t…]), dispose() }`, or `null` so the caller falls back to a `<video>`. Built on `mediabunny` (lazy-loaded), so mp4/mov/mkv/webm all work. This is what makes the reference-video / AI-vision-video features function in the editor preview, where a `<video>` element never loads. See *Video decoding* below. |
| `src/blend.js` | **Native `.blend` importer** — reads a Blender file directly, no Blender/export step. SDNA-driven parsing via `jsblender@0.0.4` (so one codepath spans Blender 2.8 → 5.x), gzip handled with `DecompressionStream` (zstd by jsblender), plus materials + packed textures and `buildScene(parts)` → a `THREE.Group` of real meshes/`SkinnedMesh`es with clips. Modern geometry via `attribute_storage`/`mloop`; **pre-2.63 files** via a self-contained legacy **MFace/MTFace/MCol** reader (`readMFaceGeometry`). Entry point `loadBlendFile(file)`; leaves a `group.userData.blendInfo` summary (version, meshes, bones, skinnedMeshes, clips, fps). |
| `src/blend-rig.js` | **`.blend` rig + animation reader** (exported helpers used by `blend.js`). Walks objects → armature → bone tree (`buildSkeleton`), reads skin weights (`readDeformGroups`/`readDeformVerts`, `vertex_group_names` or older `defbase`), reads bind matrices, and **bakes every Blender action into a per-frame `THREE.AnimationClip`** (`readActions`/`readObjectActions` → `buildClips`) — supporting both the modern `FCurve` list and the Blender 5.x `layer_array` stack, with quaternion/euler/position/scale channels. |
| `src/test-assets.js` | **Test fixtures manifest.** Lists the bundled sample images + models in `src/test-assets/` and exposes lazy `fetchTestAsset` / `testImageFile` / `testModelFile` helpers plus `glbSummary()` (parses a GLB header for vertex/triangle/texture counts). |
| `src/test-assets/` | **Bundled test binaries (~21 MB, public).** `image-01…08.jpg` — eight input images used for image→3D runs; `model-01…08.glb` — the GLB exports produced from those runs (each carries its own baked texture + solid shell); `model-solid-01.glb` — one high-poly (~113k-vert) solid-volume export. |
| `src/test-panel.js` | **In-app test browser.** `createTestPanel()` builds the `Tests` overlay: image cards (Build 3D / Reference), model cards (rendered thumbnail, Load, Download), and a `runSelfCheck()` that fetches every fixture and verifies it decodes/parses. |
| `src/library.js` | **Persistent asset library.** `createLibrary(deps)` owns the `kv.library` IndexedDB folder (bytes content-addressed by SHA-256, light metadata index) *and* the `Library` overlay — a tabbed dialog with **Assets** (add / load / reference / save / delete) and **Add-ons** (see `src/addons.js`). Every file imported, dragged, pasted or uploaded is auto-saved here. |
| `src/addons.js` | **Add-ons — the extension system** behind the Library's *Add-ons* tab. `createAddons()` manages activation/teardown, persists the enabled set in `kv.addons`, and renders a searchable, category-filtered catalog. Ships eight built-in add-ons (Stats HUD, View presets, Turntable render, Auto-ground, Auto-play animation, Material presets, Export all formats, Look randomizer). See *Add-ons* below. |
| `src/workflow.js` | **Guided workflow.** `createWorkflow({getKv, app, onChange, toast})` → `{open, close, toggle, refresh, go, get step, get isOpen}`. The `Workflow` button's overlay: one ordered seven-step pipeline (Idea → AI image → 3D model → Look → Rig → Animate → Export) with a rail, a per-step live status chip, inline mirrors of the real controls, and Back/Skip/Continue. See *Guided workflow* below. |
| `src/armature.js` | **Rig understanding + live control.** `analyzeRig(root)` reads a loaded skinned model (bones, parent/child indices, clips, stats, signature); `createRig({root, overlay, size})` returns the controller — InstancedMesh octahedral-bone + joint-sphere overlay, clip mixer, pose capture/apply/reset, bone picking, `netInfo()`. Also `createGhostPuppet()` (a bone-only wireframe stand-in for a remote rig) and the pose codec `encodePose`/`decodePose`. |
| `src/net.js` | **Shared-stage client.** `createNet()` — room join/leave, presence roster, throttled binary pose broadcast, remote rig descriptions, the durable room last pose, and the named-pose library RPCs (`savePose`/`listPoses`/`getPose`/`deletePose`). Reconnects with capped backoff and handles `4403`/`1012`/`1013`/`4429`. |
| `src/rig-panel.js` | **The "Armature" overlay** (`Rig` button). Four columns: Skeleton (overlay toggle, colour-by-role, bone-size, legend, searchable bone tree, bone inspector), Rig + Animation (stats, clip list, play/pause/stop/scrub/speed), Pose (bind/capture/apply, copy JSON) + Shared poses (server library), Shared stage (room/name, join/leave, share link, broadcast/ghosts/restore toggles, roster) + viewport bone picking. |
| `src/motion.js` | **Procedural bone motion.** `MOTION_CATEGORIES` / `MOTIONS` (19 presets) and `createMotionLayer({getRig})` → `{setRig, play, stop, setPlaying, setSpeed, setLoop, update, motion, parts, hasRig}`. Generates motion *directly on the skeleton* (every bone driven from the bind pose each frame via world-axis rotations applied in bind space, with real FK so a rotating parent carries its children), so a model with no clips — or a pose the user made by hand — can be animated. Four categories: Basic / Locomotion / Action / **Intimate** (explicit sexual motions, written plainly). While a motion is active it owns the pose and is deterministic (cannot drift). `applySpec({rot:{boneIndex:[x,y,z]}, move:{...}})` poses the rig from a one-frame world-axis delta spec (radians) — the primitive the AI animation baker uses to turn one authored key into a pose. |
| `src/anim-author.js` | **Keyframe authoring + GLB export.** `createAuthor({getRig, getKv, getModel, onApply})` → capture/remove/clear keys, `closeLoop`, `sample(t)` (slerp quaternions + lerp position deltas), `applyAt`/`setTime`/`play`/`pause`/`stop`/`setDuration`/`setSpeed`/`setAutoKey`/`captureIfChanged`, a durable named-animation library (`kv.animations`), and `buildClip`/`exportGlb` which bake the keys into a `THREE.AnimationClip` and serialise a real **GLB with a skin + one animation** (verified: 42 channels, LINEAR samplers). Bones are normalised on the way in (a non-unit quaternion makes three's slerp a silent no-op — see gotchas). |
| `src/nolimit.js` | **No-limit content rule.** `NO_LIMIT_HEADING` (🔓 THE NO-LIMIT RULE (UNCONDITIONAL, DEFAULT ON, NEVER OFF):), `DEFAULT_RULES` and `createNoLimit({getKv, toast})` → `{enabled (default ON), setEnabled, rules, setRule, resetRules, block(kind), apply(kind, text), append(kind, text), heading, meta}`. Three variants (`text` / `vision` / `image`) because the call sites need different wording. Persisted per-device in `kv.nolimit`. Honest caveat: this removes the app's own self-imposed restrictions; upstream model services still apply their own moderation. |
| `src/ai-panel.js` | **No-Limit AI overlay** (`AI 🔓` button). `createAiPanel({getNoLimit, getGeneratedImage, captureViewport, getAiAnim, onAnimateDone, toast})` → `{open, close, toggle, showTab, syncRuleUI, setVisionUrl, setVisionVideo, sendAnimate, messages, visMode, visFrames}`. Four tabs: **Chat** (streaming free-form assistant; transcript kept append-only with the task at the END so successive turns hit the service prefix cache), **Vision** (an image *or a whole video*: drop/paste/pick/reuse the last generated image/snapshot the 3D view; a video is decoded locally and N frames (4–48, default 12) are sampled into a numbered contact-sheet JPEG — a single image is all the vision model accepts — with a lead-in telling the model to read it as a sequence; then ask anything), **Animate ✨** (see `src/ai-anim.js`), **Rule 🔓** (master switch + the three editable rule bodies). Every call funnels through `nolimit`. |
| `src/ai-anim.js` | **Real AI animation.** `createAiAnim({getNoLimit, getRig, getMotions, getAuthor, toast})` → `{generate(desc,{onChunk,append}), applySpec(spec,{append}), parseSpec(text), prompt(desc), stop(), roles, hasRig, pending}`. The text model writes a compact declarative JSON keyframe spec (`{name, duration, loop, keys:[{t, pose}]}`) of world-axis euler **deltas in DEGREES** keyed by anatomical **role** — hips/spine/chest/head/armL/armR/legL/legR/root, plus a `bone:NAME` escape hatch and a `move:` prefix for translation. Roles resolve against the *same* bone classification the motion presets use (`motions.parts`), so one prompt animates any humanoid however its bones are named; limb roles take a chain of triples (shoulder→elbow→wrist, hip→knee→ankle). Baking: for each sorted key it calls `motions.applySpec` to pose the rig, then `author.captureKey(t)` — so the result is a normal authorable clip (scrub/edit/loop/export GLB). Runs under the no-limit rule, so explicit/extreme motions are keyed accurately. The prompt is prefix-cache friendly (static base + schema first, the motion description last). |
| `src/thumb.js` | **Shared offscreen thumbnail renderer.** `createThumbRenderer()` renders any `Object3D` to a JPEG data-URL for the model previews in `library.js` / `test-panel.js`; `disposeTree()` frees a parsed tree. |
| `src/environments.js` | **Realism IBL.** Procedurally paints 6 equirectangular skies (`studio/soft/neutral/outdoor/sunset/night`) into a 2D canvas, filters them through a `PMREMGenerator`, and applies them as `scene.environment` (+ optional background). Also exports `LIGHT_RIGS` / `applyLightRig` / `applyEnvIntensity` and the `EnvironmentManager` class. |
| `src/render-fx.js` | **Realism post-processing.** The `PostFX` chain (grade → bloom → sharpen → lens → vignette → grain → dithered blit) over an offscreen display target, plus `FX_PARAMS`, `FX_PRESETS`, `LOOK_PRESETS`. |
| `src/material-maps.js` | **Derived PBR detail maps.** `deriveDetailMaps(source, opts)` produces a normal map (band-passed + normalised Sobel of the base-colour luminance) and a cavity/AO map, so a photo-textured mesh gets real surface micro-relief. Plus `canvasTexture` and `ensureUv1`. |
| `src/exporters.js` | `toGLB` / `toPLY` / `toSTL` / `toOBJ` / `download` / `slug`. `toSTL`/`toOBJ`/`toPLY` route through `pruneInvisible()` (drop invisible nodes) because those three exporters have no `onlyVisible` option. (`toGLB` honours an explicit `animations: false` to *exclude* clips.) |
| `src/geo-ops.js` | **The mesh toolkit behind the Export targets.** Works on flat attribute arrays (`positions`/`normals`/`uvs`/`colors`/optional `indices`), not THREE objects, because the same code runs on a freshly baked scene graph, a repaired solid, a decimated LOD and a generated base. `bakeGeometry` (scene graph → one world-space soup + its textures), `indexed`/`expand`/`cloneSoup`/`computeNormals`, `bounds`/`scaleSoup`/`translateSoup`/`yUpToZUp`/`centerOnOrigin`/`standOnOrigin`, `repair` (caps boundary loops via `volume.closeMesh`), `hollow` (an inward-offset inner shell with reversed winding, built on a *positionally welded* copy so the offset doesn't tear at hard edges), `vertexCluster`/`decimateTo` (LODs + collision), `convexHull` (three's `ConvexGeometry`), `addBase` (round/hex/square print base baked into the mesh), and hand-written `toBinarySTL`/`toAsciiSTL`/`toOBJ`/`toMTL` + `printReport`. |
| `src/zip.js` | **Tiny dependency-free ZIP writer** (STORE method, CRC-32, UTF-8 names, optional folder prefix). `zipBytes(files, {folder})` / `zipBlob(...)` — how the multi-file destinations (Tabletop Simulator, game engine, Everything) and the "extras" bundles become one download. Verified by round-tripping through `@zip.js/zip.js`. |
| `src/targets.js` | **The Export overlay** (`#targetsBtn`). `createTargets({app, toast})` → `{open, close, toggle, refresh, build(id), isOpen, target, lastBuild, targets}`. Seven destinations — **3D Print · STL**, **Miniature · STL**, **Tabletop Simulator**, **VTT Token**, **Game Engine · GLB**, **Game Engine · OBJ**, **Everything** — each with its own options form and build pipeline that bakes the stage model once and processes it per destination (repair → scale to mm/units → hollow → base → LODs/hull → STL/OBJ/MTL/PNG/GLB → zip). See *Export targets* below. |
| `src/tga.js` | **Self-contained TGA (Targa) codec** — the browser cannot decode TGA at all, and Blender uses it constantly. `isTGA(bytes, name)` (extension / footer / plausible-header sniff), `decodeTGA` + `tgaToCanvas` / `tgaToDataURL` / `tgaToBlob`, and `encodeTGA({width,height,data}, {rle, alpha, bottomUp})`. Reads image types 1/2/3 + RLE 9/10/11, 8/15/16/24/32-bit, colormapped and greyscale; `tgaToCanvas(bytes, makeCanvas?)` accepts a canvas factory (used by `blend.js` for packed textures). Verified exact round-trip (raw + RLE, both orientations). Wired into image import, `.blend` packed textures, library thumbnails, and PNG-style view export. |
| `src/shape-keys.js` | **Automatic Shape Keys / morph targets** — real `geometry.morphAttributes.position` deltas (relative morphs, so Blender opens them as Shape Keys). `AUTO_SHAPES` (10 procedural shapes: Inflate, Deflate, Taper, Twist, Bend, Stretch, Slim, Smooth, Spherify, Muscle) + `createShapeKeys({getRoot})`. `autoShape(ids\|"all")` computes a shape straight from the geometry; `autoShapeKeys()` derives **rig-aware corrective keys** (Flex + Bulge per important bone, using the bone's world head/tail segment); `list/getWeight/setWeight/remove/reset/clear/invalidate`, and `info()`. Writes `morphTargetDictionary` via three's `updateMorphTargets()` so **the GLB export carries named morph targets** (`extras.targetNames`). See *Shape keys* below. |
| `src/shape-panel.js` | **The Shape overlay** (`#shapeBtn`). `createShapePanel({app, toast})` — three blocks: Auto shape (the 10 chips, Generate all / Reset weights / Clear all), Rig shape keys (Generate from rig), and the live key list (weight slider + value + ×, Export GLB). Rebuilds the list only when its signature changes so a slider drag isn't interrupted. |
| `src/three.js` | One place for the pinned `esm.sh/three@0.160.0` imports and re-exports (incl. `TransformControls`, `ConvexGeometry`, the GLTF/DRACO/KTX2/Meshopt/OBJ/STL/FBX/PLY/Collada loaders, and the GLTF/STL/OBJ/PLY exporters). |

Nothing outside `main.pjs`, `index.html`, and `src/` ships. Keep it that way.

## Home page / lazy boot (`#home` in `index.html`)

Opening the generator shows a lightweight **landing page** (`#home`) and does **not** load the app:
`#app` ships with the `hidden` attribute, and `<script type="module">` only re-exports a small
`boot()` helper — it never imports `./src/main.js` at load. So on first paint nothing of three.js,
transformers.js, the ONNX workers or the studio is fetched or executed; memory stays near the cost of
the static HTML/CSS. That is deliberate — the full app is many MB of JS and (in Accurate mode) a
~485 MB model, and most visitors only look at the page.

`boot(intent)` is the only path into the app: it un-hides `#app`, dynamically imports
`./src/main.js`, waits for `window.textTo3d`, hides `#home`, then runs the optional `intent` —
`{action:"workflow"}` opens the Guided workflow, `{action:"library"}` opens the Library, and
`{action:"file", file}` calls `textTo3d.fromFiles([file])`. Entry points that call it: the
**Enter the studio** button, the **Guided workflow** / **Open library** buttons, and a drag-drop or
image paste anywhere on the landing page (both boot straight into a build). If the import fails the
landing page is restored with the error in `#homeNote`, so a broken boot is visible rather than blank.

Keep the landing page's own JS tiny and dependency-free — its whole point is to run before any of the
heavy modules exist. Anything that touches `window.textTo3d` must run *after* `boot()`'s import
resolves (the app assigns `window.textTo3d` synchronously at the end of `src/main.js`).

Gotcha while testing: capturing the page with the workspace `snapshot.js` helper **before** the app
boots can claim a 2D context on `#view`; a later WebGLRenderer then fails with *"Canvas has an
existing context of a different type"*. Snapshot a *booting/app* state only after `#app` is live, or
reload in between.

## Geometry (`src/relief.js`)

`buildReliefGeometry` samples the depth map onto a `segments × segments` grid, normalises the
1–99 percentile range, optionally smooths (box blur), applies the cut-out mask + a distance-
based bevel, then emits:

- **front** — a displaced surface clipped to the subject silhouette, via **marching squares**
  over the (blurred) alpha field. Grid cells with 2/3/4 crossings are polygonised exactly, so the
  outline is sub-cell accurate rather than staircase-y.
- **solid** — extruded side walls (only along silhouette edges) + a flat back, merged into the
  same geometry as a second material group.

Key correctness details (do not regress):
- Front vertices are deduped with a `round(u*1e6)+":"+round(v*1e6)` key; a lossy hash here
  merges distinct vertices and shreds the surface.
- A final pass flips any front triangle with `nz < 0` — back-facing front triangles were the
  cause of "dense vertical grooves"/gaps.
- `computeCutoutMask` floods the background from the border (8-connected) and **fills small
  enclosed holes** (both `mask` *and* `field`, since the polygoniser reads `field`, not `mask`).
  Without this, alpha noise leaves voids in the mesh.

`cutout` mode only engages when the source image actually has alpha (`prepareInputs` returns
`alpha: null` for opaque images, e.g. no `removeBackground`).

## Solid 3D models (auto cut-out + volume)

Two Shape-card options turn the flat relief into a **real 3D model**:

- **Auto cut-out** (`#matteCheck`, on by default): when the loaded image is opaque (no alpha), the
  subject is segmented (`cutoutSubject` in `src/matting.js`) and its mask is used as the cut-out
  alpha, so the mesh follows the subject's silhouette instead of being a rectangle. Two methods,
  tried in order:
  1. **Flat-backdrop colour key** — the border band is sampled, its median colour is taken as the
     backdrop, and pixels far enough from it are foreground. It bails out (returns `null`) when the
     border is not uniform. This is what AI-generated "seamless background" product shots get, and
     it is *much* better there than a learned matte, because it drops the soft **ground shadow**:
     a matte model promotes the shadow to "subject", the encoder reads that as a sheet of real
     surface, and the reconstruction inflates into a blob (measured on a teapot render: blob with
     the neural matte, clean teapot with the colour key).
  2. **Learned matte** — RMBG-1.4 via transformers.js (wasm/q8), thresholded at 0.5.

  Either way the mask is then cleaned: `keepLargestComponent` (a stray speck becomes a real island
  of geometry), then `fillHoles` for *small* holes only (a learned matte speckles the subject with
  pinholes; a real hole — a teapot handle's eye — is left alone). 1-px box blur gives a soft edge.
  `state.sourceAlpha` keeps the original (usually `null`), `state.matteComputed` flags that the mask
  was synthesized, `state.cutMethod` records `"flat"` / `"neural"`. Unchecking restores the
  full-frame build. Skips work when the image already has alpha (e.g. a generated image with
  `removeBackground`).
- **Solid volume** (`#volumeCheck`, on by default): swaps `buildReliefGeometry` for
  `buildSolidGeometry` (see *Real volume measurement & closed-solid builder* below) — a genuinely
  closed, watertight mesh rather than the old "mirrored back + walls" approximation. All eight
  bundled test images now measure watertight, zero boundary / non-manifold edges, single shell.

Both are visual/geometry behaviour only — the flat-plaque build is the same code path with
`volume:false` and no mask, so existing behaviour is preserved when the options are off.

## Real volume measurement & closed-solid builder (`src/volume.js`, `src/volume-build.js`, `src/volume-panel.js`)

A generated mesh is only a "volume" if it is closed; the app now measures that honestly and offers a
builder that guarantees it.

- **`src/volume.js` — the math (pure, no imports, so a Worker can use it).**
  `analyzeMesh({positions, indices})` welds coincident vertices, then computes the **signed volume**
  via the divergence theorem (sum of `a·(b×c)/6`), surface area, bbox, centroid, principal moments
  (Jacobi eigen-decomposition of the inertia tensor), and a topological report: boundary edges,
  non-manifold edges, flipped edges, shell count and Euler characteristic, plus `fillRatio`
  (volume / bbox). `watertight`/`closed` are derived from those counts, not guessed. `calibrate()`
  turns a report into real-world units (height axis + density → mass), `integrateDensityVolume()`
  integrates a density grid, `fuseDensity`/`rotateDensityY`/`flipDensityX` are the multi-view
  helpers, and `formatLength/Area/Volume/Mass` localise the readout. Verified exact on a unit cube
  (volume 1, area 6, inertia 1/6, Euler 2). `closeMesh({positions, indices})` is the
  repair primitive: it finds every free (boundary) directed edge, chains them into loops and fan-caps
  each loop (one centroid vertex per loop, wound opposite the surface so the patch's normal matches),
  turning an open surface — a TripoSR iso-surface cut at its box, a scan, a single-sided sheet — into
  a genuinely watertight solid with a well-defined volume. Original vertices are preserved in order so
  vertex colours survive; verified on an open unit box (capped, watertight, volume exactly 1) and an
  uncapped 24-gon cylinder (two caps, volume 6.2117 vs the true 6.2832).
- **`src/volume-build.js` — the builder.** `buildSolidGeometry({depth, width, height, alpha, …})`
  reuses `prepareReliefGrid` + `reliefCellPolys` (the same marching-squares contour as the relief)
  and closes the shell two ways: a **cut-out subject** gets front + back sheets extracted from the
  *same* contour, with every contour point pinned to `z = 0` on both sheets so the two rims are the
  identical segment and no side walls are needed; a **full frame** gets front + back sheets plus
  per-segment side walls whose inner edge matches the back sheet's border exactly. `backMode` picks
  the back: `mirror` (front mirrored about z=0 — organic, symmetric), `flat` (constant thickness),
  `dome` (thickness tapers to the rim). A `minBack` clamp keeps the back strictly behind the front
  so the two never weld into a pinch. Returns `{geometry, cutout, backMode, metrics}` where `metrics`
  is `analyzeMesh` of the finished shell.
  **Contour must close inside the frame (do not regress):** `computeCutoutMask` forces the outermost
  grid ring of the alpha field to read *outside* (< 0.5). Without this, a subject that runs off the
  edge of the image leaves the marching-squares contour open at the border, and the solid builder can
  only produce a torn, non-manifold rim (88 boundary edges on the image-05 test). Pulling the contour
  one cell inside the frame makes every silhouette close — all 8 test images build watertight.
- **`src/volume-panel.js` — the overlay.** `createVolume({app, toast})` renders the **Volume** panel
  (toolbar `#volumeBtn`): six always-visible steps — **Source image → 3D shape → Closed solid →
  Real-world scale → Volume estimate → Save** — with per-step badges, a live watertight / edge /
  shell report, and inline controls that drive the real app state (`app`). It refreshes on the
  `textTo3d:volume` event and on a slow poll. Step 3 also carries a **Close open mesh** button →
  `app.closeMesh()` → `closeStageMesh()` in `main.js`, which caps the current mesh's boundary loops
  (`closeMesh`) and replaces it with the watertight result, so an open AI surface or imported sheet
  becomes a real solid you can measure and print.
- **AI volume (the neural path).** The Accurate · TripoSR worker (`img3d-worker.js`) can also run in
  **multi-view** mode: it encodes the image a second time horizontally mirrored, fuses the two density
  grids (`fuseDensity`), and `integrateDensityVolume` reads a volume straight off the network's own
  density field — a measurement that does not depend on the extracted surface being watertight. Both
  the AI mesh metrics (the extracted surface measured by `analyzeMesh`) and the density volume are
  surfaced in the panel's *3D shape → AI volume* box (`Resolution`, `Multi-view fusion`,
  `Build AI volume`). Verified end-to-end (res 96, multi-view): 17 s, watertight mesh, mesh volume
  0.0664 vs density-field volume 0.0626 — two independent estimates that agree.
  **Gotcha (do not regress):** a Worker **cannot fetch a sibling `src/` file in the unsaved preview** —
  the editor's service worker serves `src/*` only to the page, so `import "./volume.js"` from inside a
  worker 404s and the worker dies with an opaque error event. `img3d.js` therefore reads `volume.js`
  (the page *can*) and passes its source text in every message; the worker imports it from a **blob
  URL** (`ensureVolume`, cached). One source of truth, works saved *and* unsaved. Any future shared
  module a worker needs must go through this same hand-off.
- **Volume from the Library.** `library.js` image cards carry a **Solid** button (fast) and, when
  WebGPU is present, an **AI volume** button → `buildVolume(id, opts)` →
  `app.buildVolumeFromLibrary(src, name, opts)`. The fast path computes depth, builds the closed
  solid and opens the Volume panel; the **AI** path runs the TripoSR network (multi-view by default)
  to reconstruct a **real 3D mesh**, then auto-runs `closeStageMesh()` so the result is a watertight
  solid, and opens the panel. So *any image already in the library* becomes a measurable real 3D
  volume in one click — either cheap/deterministic or neural/accurate.
- **Workflow integration.** The Guided workflow's *3D model* step (`workflow.js`) gained a
  **Volume & closed solid** button (opens the panel) and an **AI volume (accurate)** button that runs
  the neural reconstruction + measurement directly (disabled when WebGPU is absent), plus a live
  volume/watertight line; the *Export* step gained a **Volume report** button (downloads a text
  report) + a volume line, and an **Export targets** button that opens the destination overlay
  (print / Tabletop Simulator / VTT token / game engine).
- **Scripting.** `textTo3d` gains `volume` (the panel), `BACK_MODES`, `DENSITIES`, `measureVolume`,
  `volumeReport`, `aiMetrics`, `calibratedVolume`, `setVolumeScale`, `setVolumeSolid`,
  `setVolumeBackMode`, `closeMesh()`, `buildSolidVolume(opts)`, `buildAiVolume({multiView,resolution})`,
  `aiVolume(opts)` (multi-view shortcut), `buildVolumeFromLibrary(src,name,{method:"fast"|"ai"})` and
  `volumeReportText()`.

## Shape keys — automatic morph targets (`src/shape-keys.js`, `src/shape-panel.js`)

The **Shape** toolbar button (`#shapeBtn`) opens an overlay that gives the stage mesh Blender-style
**Shape Keys** automatically. Shapes are *real* morphs: `addMorph()` appends a `Float32BufferAttribute`
of per-vertex deltas to `geometry.morphAttributes.position` (named), sets
`mesh.morphTargetsRelative = true`, and rebuilds `mesh.morphTargetDictionary`/`morphTargetInfluences`
via three's `updateMorphTargets()` (with a hand-rolled `syncMorphs()` to clear them when the *last*
morph is removed — `updateMorphTargets()` alone leaves a stale dictionary there). `markMaterial()`
flags the material `needsUpdate` so the renderer recompiles with morph support the moment a shape is
added. Morphs are relative, so the glTF export writes them as standard morph targets and **Blender
imports them as named Shape Keys** (verified: `extras.targetNames` carries `Shape · Inflate` … for
every primitive).

Two producers:

- **Auto shape** — ten procedural shapes computed straight from the geometry
  (`proceduralDeltas`): Inflate / Deflate (radial from the local centroid), Taper / Twist / Bend /
  Stretch (along the height or a world axis), Slim, Smooth (uniform Laplacian toward the 1-ring mean,
  i.e. a relax pass), Spherify (blend toward the bounding sphere) and Muscle (a gaussian bump around
  a chosen centre). Each chip adds its key at weight 0.6; clicking again zeroes it. **Generate all**
  builds the ten at once.
- **Rig shape keys** (`autoShapeKeys`) — corrective keys derived from the skeleton: for each
  *important* bone (`analyzeRig` + `classifyBone`, skipping tails/controls, top 12 by score) the mesh
  region around the bone's **world head→tail segment** is bent (**Flex**, rotate points about the
  joint by a falloff of the signed distance along the bone) and bulged (**Bulge**, push points away
  from the bone axis), using a gaussian falloff over perpendicular distance. One Flex + one Bulge per
  bone. Requires a rigged model — the panel shows *Skeleton detected* / *No skeleton on the stage*.

The overlay: a header stat (`N mesh · V v · K keys`), the Auto-shape chips, the rig block, and the
live key list (name + weight slider + numeric value + ×, plus **Export GLB (with shapes)**). The list
is rebuilt only when its signature changes, so dragging a weight is not interrupted by the poll.
Any model rebuild (`onModelChanged`) invalidates the cached vertex frames and clears the old mesh's
shapes. `window.textTo3d` gains `shape` (the engine), `shapePanel`, `shapes()`,
`autoShape(ids|"all")`, `autoShapeKeys()`, `setShape(name, v)`, `resetShapes()`, `clearShapes()`,
`shapeName(label)`.

## Export targets — one finished file per destination (`src/targets.js`)

The plain **Export** card writes one mesh in one format, which is fine when you already know the
format. But every *destination* has its own conventions — a slicer wants a watertight solid scaled
in millimetres, Tabletop Simulator wants an OBJ + MTL + texture in a folder, a game engine wants a
normalised pivot with LODs and a collision proxy, a virtual tabletop wants a square token image. The
**Export** toolbar button (`#targetsBtn`) opens an overlay that encodes those conventions as
*destinations* you pick, then runs one pipeline that bakes the stage model once and processes it per
target:

```
bake (geo-ops.bakeGeometry)
  -> repair open surfaces into solids      (volume.closeMesh, via geo-ops.repair)
  -> scale to real-world mm / table units  (geo-ops.scaleSoup / standOnOrigin)
  -> hollow for printing                   (geo-ops.hollow)
  -> add a print/tabletop base             (geo-ops.addBase)
  -> decimate for LODs, hull for collision (geo-ops.decimateTo / convexHull)
  -> write STL / OBJ / MTL / PNG / GLB     (geo-ops writers + three's GLTFExporter)
  -> package the multi-file targets        (zip.js)
```

The seven destinations:

| Target | Produces | Notes |
| --- | --- | --- |
| **3D Print · STL** | `NAME.stl` (+ `NAME-PRINT-REPORT.txt`) | Watertight STL in millimetres, optional hollow wall, optional round/hex/square base, material picker for a mass estimate. |
| **Miniature · STL** | `NAME-<scale>mm.stl` (+ report) | Heroic-scale presets (28/32/40/54/75 mm or custom), a base, hollow, and an optional base clearance gap so it prints as two clean pieces. |
| **Tabletop Simulator** | `NAME.obj` + `.mtl` + `.png` (+ `HOW-TO-IMPORT.txt`) | The exact trio TTS's Custom Model importer wants, sized in table units, Y- or Z-up, optional convex collider OBJ. |
| **VTT Token** | `NAME-token-N.png` (+ `.glb`, `HOW-TO-USE.txt`) | Square, circular-masked token rendered offscreen from the live model (3/4, front or top-down), transparent or backdrop, plus a 1-unit GLB for 3D canvases. |
| **Game Engine · GLB** | `NAME.glb` (+ LODs, `-collision.obj`, `IMPORT-NOTES.txt`) | Normalised to 1 m and re-pivoted at the feet by temporarily transforming the live root (`transformRoot`) — so skinned meshes keep their clips — with a decimated LOD chain and a hull/box/low-poly collision proxy. |
| **Game Engine · OBJ** | `NAME.obj` + `.mtl` + `.png` (+ notes) | The universal interchange set with a Y-up/Z-up choice and an optional collision mesh. |
| **Everything** | one `.zip` + `MANIFEST.txt` | A print STL, a game GLB, an OBJ set, a token PNG and a manifest, all bundled. |

Key details (do not regress):

- **The panel reports before it builds.** The file list and the file names update live as you change
  options; the printability readout is the *same* `analyzeMesh` the Volume panel uses, so the two can
  never disagree.
- **"Closed" ≠ "watertight".** `analyzeMesh`'s `watertight` flag additionally rejects a handful of
  non-manifold/flipped edges; slicers only care about **boundary edges**. The panel therefore treats
  `boundaryEdges === 0` as "closed solid — slice it directly" and reports non-manifold edges
  separately (a fan cap over a non-manifold boundary loop can leave a few, which is harmless).
- **Repair is a cap, not a rebuild.** `geo-ops.repair` routes through `volume.closeMesh`, which caps
  every boundary loop with one centroid vertex per loop, wound opposite the surface. Verified
  end-to-end: an open 738-boundary-edge test mesh exports an STL that re-imports with **0 boundary
  edges** and Z ∈ [0, 80] mm.
- **Hollowing welds first.** `geo-ops.hollow` builds its inner shell on a *positionally welded* copy
  of the surface — `indexed()` keeps hard-edge/UV-seam vertices split, so offsetting each split copy
  along its own normal tears the shell at every crease (i.e. on nearly every flat-shaded AI mesh).
  With the weld, a unit cube (0.1 wall), a sphere (0.05 wall) and the AI test mesh all measure **0
  boundary edges** after hollowing; volumes come out as `outer − inner` as expected. If the
  requested wall is thicker than the model's own thinnest feature the offset would still tear, so the
  print targets detect an opened shell and **export the solid instead**, with a note telling the user
  to thin the wall.
- **Token rendering** uses `renderOffscreen(scene, camera, size, opts)` in `main.js` — its own scene
  (no grid/ground), the app's environment map plus key/fill lights, a `WebGLRenderTarget` with
  `colorSpace: SRGBColorSpace`, and a Y-flip on readback. That renderer is shared with anything else
  that needs offscreen pixels.
- **ZIP is STORE-only.** No compression, but valid everywhere and cheap; the per-target payload is a
  few MB.
- **Scripting:** `window.textTo3d.targets` (the panel) and `window.textTo3d.exportTargets(id)`
  (`"print" | "mini" | "tts" | "token" | "glb" | "obj" | "all"`).



Browsers have no TGA decoder, yet Blender packs and exports `.tga` constantly, so the app carries its
own codec and routes TGA through it everywhere an image can appear:

- **Import** — `.tga` (and `.icb/.vda/.vst`) joined `IMAGE_EXTS` in `src/loaders.js`; `imageFileToDataURL`
  in `main.js` decodes a dropped/pasted TGA (via `tgaToCanvas` → PNG data URL) before the normal image
  pipeline, and the file picker/drop overlay lists it.
- **`.blend` packed textures** — `readTextures()` in `blend.js` decodes a packed TGA straight into a
  `THREE.CanvasTexture` (tagged `userData.tga`) instead of failing.
- **Library thumbnails** — `buildThumb()` in `library.js` decodes TGA assets for the card preview.
- **Export** — the Export card's **TGA** button (`doExport("tga")`, also `textTo3d.export("tga")`) blits
  the WebGL canvas (which has no 2D context) onto a scratch canvas and `encodeTGA` writes an RLE,
  top-down image; the decode/encode round-trip is pixel-exact.

## Accurate mode — TripoSR on WebGPU (`src/img3d*.js`)

Switch the **Reconstruction** card to **Accurate · AI**. This runs VAST-AI-Research/TripoSR
(Tripo AI + Stability AI, Apache-2.0) fully client-side, from the int8 ONNX export
<https://huggingface.co/cgb/triposr-onnx-webgpu> (commit `048725e`). WebGPU is
required (`navigator.gpu`); the AI button is disabled with a reason when it is missing.

### Pipeline

1. **Input** (`img3d.js`): the subject is cut out, cropped to its alpha bounds, padded to a square
   and scaled so it covers **85% of a 512×512 frame** (TripoSR's own framing). Transparent pixels
   are composited over mid-grey 0.5. The ±mean/±std normalisation is baked into the encoder graph,
   so raw `[0,1]` RGB is fed.
2. **Encoder** → DINOv2 ViT-B/16 image tokens.
3. **Backbone** → 16-layer `Transformer1D` over 3×32×32 learned triplane tokens cross-attending the
   image → scene codes.
4. **Triplane** → 3×40×64×64 feature planes.
5. **Sample** — the `grid_sample` that turns a 3D point into the decoder's 120 inputs is done **by
   hand in JS** (`sampleFeatures`), not in a graph: bilinear, `align_corners=false`, coordinate
   pairs `(x,y) (x,z) (y,z)`, plane-major concat. ORT-web's WebGPU `GridSample` is patchy, and the
   arithmetic is small enough to do in the caller. The reference implementation does the same, with
   one difference: it clamps out-of-range taps to the edge while we zero-pad. Negligible.
6. **Decoder** → `NeRFMLP` (120→64×9 SiLU→4) evaluated on a regular grid in `[-0.87, 0.87]³`,
   returning `exp`-activated density + colour (both activations are folded into the export). The
   grid is decoded in 16384-point batches.
7. **Extract** — marching tetrahedra at density iso 25 (6 tetrahedra per cube, all sharing the
   000–111 diagonal so the result stays watertight). Triangle winding is oriented by the
   within-tet constant density gradient, so normals are consistent without a normals pass.
8. **Smooth** — see below. Colours are then decoded a second time at the (smoothed) vertex
   positions and converted sRGB→linear.

### The ripple, and why we smooth (do not regress)

The raw iso-surface carries a **low-frequency ripple** ("washboard" ridges on the shaft in our axe
test). This was investigated at length and is **inherent to the field, not the extractor**: a
synthetic smooth cylinder extracts from the same code with a mean dihedral of ~1.3–2.3° and 0% of
edges above 15°, while the real mesh measured ~8.4° mean / 16.7% above 15°. Multi-resolution
radial-profile Fourier analysis showed the ripple amplitude *drops* with grid resolution
(13.1% @96 → 9.1% @192 → 7.6% @256), i.e. it is a real surface undulation, not sampling noise, and
it traces to the bilinearly-sampled triplane features.

Fixes tried and rejected: a separable `[1,2,1]/4` triplane blur (no measurable effect — it is a
no-op at the relevant frequencies), and a hand-rebuilt all-float32 decoder (onnxruntime-web refuses
to type-check it — see the `NOTE` in the worker). The shipped fix is **Taubin (λ=0.5, μ=−0.53)
relaxation of the extracted mesh** in `smoothMesh()`: alternating a positive and a slightly larger
negative pass is a low-pass filter with passband gain ≈ 1, so the ripple is removed without the
volume/silhouette shrinkage a plain Laplacian would cause. The amount is specified as a **world-space
radius**, not a pass count (`passes = clamp(round((radius / avgEdge)²), 0, 80)`), so it is
resolution-independent. An A/B of 0 / 8 / 25 passes picked the middle as the sweet spot; the
default (0.030 world) removes the ridges while keeping the blade crisp, and a later shared-edge
dihedral sweep across 0–0.05 confirmed it is past the knee without paying any surface-area cost.

### Two failure modes that look like "the model is broken" (do not regress)

1. **Channel-interleaved image tensor.** `canvasToRgb` in `img3d.js` must write **planar NCHW**
   (all of R, then all of G, then all of B). For a while it wrote interleaved `RGBRGB…`, which
   produced a striated blob — the encoder still ran, still returned a plausible-looking triplane,
   and the mesh was just wrong. There is no error to catch; if a reconstruction looks striped or
   amorphous, check this first.
2. **A bad cut-out.** Feeding the encoder a subject that still carries its ground shadow (or that
   lost a chunk to a noisy matte) yields an inflated blob even though every stage "succeeds". A
   chair with a genuine alpha channel reconstructs as a recognisable chair; the same pipeline on a
   teapot on grey-with-a-shadow reconstructs as a blob with the neural matte and as a clean teapot
   with `flatBackgroundKey`. Diagnose by rendering the mask itself, not by staring at the mesh.

Both were real, both looked from the outside like "TripoSR doesn't work". Verify with a
**distinctive object** (a chair beats a teapot as a test): if a chair comes out chair-shaped, the
pipeline is fine.

### Controls

The **Reconstruction** card reveals two sliders when Accurate mode is selected (`#aiControls`):

- **Mesh detail** (`#aiDetailRange`, 96–320, default **256**) — the density grid resolution. Changing
  it re-decodes the whole grid (slower); the triplane features are reused. A labelled A/B of the same
  generated teapot at 192 vs 256 was judged clearly better at 256 (crisper spout, handle and lid rim,
  rounder body) — the difference is obvious, not subtle, so 256 is the default. 320 is allowed for
  the patient: it costs ~2× the decode time of 256 and ~130 MB more for the density grid.
- **Surface smoothing** (`#aiSmoothRange`, 0–1, default **0.75**) — maps to a world radius via
  `AI_SMOOTH_WORLD = 0.04` (0.75 → 0.030). Re-extracts + re-smooths from the **cached density**
  (fast), so it can be dragged live. Measured on the 256 teapot (shared-edge dihedral angles):
  0 → mean 14.4° / p99 75° / 0.15% of edges razor-sharp; 0.022 → 3.3° / 24° / 0.02%; 0.030 →
  3.0° / 22° / 0.01%; ≥0.04 saturates (the pass count clamps at 80). Total surface area barely
  moves across the range (5.658 → 5.657), so the extra smoothing buys spike removal without
  volume loss — hence 0.030 rather than 0.022.

Both are wired to `scheduleAiRebuild()` → `runAiRebuild()`, a serialised "latest wins" loop: a drag
while a rebuild is running queues exactly one more pass with the final values. `textTo3d.rebuildAi(
threshold, resolution, smooth)` is the programmatic equivalent and also powers history restore.

### Weights & caching

The triplane graph + its `.onnx.data` sidecar and the small decoder (~485 MB total) are fetched with
a streaming reader into the Cache Storage bucket `triposr-webgpu-cgb-v1`, so they download once per
origin. The sidecar is handed to `InferenceSession.create` as `externalData` (a `Uint8Array`).
`onnxruntime-web@1.23.0` on the WebGPU EP is used; all of this runs in `img3d-worker.js` so the
multi-hundred-MB session creation never blocks the page.

## Text→image (generate just the picture)

The **Prompt** card's primary action is **Generate 3D**, but the **Image** button next to it runs the
text→image stage *only* — it makes the AI image from the prompt (+ style chip + optional reference)
and stops there, no mesh. This is the app's plain "text to image" feature.

The produced image lands in the **AI image** card (`#imageCard`, sits between Prompt and
Reconstruction, hidden until there is an image): a `contain`-fitted preview on a checkerboard
(so transparent `removeBackground` cut-outs read correctly), a **Save** button (PNG/JPEG, named
from the prompt via `slug`), a **Reference** button (feeds the image back in as the next prompt's
reference — an easy way to iterate), and a **Build 3D** button that hands the image to the normal
reconstruction pipeline (`buildFromImageSrc`). Clicking the preview (or the Preview card's source
thumbnail, or `#imgViewBtn`) opens a full-size **lightbox** (`#imgLightbox`, click anywhere or Esc
to close).

Generated images are kept in a session gallery (`state.genImages`, capped at 12) shown as a
thumbnail strip in the card once there is more than one; clicking a thumb switches the preview.
The 3D flow also feeds this card (`generate()` → `requestImage()` → `showGeneratedImage`), so the
picture is always inspectable/saveable even when you go straight to a model.

`requestImage()` is the single text→image entry point (prompt assembly, reference captioning,
negative prompt, resolution, `removeBackground`); `generate()` (3D) and `generateImageOnly()`
(gallery) both call it. Exposed to scripting as `textTo3d.generateImageOnly()`,
`textTo3d.generatedImage` / `generatedImages`, and `textTo3d.showGeneratedImage(dataUrl, {label})`.

## References (prompt) — image, 3D and video

The Prompt card has **three** optional reference dropzones, stacked in this order: **Reference image**
(`#refRow`), **3D reference** (`#ref3dRow`) and **Reference video** (`#refVideoRow`). Each attaches via
click-to-choose or drag-drop (the row drop handler `stopPropagation`s so the global drop doesn't build
a model) and has a thumbnail + clear (×) button. `wireRefRow(row, onFile)` factors out the drag wiring.

State: `state.ref = {dataUrl, blob, name}`, `state.ref3d = {dataUrl, blob, name, bytes}` (dataUrl is a
render of the model), `state.refVideo = {blob, url, name, duration, time, dataUrl}` (dataUrl is the
chosen frame).

The text-to-image-plugin's own `referenceImage` option is **deliberately disabled server-side**
("NO EFFECT... Don't build img2img flows on it"), so all three are implemented via the `ai-text-plugin`
vision path instead: `describeReference(blob, kind)` captions the picture as a compact comma-separated
keyword list (`kind` = `"image" | "3d" | "video"` only changes the lead-in sentence), and
`requestImage()` folds every description into the prompt:

```
full = [userPrompt, ...refParts, style.keywords].filter(Boolean).join(", ")
```

So attachments steer the generated image's subject/style, and a reference alone (empty prompt) is
enough to generate. If a caption call fails, it degrades to the prompt alone with a toast.

- **3D reference** — any model file (GLB/GLTF/OBJ/STL/FBX/PLY/DAE). `setRef3dFromFile()` parses it with
  `loadModelFile`, normalises it, renders a 240×170 preview with the shared `createThumbRenderer`
  (`src/thumb.js`), stores that render as the ref blob, and disposes the parsed tree.
- **Reference video** — any `video/*` file. `setRefVideoFromFile()` decodes it with `openVideo`
  (`src/video.js`) — **WebCodecs, not a `<video>` element**, because the editor preview never loads
  media through an element — then `refreshRefVideoFrame(t)` grabs the frame at time `t` and stores it
  as a JPEG. A **frame slider** (`#refVideoFrame`) re-captures as you drag so you can pick the exact
  pose/frame that should guide the image.

Exposed for testing as `textTo3d.setReference(dataUrlOrFile, name)`, `clearReference()`,
`describeReference()`, `get ref`, and the 3D/video pair `setReference3d(file)` / `clearReference3d` /
`get ref3d` and `setReferenceVideo(file)` / `setReferenceVideoTime(t)` / `clearReferenceVideo` /
`get refVideo`.

**Fallback:** a **background/hidden tab throttles media loading**, so a `<video>` may never fire
`loadedmetadata`/`loadeddata` and `videoWidth` stays 0. When WebCodecs is unavailable (or a codec is
rejected) `setRefVideoFromFile` uses the old `<video>` path: `loadVideoEl` has a 12 s timeout and
rejects rather than hanging, `drawVideoFrame` returns `null` when there is no frame, and the whole
thing tears down + toasts instead of storing a blank frame.

## Video decoding — WebCodecs instead of `<video>` (`src/video.js`)

Two features read frames out of a video the user attaches: the prompt card's **Reference video**
(one frame guides the image) and the AI panel's **Vision** tab (a video becomes an N-frame contact
sheet the model reads as a sequence). Both used to load the file into a `<video>` element and seek —
which works in a normal browser but **never completes in the editor preview**, where media loading is
throttled and `loadedmetadata`/`loadeddata` never fire.

`src/video.js` sidesteps the element entirely: **WebCodecs `VideoDecoder` works even in the hidden
preview**, so the container is demuxed and the frames are decoded directly. `mediabunny` (by the same
author as `mp4-muxer`) does both — it parses mp4/mov/mkv/webm/… and hands back decoded frames as
canvases via `CanvasSink`, which is exactly the shape the app wants.

```js
const v = await openVideo(file);          // null → caller should use the <video> path
v.duration; v.width; v.height; v.codec;
const canvas = await v.frameAt(t);        // HTMLCanvasElement | null
const frames = await v.framesAt([t1, …]); // batch, for a contact sheet
v.dispose();
```

- `openVideo` is **lazy**: `mediabunny` is dynamically imported on first use, so a few hundred KB stay
  out of the app's boot. It returns `null` (never throws) when WebCodecs is missing, the file has no
  video track, or the codec won't decode — and both call sites then fall back to their `<video>`
  implementation, which is still the right path in a normal browser.
- Use the **sync properties** `track.displayWidth` / `track.codedWidth` (and the height/codec
  equivalents). The `getDisplayWidth()` / `getCodec()` methods are **async** (they return Promises),
  and passing a Promise as `CanvasSink`'s `width` throws "must be a positive integer".
- `frameAt(t)` clamps `t` into range and returns the frame nearest that time in seconds; it catches
  per-frame decode errors and returns `null` rather than rejecting.

Verified end-to-end **in the preview** (encode a real H.264 MP4 with `mp4-muxer` + `VideoEncoder`,
then read it back): the reference frame decodes, seeking to a different time yields a different
frame, and a 12-frame vision contact sheet shows 12 distinct, correctly-ordered frames.

## Realism layer (`src/environments.js` + `src/render-fx.js`)

The look of a generated model is decided by what it reflects, how it is lit and what happens to the
pixels afterwards. That whole stack is one card, **Realism** (`#realismCard`), and every change flows
through a single entry point — `renderFrame()` in `main.js`:

```js
function renderFrame() { env.refresh(); fx.render(scene, camera); }
```

`renderFrame` is what the live animation loop, the **PNG export**, the **Studio snapshot** and every
control call use, so what you see, what you export and what Studio captures are always the same
frame. `renderNow()` is a thin alias; **never call `renderer.render(scene, camera)` directly** again
(it would bypass the grade and the environment IBL update).

### Environment (image-based lighting)

`EnvironmentManager(renderer, scene)` in `src/environments.js` paints an equirectangular sky into a
2048×1024 canvas (x = longitude/wraps, y = latitude; horizon at 0.5), runs it through a
`PMREMGenerator`, and assigns the result to `scene.environment` — so every `MeshStandardMaterial`
picks up real reflections and ambient colour instead of the flat hemisphere light. Six painters:
`studio · soft · neutral · outdoor · sunset · night` (`#envSelect`). A studio soft-box gradient is
the single biggest thing that stops a reconstructed mesh reading as a flat scan, so `studio` is the
default. Controls:

- **Env light** (`#envIntensityRange`, 0.2–2.5) — `env.setIntensity(v)` → sets `envMapIntensity` on
  every material by traversal (so it scales the IBL only, not the lights).
- **Show environment background** (`#envBgCheck`) — `scene.background = envTexture` (off by default
  so the dark product backdrop stays).

`refresh()` is a no-op unless something changed; it just re-runs `scene.environment = ...` after a
preset change.

### Light rigs

`LIGHT_RIGS` is plain data for five rigs (`studio · soft · dramatic · outdoor · night`); each names a
hemisphere colour/intensity plus a key and rim light with colour/intensity/position.
`applyLightRig(name, lights)` writes them onto the three lights the app already had (`hemiLight`,
`keyLight`, `rimLight`). `#lightRigSelect` binds it.

### Post-processing (`PostFX`)

`PostFX(renderer)` renders the scene once into an offscreen display-referred RGBA8 target, then runs
a fixed full-screen shader chain to the canvas:

`grade` (exposure, contrast, saturation, temperature/tint, lift/gamma/gain) → `bloom` (bright-pass +
separable blur + additive) → `sharpen` (unsharp) → `lens` (barrel distortion + chromatic aberration)
→ `vignette` → `grain` → final blit with ±½-LSB dither.

Colour handling: the scene target is flagged `isXRRenderTarget` with a plain RGBA8 internal format,
which makes three apply its tone-mapping and sRGB output encoding when rendering *into* the target
and nothing when sampling it back — so every pass works on display-referred bytes, an empty chain is
pixel-identical to the un-post-processed viewport, and no pass can double-encode. Verified live:
`enabled:false` equals an enabled chain with all-neutral params, pixel for pixel. Effects whose
strength is 0 compile to a skipped pass, so cost tracks what is switched on.

Controls (`#fxCheck`, `#fxPresetSel`, and the 8 sliders): exposure, contrast, saturation, bloom,
vignette, grain, chromatic aberration, sharpen. `FX_PRESETS = neutral/cinematic/product/dramatic/
vintage/clean`. Dragging any slider flips the preset select to **Custom**.

**CRITICAL gotcha (do not regress):** three caches a material's `uniforms` object when it compiles
the program, so a pass MUST mutate `material.uniforms[k].value` **in place**. Replacing the whole
`uniforms` object after the first frame silently freezes that pass on the values it was born with —
`_pass(mat, target, values)` exists to do the in-place assignment.

### One-click looks (`LOOK_PRESETS`)

Seven presets bundle environment + rig + env intensity + background + fx + tone-mapping operator +
contact-shadow strength, applied by `applyLook(name)` (and `#lookPresetSel`): `studio · cinematic ·
product · outdoor · sunset · night · dramatic`. The app boots into `studio` (`wireRealism();
applyLook("studio");`).

### Render

- **Tone mapping** (`#toneMapSelect`): `aces · reinhard · cineon · linear · none`. `setToneMapping`
  sets `renderer.toneMapping` and flags every material `needsUpdate` — the operator is compiled into
  the shader, so without the flag three keeps the program the material was born with.
- **Contact shadow** (`#shadowRange`, 0–0.8): `setShadowStrength` scales the ground's
  `ShadowMaterial.opacity` — how strongly the model sits on / darkens the floor.

### Material

Two sliders (`#matRoughRange`, `#matMetalRange`) override `frontMat`/`solidMat` roughness & metalness;
`state.matTouched` gates it so a rebuild keeps the user's material. Set by `applyMaterialOverrides()`
(called from `applyShading`). **Reset look** (`#fxResetBtn`) restores `studio`, disables fx, and
clears the material override.

### Scripting

`textTo3d.look` = `{ setPreset, setEnv, setEnvIntensity, setEnvBackground, setLightRig,
setToneMapping(op), setShadowStrength(v), setDetail(patch), setFx(patch), setFxPreset(id), get params,
get detail, get fx, get env, get fxEngine }`.

## Realistic model files — derived material detail (`src/material-maps.js`)

The viewer realism layer makes a model *look* good on screen; this layer makes the **files
themselves** more realistic. A reconstruction (or any imported photo-textured mesh) ships exactly
one base-colour texture and a single roughness value — a perfectly smooth surface wearing a photo.
That flatness is what makes an export read as a "scan" instead of a real object: there is no
micro-relief for light to catch and no crease darkening to ground the form.

`deriveDetailMaps(source, {size, normalStrength, aoStrength})` derives the two missing maps from the
base colour (its luminance is a cheap height proxy):

- **Normal map** — Sobel gradient of a **band-passed** height field (`luminance − broad blur`),
  normalised to unit standard deviation. The band-pass keeps weave/pore/strand-scale detail and
  drops the photo's broad baked shading — embossing *that* would "double" the original lighting for
  free (the classic albedo→normal mistake, and visibly the difference between a crisp relief and a
  smudged one). Normalising means `normalStrength` behaves the same on any image regardless of
  contrast.
- **AO / cavity map** — how far each pixel sits below its blurred neighbourhood; darkens crevices.

Applied in `applyDetailMaps()` (called from `applyShading`, so it runs after every build/load and
shading change) to **every `MeshStandardMaterial` in `modelGroup` that has UVs and does not already
ship its own map** — so it works for both the relief build and dragged-in GLBs, and never clobbers a
file's own normal map. Original maps are stashed on the material's `userData` and restored when the
feature is turned off. `ensureUv1(modelGroup)` mirrors `uv` into `uv1` because this three build's
`aoMap` samples the second UV set.

Controls (**Realism → Material detail**, `#detailCheck` / `#detailNormalRange` / `#detailAoRange`,
on by default at 0.8 / 0.5): the toggle plus normal and AO strengths. It resets with **Reset look**.
Scripting: `textTo3d.look.setDetail({ enabled, normalStrength, aoStrength })` and `look.detail`.

**It ships in the export.** `GLTFExporter` writes these as `normalTexture` (scale = normalStrength)
and `occlusionTexture` (strength = aoStrength), adding `TEXCOORD_1`; verified by re-parsing an
exported GLB (3 textures: base colour + normal + occlusion, both primitives carrying `TEXCOORD_1`).
So the GLB/PLY you hand to Blender now carries surface detail, not just a flat picture.

## Viewer notes (`src/main.js`)

- Renderer uses `preserveDrawingBuffer: true` (needed for the PNG export and for vision checks).
- The relief mesh has `castShadow = true` but **`receiveShadow = false`** — self-shadowing on a
  bumpy relief produced shadow acne. Don't turn it back on.
- Depth inference is on the main thread (~2.5 s warm). The model is warmed up lazily on the first
  `pointerdown` / `keydown` / `focusin` (or after 15 s) so a cold first load never blocks. Moving
  inference into a module Worker would remove the remaining stall.
- Auto cut-out can add a second main-thread wasm pass (RMBG-1.4, ~5-8 s for a 512×768 image) on top
  of depth; together they can block the main thread long enough that the editor's live-preview
  watchdog reports the page as "frozen". It isn't an infinite loop — it recovers. The flat-backdrop
  key skips that wasm pass entirely for studio-background images (and is the more accurate of the
  two), so in practice it usually doesn't run. Moving both pipelines into a Worker is the durable fix.
- `modelGroup` must contain at most one model: `buildMesh` calls `clearModel()` first. (Previously
  a dropped 3D file survived a later image build, which broke framing and exports.)

## Blender interop (drag & paste, both ways)

The app is a two-way bridge with Blender and other DCC tools.

**Blender → generator**
- **Drop** an exported file anywhere on the page. `loadModelFile` accepts Blender's native exports:
  **GLB/GLTF** (Blender's glTF 2.0 exporter — the recommended one), **OBJ**, **STL**, **FBX**,
  **PLY** (vertex colours preserved) and **DAE/Collada**. It also reads Blender's **own `.blend`
  files directly** (see below), so no export step is required. Dropping an image still runs image→3D,
  and a `.txt` loads as a prompt. The drop overlay lists the formats; the file picker's `accept`
  matches.
- **`.blend` files** (`src/blend.js` + `src/blend-rig.js`) are parsed natively — SDNA-struct
  reflection via `jsblender`, so the same code reads Blender **2.8 through 5.x**, and gzip-compressed
  old files are inflated with `DecompressionStream`. What comes through:
  - **Geometry** — every mesh object in the scene, unwelded per face-corner so **per-corner UVs and
    vertex colours survive**, then angle-limited-smooth normals; `material_index` becomes geometry
    groups. Blender **5.x** uses `attribute_storage`; **2.8–4.x** uses the CustomData layer stacks
    (`mloop`/`mvert`/`mpoly`, or the 4.x named layers); **pre-2.63** files (no `mloop` at all) are
    read by the self-contained legacy **MFace/MTFace/MCol** path (`readMFaceGeometry`), which is what
    makes e.g. a Blender 2.48 file import as real geometry instead of nothing.
  - **Rig** — a mesh's modifier armature is resolved to its bone tree, export-parent relationships
    are followed, and skin weights come from **`vertex_group_names`** (newer) or **`defbase`**
    (2.6x). The result is a real three `SkinnedMesh` with `skinIndex`/`skinWeight`, not a static pose.
  - **Animation** — every **action** is baked into a per-frame `AnimationClip` at the scene's fps
    window (modern `FCurve` lists *and* Blender 5.x `layer_array` stacks), and object-level actions
    become object-transform clips. So a `.blend`'s animation lands in the **Animation** panel /
    Studio timeline exactly like a GLB's.
  - **Materials/textures** — material base colours + packed images are applied.
  - **Known limitation (deliberate):** **animation from pre-2.63 files** (Blender 2.4x) is *not*
    read — those store keyframes in `bAction.chanbase`/`IpoCurve` (a different struct family; `FCurve`
    does not exist there). 2.4x **geometry, rigs and skin weights** still import.
- **Paste** (Ctrl/Cmd+V): a file copied in Blender's file browser / the OS file manager arrives via
  `clipboardData.files` (or a `file` item) and loads exactly like a drop; the `text/uri-list` form
  (Linux/GNOME) is read too. Pasting a plain http(s) link to an image/model fetches and loads it
  (`handleUrl`, CORS-permitting). Pasting **text** is only intercepted when focus is *not* in an
  `input`/`textarea`, so typing/pasting into the prompt box is untouched.

**generator → Blender**
- Export buttons: **GLB**, **PLY**, **STL**, **OBJ**, **PNG** (GLB keeps the colour texture, PLY
  keeps vertex colours — both Blender-importable; STL is watertight for printing).
- **GLB export keeps the rig and its animation.** `toGLB` in `src/exporters.js` gathers every
  `AnimationClip` off the export tree (`collectAnimations`, de-duped by identity) and hands them to
  `GLTFExporter` as `options.animations` — three's exporter does **not** collect clips on its own, so
  without this a rigged/animated model exported to a silent static GLB. Round-trip verified: a rigged
  cylinder → GLB → re-import comes back with `skins:1`, the same bones, and its `SkeletonAnimation`
  clip replayable. Works for `toGLB(modelGroup)` and `toGLB([modelGroup, sceneBase.group])` (the
  *Include Blender scene base* form). When animations are present the exporter forces `trs:true`.
- **Drag the model out**: the dashed "Drag the model into Blender / your desktop" chip in the Export
  card (`#dragOutBtn`) is a native drag source carrying a real `.glb` `File`. Browsers require the
  file to be added to the `DataTransfer` *synchronously* in `dragstart`, so the GLB is built ahead of
  time: `setExportsEnabled(true)` → `scheduleDragFile()` (debounced 700 ms) → `prepareDragFile()`
  caches `new File([await toGLB(modelGroup)], …, {type:"model/gltf-binary"})`; `dragstart` then calls
  `dataTransfer.items.add(dragFile)` (plus a `text/plain` name) and toggles `body.dragging-out`.
  Dragging it to the desktop / a file manager saves the `.glb`, which Blender imports via
  **File ▸ Import ▸ glTF 2.0**. Until the file is ready the chip is `draggable="false"`, dimmed, and
  `dragstart` is prevented (`prepareDragFile` is re-run). `items.add` is Chrome/Edge; where it is
  unsupported the drag degrades to carrying the file name only.

## Studio mode (`src/studio.js`)

An optional Blender-style editing workspace layered over the viewport. Toggled by the `Studio`
button next to the brand (`#studioBtn`) / `textTo3d.setStudioMode(true)`. It hides `#panel`, shows
`#studioLayer` (an absolutely-positioned HUD inside `#stage` with `pointer-events:none` except for
its interactive children, so the canvas still gets orbit/gizmo events), and auto-selects the model.

- **Gizmos** — `TransformControls` from the same pinned three build (re-exported by `src/three.js`).
- **Outliner / Properties** — object tree + Object/Material/World/Animation/Render inspectors. The
  outliner also lists a **Blender Base** collection (📐), fed from `src/scene-base.js` — see below.
- **Timeline** — 9 procedural presets (None/Idle/Turntable/Bob/Sway/Breathe/Float/Wobble/Tumble)
  whose `apply(obj, phase)` mutates a captured rest transform each frame; channels are drawn as
  SVG F-curves with a scrub-able playhead.
- **Armature / rig integration** — when the loaded model is rigged, Studio grows a whole skeletal
  side: an **⛭ armature toggle** in the left strip shows/hides the skeleton overlay (it is shown
  automatically on entering Studio), the **Outliner** grows the rig's bone hierarchy as an indented,
  name-labelled, collapsible branch under the Model entry (see `appendBoneTree`/`boneItem`), and a
  bone can be selected by clicking it in the viewport *or* the outliner. A selected bone is a real
  editable object: the gizmo attaches to it and moving/rotating/scaling it poses the `SkinnedMesh`
  live (three drives the skin from the bones' `matrixWorld`).
- **Skeletal clips in the timeline** — the model's own `AnimationClip`s (e.g. the toga's baked
  `toga_saline_testAction`, i.e. a mocap take) are surfaced as extra timeline presets
  (`rebuildSkelPresets()` → `skelPresets`), listed first. Choosing one plays it on the rig's mixer;
  playback is advanced by the app's main loop (`rig.update(dt)`), and Studio's `update()` just reads
  `rig.time` back into the playhead, so the timeline's play/scrub/speed controls drive the armature
  exactly like they drive the procedural object presets. `getRig` is passed into `initStudio`.
- **Shading modes** — delegates to `main.js`'s `applyShading(mode)` (rendered/solid/material/wire).
- **Scripting console** — `AsyncFunction` sandbox with `add/remove/objects/select/move/rotate/
  scale/color/anim/play/pause/time/view/camera/log` plus `THREE`/`scene`.
- **Read me** — a workspace tab (and a 📖 strip action) that opens `src/README.md` **live** (this
  document) and renders it with `marked` (falling back to a raw `<pre>` if that import is
  unavailable). It is the project's memory made reachable from inside the app, so the architecture
  and gotcha notes are one click away for the user and for a future agent. `Copy Markdown` puts the
  raw file on the clipboard; `Reload` re-fetches. Wired through `setReadmeOpen`/`loadReadme` and
  exposed as `textTo3d.studio.openReadme()`, `setReadmeOpen(v)`, `loadReadme(force)`,
  `get readmeOpen`. The workspace tabs share one selection helper (`setWsActive`), so Read me and
  Scripting are mutually exclusive overlays.

### Studio gotchas (do not regress)

- **TransformControls mode strings are `translate` / `rotate` / `scale`** — NOT `move`. The UI uses
  `move`, mapped through `TC_MODE`; passing `move` straight through makes `tc.picker.move`
  undefined and throws in `updateMatrixWorld` every frame.
- The playhead element is (re)created inside `buildTimeline()` *after* it clears `#sTlTracks`
  (`innerHTML = ""`), because that clear also removed the playhead declared in `TEMPLATE`.
- Add-primitive meshes live in `modelGroup` (so they export with the model). `onModelChanged()`
  prunes `extraObjects` entries no longer in `modelGroup` and re-selects the model, otherwise a
  rebuild leaves `selected` pointing at a disposed mesh (invisible gizmo, stale outliner).
- `setStudioMode` also forces `#emptyState` hidden while in Studio.
- **Studio exit goes through the `onMode` callback**, not `api.setMode` directly (same for the base
  toggle, via `onBaseChange`). The studio's own header **Exit** button used to call `api.setMode(false)`
  and leave `#app` stuck with the `.studio` class (studio layout, no panel). `studio.setMode` now calls
  `onMode(on)` and `main.js` supplies it (updating `#app`, `#studioBtn`, `#emptyState`, and resizing).
- **A rigged model's bounds must be measured *after* `updateMatrixWorld(true)`** (see the Armature
  section) — `sceneCenter` / `frameSelected` in Studio both rely on that, and `frameSelected` also
  works for a selected *bone* (a bone has a world matrix but no geometry).
- **Bones are not in the outliner's flat model list** — they are `Object3D`s buried inside the
  model's own group tree, so `pick()` raycasts the overlay's instanced meshes first (`instanceId` →
  bone index) and `renderOutliner()` appends the bone tree separately. Don't "fix" `pick` by adding
  bones to its target list; the overlay is the only cheap hit-test for them.
- A bone selected in Studio is a normal `Object3D` for the transform inputs, but it has no geometry,
  so `syncProps` correctly shows `—` for Verts/Faces. `resetToRest`/`captureRest` already work on any
  `Object3D`; the delete-key path is explicitly guarded so a bone can never be "deleted".

## Studio add-ons — Mixamo / MetaHuman / MetaRforge (`src/studio-addons.js`)

The Studio's **Add-ons** workspace tab (🧩 strip action, `data-ws="addons"`) opens a Blender-style
add-on manager: a left column of add-on cards (icon, name, version/author, blurb, tags, an **Enabled**
checkbox) and a right pane that renders the selected add-on's tool. Enabled ids persist in
`localStorage` (`tt3d.studio.addons`). `createStudioAddons(ctx)` is instantiated by `studio.js` (lazily,
after `wire()`); `studio.js` owns the panel/visibility (`setAddonsOpen`, mutually exclusive with the
Scripting/Read-me tabs) and calls `addons.tick()` from its `update()`. API: `textTo3d.studio.addons`
→ `mount/tick/select/setEnabled/isEnabled/enabledIds/selected/render/list/state` plus the programmatic
`humanPrompt/generatePortrait/buildHuman/playMotion/forge/bind/removeMetarig` hooks.

The three add-ons are honest browser equivalents of the Blender concepts, built from the app's own
primitives (they are **not** Blender extensions):

- **Mixamo Bridge (v2.1.0)** — imports a rigged character (FBX/GLB/GLTF/DAE via `fromFiles`) and shows
  the active rig's bone/clip counts, then **retargets the procedural motion library** (`src/motion.js`)
  onto whatever humanoid rig is loaded (the motions are role-based, so they play on any skeleton), with
  a playback-speed slider, loop toggle and stop.
- **MetaHuman Creator (v1.4.2)** — parameterised human (sex/age/skin/build/hair/outfit + presets),
  builds a prefix-cache-friendly prompt, calls `window.root.generateImage` for a portrait
  (`generatePortrait`), then hands it to the app's AI 3D pipeline (`fromAiImage`, `buildHuman`).
- **MetaRforge (v0.9.3)** — the auto-rig. `forge()` builds a **Mixamo-standard 22-bone humanoid
  metarig** from `humanoidSpec()` (Root→Spine chain→Neck→Head, shoulders/arms/forearms/hands,
  up-legs/legs/feet/toes; optional fingers), scales/positions it to the model's bounding box, and
  installs it as the active rig. `bind()` skins the model to it with **proximity auto-weights**
  (per-vertex 4 nearest joints, inverse-square). `removeMetarig()` restores the originals.

`humanoidSpec(opts)` returns a flat, Mixamo-named bone list as fractions of the fitted height
(hips 0.52, chest 0.735, neck 0.845, head joint 0.885, ankle 0.045) so the rig scales to any model;
`bonesFromSpec` turns it into real `THREE.Bone`s.

### Studio add-ons gotchas (do not regress)

- **Two functions were both named `select`** (the DOM `<select>` helper and the add-on dispatcher) — the
  later declaration hoisted over the helper, so `row("Sex", select(...))` silently passed `undefined`
  to `appendChild` and MetaHuman/MetaRforge threw on open. The DOM helper is now `selectEl`; keep the
  dispatcher named `select`. Watch for same-name collisions between the small DOM helpers (`el`,
  `row`, `selectEl`, `range`, `btn`, `chip`) and the control/dispatch functions.
- **The metarig holder trick:** a `Skeleton` needs a `SkinnedMesh`, so `forgeMetarig` adds a hidden
  `SkinnedMesh` with a degenerate 3-vertex geometry ("MetaRforge Metarig") to hold the bones; binding
  the real mesh to that skeleton is what makes `armature.js`'s `createRig`/`analyzeRig` pick it up as
  the active rig. `refreshRig()` then rebuilds the overlay + `motions.setRig`.
- **`bindModel` hides the original meshes** (sets them invisible, does not delete them) and creates
  `"<name> · metarig"` `SkinnedMesh` copies; `remove()` restores the originals.
- `state()` deliberately masks the portrait `dataUrl` (returns `"yes"`/`null`) so a debug dump doesn't
  carry a 90 KB base64 image — read the thumbnail `<img>` in the DOM if you actually need the pixels.

## Blender scene base (`src/scene-base.js`)

A **reference scene** modelled on Blender's default startup file, so a generated model can be
previewed (and optionally exported) sitting on the same floor/orientation cues a Blender user
expects. `createSceneBase()` returns a `{ group, floor, props, axes, origin, cube, camera, light,
entries, isEnabled, setEnabled, setStudio, setFloorY }` handle, added to the scene in `main.js` and
passed to `initStudio` as `sceneBase`.

**Floor gizmo** (`group`, always present when enabled):
- **Axes** — X and Z are *full-length lines spanning the grid* (`GRID_HALF = 12`), red `0xff4d4d`
  and blue `0x4d8bff`; Y is a green `0x53d769` vertical line with a cone arrowhead (`AXIS_LEN = 4.4`).
- **Origin** — a whitish ring (`0xdfe6f2`) with a small red dot at its centre, drawn with
  `depthTest:false` / `renderOrder:12` so it always shows through, like Blender's 3D cursor.

**Default objects** (`props`, shown only in Studio): a starter **Cube** (grey, 0.9³, resting on the
floor at `(-1.95, 0.45, 0.75)` — deliberately offset so it never overlaps the model at the origin),
a **Camera** marker (body + lens cone + wireframe frustum) and a **Light** marker (yellow sphere +
radiating spokes). Each carries `userData.studioName` (`"Cube"` / `"Camera"` / `"Light"` / `"Axes"`
/ `"Origin"`) so the studio outliner can list them under **Blender Base**.

**Toggles** (both default **ON**):
- `#baseCheck` in the **Look** card ↔ `sceneBase.setEnabled(on)`.
- `#sBaseChk` in **Studio → World → Blender scene base** ↔ the same, wired through `onBaseChange` so
  the two checkboxes stay in sync (rAF is throttled in the hidden preview iframe, so this sync is a
  callback, not a per-frame poll — see harness notes).

`props` visibility is `baseOn && studioOn`, so the cube/camera/light markers only appear in Studio;
the floor gizmo shows in both the plain viewer and Studio.

**Two details that matter (do not regress):**
- The flat axes must be lifted off the grid by `+0.006` (`setFloorY` adds it) or they **z-fight** the
  grid lines and shimmer. `frameObject()` calls `sceneBase.setFloorY(box.min.y - 0.012)` so the base
  follows the model's ground plane.
- The base lives in its own `group`, **separate from `modelGroup`**, so it is *not* part of a normal
  export. The Export card's **Include Blender scene base in GLB** (`#exportBaseCheck`, default
  **OFF**) is the only way it gets in: `exportGlbBlob()` (`glbIncludeBase()` / `exportGlbBlob()`,
  used by `doExport("glb")`) temporarily forces the base group + all `entries` visible, exports
  `toGLB([modelGroup, sceneBase.group])`, then restores the previous visibility. GLTFExporter emits
  benign *"Use MeshStandardMaterial or MeshBasicMaterial for best results"* warnings for the base's
  `Line` materials — expected, not an error.

## Test assets (`Tests` button, `src/test-assets/`)

The generator ships a set of real fixtures captured during development so the whole
image→3D→export pipeline can be exercised without any external files. They live in
`src/test-assets/` and are indexed by `src/test-assets.js`:

- **8 input images** (`image-01…08.jpg`) — the sources used for image→3D test runs.
- **8 model exports** (`model-01…08.glb`) — the GLBs those runs produced, each self-textured
  (front + solid shell) so it describes itself.
- **1 high-poly solid-volume export** (`model-solid-01.glb`, ~113k verts).

> These are `src/` files, so they are **public** and count against the generator's storage quota
> (~21 MB). The sample images are adult/NSFW test captures — delete `src/test-assets/` (and the
> `Tests` button usage) if the generator is published somewhere that shouldn't serve them.

The **Tests** button next to *Studio* opens an in-app browser (`src/test-panel.js`,
`textTo3d.tests`): image cards each offer **Build 3D** (runs the pipeline from the bundled URL) or
**Reference** (feeds it into the next prompt); model cards render a real thumbnail (a small shared
`WebGLRenderer` frames each GLB), print vertex/triangle/texture counts, and offer **Load** /
**Download**. **Run self-check** fetches every fixture and verifies the images decode and the GLBs
parse, reporting `N/N fixtures OK`.

Programmatic use:

```js
const { TEST_IMAGES, TEST_MODELS, testImageFile, testModelFile } = await import("./src/test-assets.js");
await textTo3d.fromImage(TEST_IMAGES[0].url, "sample");       // or textTo3d.fromFiles([file])
await textTo3d.tests.runSelfCheck();                          // { summary, results }
textTo3d.tests.open();                                        // the overlay
```

Note: **Build 3D** on a test image runs the depth (and possibly matte) pipeline on the main thread,
which can stall the editor's live-preview watchdog for a while — that's the same long-standing
main-thread behaviour described under *Viewer notes*, not a fault of the fixtures.

## Persistent library (`Library` button, `src/library.js`)

Every file the user **imports, drags, pastes or uploads** (image or 3D model) is automatically
saved to the browser's IndexedDB through the **kv-plugin**, so it survives reloads and browser
restarts — no more re-dropping a file after a refresh. The **Library** button next to *Tests*
opens an overlay (`textTo3d.library`) that lists everything saved, newest first.

Storage layout inside the `kv.library` folder:

- `"index"` — an array of light metadata records (id, name, kind, mime, ext, size, addedAt,
  thumbnail data-URL, stats). Read once at boot so listing is instant.
- `"asset:<sha256>"` — the raw bytes of one asset. **Content-addressed**, so re-importing the same
  file never duplicates it, and loading an asset back from the library does not re-add it.

The overlay offers **Add files** (multi-select picker), **drag-and-drop onto the overlay**,
per-card **Load** (image → 3D, or open a model in the viewer), **Use as reference** (images),
**Save** (download the original file) and **×** (remove), plus a **Clear** button. Model cards get
a real offscreen thumbnail rendered through `src/thumb.js` (the same renderer the Tests panel uses).

Model metadata also records a **rig verdict** (`meta.rig`), computed with `analyzeRig` while the
thumbnail is built: `{ rigged, sig, bones, skinned, clips }`. Rigged cards show a teal
`rigged · N bones · M clips` badge (signature in the tooltip) so the library itself "understands"
which files carry a skeleton — that verdict is part of the persistent index, so it is only computed
once. Models imported before this existed are backfilled (once, sequentially, in `backfillRigs()`)
the first time the overlay is opened; unrigged models are remembered as `{ rigged: false }` so they
are never rescanned.

Auto-persist lives in `handleFiles` (`src/main.js`): the image and model branches call
`library.addFile(file)` after a successful load — unless the load came *from* the library
(`skipLibrary: true`), which the content-address dedupe would no-op anyway. Text/`.txt` files are
used as prompts and are not stored.

Programmatic use:

```js
await textTo3d.library.addFiles([file]);          // or addFile(file)
textTo3d.library.list();                          // metadata array (no bytes)
await textTo3d.library.loadAsset(id);
textTo3d.library.open(); textTo3d.library.close(); textTo3d.library.toggle();
await textTo3d.library.remove(id);                // and .clear()
const bytes = await textTo3d.library.getBytes(id); // Uint8Array | null
```

> Files can be large (a 4M-vertex FBX is tens of MB) and are stored **per-device, per-user** in
> IndexedDB — nothing is uploaded. `kv`'s quota is the browser's IndexedDB quota (hundreds of MB),
> independent of the generator's own storage limit.

## Add-ons — the extension catalog (`src/addons.js`)

The same Library overlay has a second tab: **Assets** (the file library above) and **Add-ons** —
a searchable, category-filtered catalog of small extensions that hook into the *running* app. A
count badge on the tab shows how many are enabled. Enabling an add-on calls its `activate(api)`
and its buttons/settings appear on its card; disabling tears every hook down cleanly.

The enabled set is persisted per-device through the kv-plugin in the `kv.addons` folder under the
key `"enabled"` (an array of ids), so a chosen toolset survives reloads. Nothing is downloaded or
installed — every add-on ships inside the generator.

The API handed to `activate`:

```js
activate(api) {
  api.app;                                        // live window.textTo3d API (scene, camera, renderer, model, rig, anim, look, library, export, setSize, render, …)
  api.THREE;                                      // the pinned three namespace
  api.toast("done");                              // the app's transient toast
  const off = api.addAction("Top", run, { title: "…", primary: true }); // button on the card
  api.setPanel(node);                             // a DOM node rendered as the add-on's settings
  const stop = api.onFrame((dt) => { … });        // once per rendered frame; auto-removed on disable
  api.onDispose(() => { … });                     // extra teardown
}
```

Every hook an add-on registers is tracked and released automatically on disable — an add-on only
has to describe what to *do*, not how to clean up after itself.

The eight built-in add-ons:

- **Stats HUD** (`Utility`) — on-canvas overlay: fps, vertex/triangle counts, mesh and bone counts, clip count.
- **View presets** (`View`) — one-click Front / Back / Left / Right / Top / Bottom / Iso camera framings.
- **Turntable render** (`Render`) — orbits the camera and stitches N frames into a horizontal sprite-sheet PNG (temporarily squares the viewport, then restores it).
- **Auto-ground** (`View`) — drops the model so its lowest point sits on the ground plane.
- **Auto-play animation** (`Animation`) — starts the first clip as soon as a new model with clips loads.
- **Material presets** (`Material`) — swatches (Clay, Matte, Shiny, Metal, Glass, Toon-ish) applied to the model's standard materials.
- **Export all formats** (`Pipeline`) — writes GLB, OBJ+MTL, STL and a JSON report in one click.
- **Look randomizer** (`Material`) — randomizes the current look/tone settings for quick variation.

Programmatic use:

```js
textTo3d.addons.list;                // catalog (metadata + enabled flag)
textTo3d.addons.count;               // number enabled
textTo3d.addons.isEnabled("stats-hud");
await textTo3d.addons.enable("turntable");   // .disable(id) / .toggle(id)
textTo3d.library.showTab("addons");  // open the overlay straight to the Add-ons tab
textTo3d.library.showAddons();       // same
```

The add-on list lives in `BUILTIN_ADDONS` (an array of descriptor objects) in `src/addons.js`;
adding a new one is a matter of appending a descriptor with its `activate(api)`.

## Guided workflow (`Workflow` button, `src/workflow.js`)

The app is powerful but wide — the prompt, image, reconstruction, look, rig, animation and export
each live in their own card or overlay. The `Workflow` button (brand row, left of *Tests*) turns
them into **one ordered, stateful flow**: seven steps from a blank idea to a finished, animated,
exported model.

The steps (and the condition that marks each done) are:

| # | Step | Done when |
|---|------|-----------|
| 1 | Idea | the prompt is non-empty, or any reference (image / 3D / video) is attached |
| 2 | AI image | `app.generatedImage()` exists |
| 3 | 3D model | `app.info().hasModel` |
| 4 | Look | a model exists (optional) |
| 5 | Rig | `app.rigInfo()` reports bones (optional) |
| 6 | Animate | a motion is playing or ≥1 keyframe is authored (optional) |
| 7 | Export | something was exported this session |

The header shows `N/7 done` plus a progress bar; each rail item gets a `✓` badge once its condition
holds, and the current step's chip reads `✓ done` / `optional` / `to do`. Every step's body is a
**thin mirror, never a second source of truth**: the prompt textarea writes straight to the real
prompt box, the resolution/quality/cutout controls drive the same state, the Look chips call
`applyLook`, the mesh/export buttons call the very same `buildFromImageSrc` / `doExport` the panel
buttons call, and the Animate chips call `motions.play`. So a step flips to done the **instant** its
result exists, however it was produced (Workflow, left panel, drag-drop, paste, script). A 700 ms
poll (`startPoll`, only while open) keeps the rail and chip honest without any manual sync.

`runAction(fn, advanceTo)` runs a step's task, refreshes the status, and auto-advances when the
target step became done (e.g. "Build from image" advances you to *Look* the moment the mesh lands);
`go(i)` renders a step and persists the chosen step in `kv.workflow`, so reopening (or reloading)
returns you where you were. Escape closes it. The overlay reuses the shared `testsOverlay` /
`testsSheet` chrome and stacks to a single column with a horizontally-scrolling rail below 720 px.

Scripting: `textTo3d.workflow` — `open()`, `close()`, `toggle()`, `go(i)`, `refresh()`, `get step`
(the current step id), `get isOpen`.

## Armature — understanding a rigged model (`Rig` button, `src/armature.js` + `src/rig-panel.js`)

A rigged file (FBX / GLB / GLTF / DAE with a skeleton) is not one mesh: it is a bone tree plus one
or more `SkinnedMesh`es and usually animation clips. The **Rig** button (next to *Library* /
*Studio*) opens the **Armature** workspace, which is the app's window into that structure.

`analyzeRig(root)` walks the loaded `modelGroup` and reports: the bone array (the skeleton with the
most bones wins when a file contains several), parent/child indices, per-bone class
(`classifyBone` → head / spine / arm / leg / tail-extra / other), the clips, and stats
(bones, skinned meshes, vertices, triangles). It also builds a short stable **signature** — an FNV-1a
hash of the bone-name list — which is what room assignment and pose compatibility are keyed on.

`classifyBone` names bones by anatomical family with ordered regexes (head wins over arm over leg
over spine over tail-extra). The rules are deliberately broad so foreign rigs still read: face-muscle
names count as **head** (`levator`, `orbicularis`, `oculi`, `temporalis`, `risorius`, `oris`, plus the
usual `eye`/`jaw`/`tongue`), `metacarpal`/`phalanx`/`knuckle`/`scapula` count as **arm**, `fesse`/
`glute`/`buttock`/`sole`/`pelv…` count as **leg**, and soft tissue
(`breast`/`sein`/`teton`/`nipel`/`nipple`/`boob`) counts as **spine**. Genital / helper bones with no
matching family stay **other** — so even a 240-bone rig reads at a glance.
Note the head rule uses `ear(?!m)` (not `ear`): bare `ear` also matched **`ForeArm`/`forearm`** and
classified the forearm as *head*, which broke motion.js/ai-anim's arm chain on Mixamo rigs. Keep the
negative look-ahead.

`createRig({root, overlay, size})` wraps that in a live controller:

- **Skeleton overlay** — one `InstancedMesh` of octahedral bone shapes plus one of joint spheres
  (2 draw calls for 240 bones), placed in a dedicated `rigOverlay` group on the *scene*, never in
  `modelGroup`, so it can never leak into an export. Bones are colour-coded by role, and the width
  is a global slider. Its materials use **`depthTest:false` + `renderOrder:6`** so the bones draw
  *over* an opaque character — otherwise a rig inside a solid skinned mesh (e.g. the toga) is
  completely invisible. The overlay is also the picking target, so this is what makes bones
  clickable through the body.
- **Armature repair (`repairArmature`)** — the "customized armature" pass. Some exporters (FBX,
  hand-edited GLTF) leave a skeleton's root bone *outside* the model group, so scaling/moving the
  model leaves the bones behind. `createRig` re-homes every root bone that isn't already under
  `root` (preserving its world transform) and logs to the console. It is a no-op for well-formed
  files — the toga GLB has one root bone, `root`, already parented under the model.
- **Clip mixer** — `playClip(i)` / `stopClip()` / `setClipTime(t)` / `setSpeed(v)` / `setPlaying(on)`
  over a `THREE.AnimationMixer`. The mixer root is found by walking up from the first bone for an
  ancestor carrying `animations` (glTF attaches them to `gltf.scene`, a *child* of `modelGroup`, so
  `modelGroup.animations` is empty — see the gotcha below).
- **Pose** — `capturePose()` / `applyPose(pose)` / `resetPose()`. A pose is
  `{ quats: Float32Array(n*4), deltas: Float32Array(n*3) }`, the deltas being each bone's local
  position minus its **bind** position. Capturing bind positions (rather than trusting bind ==
  current at capture time) is what makes translation-animated bones and root motion survive a
  capture→reset→apply round trip.
- **Picking** — `pickBone(clientX, clientY, camera, rect)` raycasts the two instanced meshes; the
  panel selects the hit bone in the tree and the inspector.

`main.js` keeps a single `rig` for the current model: `refreshRig()` disposes and rebuilds it, and is
called at the end of `buildMesh` / `buildAiMesh` / `showExternalObject`. The render loop calls
`rig.update(dt)` (mixer + overlay refresh) and `rigPanel.update()`. The same `rig` is handed to
Studio (`getRig`), which uses it to draw the bone tree and to drive skeletal clips (see Studio mode).

### Skinning gotchas (do not regress)

- **`Box3().setFromObject()` on a freshly-loaded skinned model measures against stale parent
  matrices**, so it reports a bind-pose extent several times too small — the toga measured 0.476
  units tall when its true bind extent is 1.597. `normalizeObject` (`loaders.js`) plus `frameObject`,
  `getModelSize` (`main.js`) and `sceneCenter` / `frameSelected` (`studio.js`) all call
  `object.updateMatrixWorld(true)` immediately before measuring. Without it, a dropped rigged GLB is
  mis-scaled (~3–4× too big) and the camera frames only its legs — this was the "toga loads wrong"
  bug.
- Multiple skeletons: `analyzeRig` picks the one with the most bones; the overlay/mixer drive only
  that one. The toga has exactly one skeleton / one `SkinnedMesh` / one root bone.

### Panel layout

Four columns, collapsing to 2 (≤1080px) then 1 (≤620px):

1. **Skeleton** — overlay on/off, colour-by-role, bone size, a role legend that carries each role's
   **bone count** (`Head · 62`), a searchable bone tree (clicking a bone selects it; the twisty
   collapses subtrees; typing filters, keeping ancestors of matches), and a bone inspector
   (name, role, parent, child count, local position).
2. **Rig** (stats) + **Animation** (clip list, Play/Pause, Stop, Time scrub, Speed).
3. **Pose** (Bind pose / Capture / Apply, Copy pose JSON) + **Shared poses** (the room's durable
   named-pose library: name → Save, Load / × per row).
4. **Shared stage** (see below) + **In the room** roster.

Viewport clicking a bone selects it even when the panel is closed, but only while the overlay is on.

## Auto-armature — forging a rig for an unrigged model (`src/auto-armature.js`)

Every other rig feature assumes a skeleton already exists (from a rigged file, or MetaRforge in the
Studio). **Auto-armature** closes that gap in the main app: it measures any staged mesh and forges a
humanoid skeleton through it, then links the mesh with automatic weights — so a raw AI / relief /
imported *unrigged* mesh becomes animatable by Motion, keyable by the Shape keys, and skinnable in the
GLB export, with no external rigging tool.

Entry points: the **Auto-armature** card at the top of the Rig workspace's Skeleton column, a button in
the Shape workspace's *Rig shape keys* block, and `window.textTo3d.autoArmature` /
`autoRig()` / `forgeArmature()` / `linkArmature()` / `removeArmature()`.

Five primitives, each usable alone:

- **`analyzeBody(root)`** — measures visible geometry. `Box3` corners give the box / height / centre;
  one vertex pass also builds a 20-band **lateral profile** (max `|x−cx|` per height band) from which
  `armSpread` is read as `shoulderBand / hipBand`, and `legStance` as the spread just above the floor
  (2–9 % of the height, so a plinth doesn't read as feet).
- **`humanoidSpec(opts)`** — a flat `[{name, parent, pos}]` standing-humanoid spec anchored to the feet
  and scaled to the model height, using classic 8-head proportions (`HUMANOID_LANDMARKS`). Spine count
  is 1–4; arms spread by `armSpread` (A-pose at 0, near T-pose at 1); optional finger/toe bones. Names
  follow **Mixamo** (`Root`/`Spine…`/`Neck`/`Head`/`LeftArm`/`LeftForeArm`/`LeftUpLeg`/`LeftToeBase`…)
  so `classifyBone` maps them to roles with no special-casing.
- **`bonesFromSpec(spec)`** — the spec as a real `THREE.Bone` hierarchy (absolute → parent-relative
  local positions).
- **`boneSegments(bones)`** — bind-pose joints as world-space capsules. A childless bone is extended
  along its own +Y by half its parent's length so leaf regions (hands, toes, head) keep their geometry.
- **`bindMeshAuto(mesh, skeleton, segs)`** — clones the geometry and writes **4-influence** skin
  weights by inverse-square **capsule** distance (not joint-point distance — that is what lets limbs
  bend along their length instead of collapsing to the elbow). Original mesh is hidden, not destroyed.

`createAutoArmature(ctx)` wraps all of that: `forge(opts)` (builds the bone tree), `bind()` (weights
every visible mesh), `generate(opts)` (both — the one-click rig), `remove()` (unlink + restore),
`state()`, `analyze()`, `setOptions({spine, fingers, toes})`. `forge` refuses a model that already
carries its own skeleton unless `{force:true}` (the panel's *Replace skeleton* button).

### Auto-armature gotchas (do not regress)

- **The bone parent must be a VISIBLE node.** `toGLB` runs with `onlyVisible:true` and three's
  `GLTFExporter` *skips invisible subtrees* — hiding the bone parent exported a skin whose `joints`
  array was entirely `null` (a broken GLB). The armature root is therefore a plain visible `Group`
  (`AutoArmature`), and a separate **hidden** `SkinnedMesh` below it (`AutoArmature · bind`) exists
  only so `findSkeletons` can discover the skeleton before the meshes are linked. Same fix applied to
  MetaRforge in `studio-addons.js`.
- **STL/OBJ/PLY must be exported through a pruned clone.** Unlike `GLTFExporter`, three's
  STL/OBJ/PLY exporters have no `onlyVisible` option and walk every mesh they can reach, so the
  invisible placeholders the auto-armature leaves in the graph (the hidden originals + the 1-vertex
  `AutoArmature · bind` proxy) both doubled the geometry and *crashed* the exporters (the proxy has
  no triangle index). `pruneInvisible()` in `src/exporters.js` now builds a cheap clone that keeps
  only visible nodes (geometry/materials shared by reference) and exports that; GLB is unaffected
  (`onlyVisible:true`). Verified on `model-01` / `model-solid-01`: 66150 / 64548 triangles before and
  after auto-rig, and volume identical (0.8577 / 0.8049).
- **Weights are approximate by design.** Auto-armature assumes a **Y-up, standing** mesh. On a flat
  relief plane the arms are placed straight down (correct for the arms-down silhouette the profile
  detects), but a photographed model whose *painted* arms are raised (e.g. `model-01`) will not match —
  no single humanoid template can. Treat it as a starting rig to pose/animate, not a match-move.
- `setOptions` is applied on the next `forge`; the panel passes the slider/toggles in explicitly.

## Muscle rig — an anatomical layer on the Auto-armature (`src/muscle-rig.js`)

**Muscle rig** builds *on top of* the Auto-armature rather than replacing it: the base skeleton is
forged exactly as before, then one extra **belly bone per muscle** is placed on the fitted joints and
bound into the *same* skin. Nothing is keyframed — each belly **swells across its own axis** (never
along it) in proportion to how far the joint it crosses is flexed, read straight off the live bone
rotations every frame. So posing by hand, an imported clip and the procedural Motion presets all make
the muscles fire for free.

Entry points: the **Muscle rig** card (`renderMuscleRig`) in the Rig workspace's Skeleton column,
and `window.textTo3d.autoMuscleRig(opts)` / `muscleRig` / `removeMuscles()` / `setMuscleFlex(on)` /
`muscleState()`. Controls are the **Bulge** slider (intensity), the **Auto-flex** toggle, and
**Forge / Remove**.

**Which muscles.** 18 definitions marked `{A}` are placed per side (→ `…L`/`…R`), 2 are centred, for
**36 bellies**: Deltoid, Biceps, Triceps, Brachialis, ForearmFlex, ForearmExt, Pectoralis,
Latissimus, Trapezius, Obliques, Gluteus, Quadriceps, Hamstring, Adductor, Gastrocnemius, Soleus,
Tibialis (paired) plus RectusAbdominis and ErectorSpinae (centre) — **58 bones total** on the base
armature's 22. Each def names the two skeleton joints it spans (`a`→`b`, `t0..t1`), a parent to
inherit motion, an outward/front offset, a `gain`, and its **drivers** (the joint whose rotation
drives the bulge, the rotation counted as "fully flexed", and a weight when several joints share one
belly). `"{SPINE_CHAIN}"` expands to every `Spine\d*` bone as an equal-weight driver, so the abs /
obliques / erectors contract on any spine bend.

**How it hooks into the base rig.** `muscleSpec(baseSpec, body, opts)` reads positions off the base
spec (so bellies land on whatever body the fitter measured) and returns a spec with the extra bones
(`muscle:true`) plus the driver table. `auto-armature.js` gained the generic hooks this needs:
`bonesFromSpec` honours a spec entry's `dir`/`len` (a belly's axis/direction, since it isn't a plain
parent→child bone) and copies `muscle` onto the bone as `__muscle`; `boneSegments` uses the stored
`__autoLen`; and `forge` accepts `opts.decorate(spec, body)` to let any module inject bones before the
tree is built.

**Do not regress — the capped secondary weighting.** Proximity alone would hand a belly bone most of
the weight near the surface (it sits *on* the skin while the real bone runs through the centre), and a
belly that out-votes the limb bones tears the joint apart when it swells. So `bindMeshAuto` was
rewritten for the muscle case: base bones are ranked first, *one* belly may take a single influence,
and the belly's total share is capped by **`muscleMax`** (default **0.6**) — the base skeleton always
keeps at least `(1 − muscleMax)`. Plain rigs have no `__muscle` bones and take the original path
unchanged, and the bind pose stays exact identity. `muscleMax` threads `generate({muscleMax})` →
`forge({muscleMax})` → `bindMeshAuto`.

**Tuning (measured, don't guess).** Two knobs trade the swell against artefacts: `offScale` (default
**0.4**) pulls the bellies *toward* the limb axis — a belly placed out on the skin owns surface
vertices that lie on its own scale axis, so it barely moves them; and `gainScale` (default **2.5**)
multiplies every def's `gain`. Both were swept live against an objective **edge-stretch ("tear")**
metric (each triangle edge's deformed/rest length). The shipped defaults
(`offScale 0.4, gainScale 2.5, muscleMax 0.6, intensity 1.5`) measure on a clean capsule mannequin at
bind = perfect identity and at a flexed pose p99 2.90 / max 17.6 / 2.12% of edges over 1.5× / 1.38%
under 0.7× — *better* than the base rig's own 4.21% over-1.5×. The swell is deliberately modest
(clearest at forearms/elbows and thighs); pushing `offScale`/`gainScale` higher buys a little more
bulge at the cost of surface artefacts.

**Gotcha (do not regress).** The invisible `AutoArmature · bind` proxy is a `SkinnedMesh` with no
skin attributes; framing the stage after a forge called `Box3.setFromObject` → `computeBoundingBox` →
`applyBoneTransform` and crashed (`reading 'getX'`). The proxy is now given a 1-vertex `skinIndex`
`[0,0,0,0]` / `skinWeight` `[1,0,0,0]`. `autoShapeKeys`/`importantBones` skip `cls === "muscle"`
bellies so the rig-aware shape keys are built from the real skeleton only, `removeMuscles()` drops the
whole armature cleanly, and the GLB export still writes 2 skins × 58 joints with no nulls.

## Motion presets — animating a rig without clips (`src/motion.js`)

A rigged file often ships with **no animation at all** (or only a test action), so "animate the
model with an armature" needs more than a clip player. The Rig panel's **Motion** card (in the
Animation column) offers 19 **procedural** motions that are generated *directly on the skeleton*:
every bone is driven from the bind pose each frame, so the result is deterministic and cannot
drift, and it works on any rig — including a pose the user made by hand.

Four categories: **Basic** (breathe, idle sway, look around, nod), **Locomotion** (walk, run,
sneak, jump), **Action** (wave, point, punch, kick) and **Intimate** (hip thrust, grind, ride, from
behind, head bob, stroking, spread). The Intimate motions are written plainly and explicitly — the
app is unapologetically adult-capable and does not euphemise.

Mechanically, a motion is a pure function `(h, p)` of the normalised phase `p` (0→1). `h` is bound
to the current skeleton and groups bones by anatomical role (`armature.js`'s `classifyBone`) and by
**bind-pose side**, so one preset drives very different rigs. The helpers rotate about **world axes
in bind space** — `h.rot(bone, x,y,z)`, `h.rotAll(group, …)`, `h.rotChain(limb, t, …)`,
`h.move(bone, …)` — which is what makes a rotating shoulder swing the whole arm and a hip rotation
carry the legs (**real FK**). `createMotionLayer({getRig})` returns the controller `main.js` drives
from its render loop (`motions.update(dt)`), alongside `author`, `animator` and `rig`.

## Keyframes — authoring a clip and exporting it (`src/anim-author.js`)

The **Keyframes** card turns a hand-posed rig into a real, exportable animation. It has its own
timeline track with a draggable playhead and one tick per key, plus **Capture**, **Delete**,
**Close loop**, **Clear**, **Play/Pause**, **Duration**, **Speed** and an **Auto-key** toggle. A
captured key is the full rig pose (`{ t, quats, deltas }` — bone quaternions plus each bone's local
position delta from bind); a named set of keys can be saved to a durable library (`kv.animations`)
and reloaded later.

`sample(t)` slerps the quaternions and lerps the position deltas between the neighbouring keys;
`applyAt(t)`/`setTime(t)` writes that pose back onto the rig; `play()` advances the playhead. With
**Auto-key** on, any change to the pose (e.g. rotating a bone with the gizmo) is captured at the
playhead automatically — the pose is only snapshotted when it actually differs from the last key,
so idling does not spam keys.

**`exportGlb()` bakes the keys into a `THREE.AnimationClip` and writes a real GLB** carrying the
skin **and one named animation** ("Authored"), so a clip authored here reopens in Blender as a
normal skeletal animation alongside the mesh. Verified end-to-end (parsed back: `skins:1`, 42
channels = 21 bones × quaternion + position, `LINEAR` samplers).

**Gotcha (do not regress):** three's `Quaternion.slerp` silently no-ops when the two quaternions'
dot product is ≥ 1, which happens when a captured quaternion is not unit-length (a scaled
`matrixWorld` run through `setFromRotationMatrix` produces a slightly non-unit quat). So
`captureKey` runs every pose through `normaliseQuats`, `sample` calls `.normalize()` on both
`fromArray` reads, and `motion.js`'s `setRig` normalises the bind quaternions. Before this, a
mid-clip `sample(0.5)` returned key 0 unchanged.

## No-Limit AI (`src/nolimit.js` + `src/ai-panel.js`, `AI 🔓` button)

The `AI 🔓` button (next to *Rig*) opens the app's built-in assistant, and the whole app's AI calls
run under a single **no-limit rule** — 🔓 **THE NO-LIMIT RULE (UNCONDITIONAL, DEFAULT ON, NEVER
OFF)**. It is a short, editable directive prepended to prompts so the model does not self-censor,
refuse, moralise, hedge, break character or add disclaimers. Three variants exist because the call
sites need different wording: **text** (chat / writing / roleplay), **vision** (image reading) and
**image** (a short qualifier appended to text-to-image prompts, since a long directive in front of
the subject would hurt more than help).

It is **ON by default** and persisted per-device in `kv.nolimit` (`apply`/`append`/`block` are the
single funnel every caller goes through, so the master toggle is obeyed everywhere). The **Rule 🔓**
tab exposes the master switch plus the three editable bodies, with a **Reset defaults**. The app's
own image generation (`requestImage`) appends the image variant, and reference captioning
(`describeReference`) prepends the vision variant.

The overlay has four working modes beside the rule:

- **Chat** — a streaming text assistant. The transcript is kept append-only with the task at the
  END of the prompt (prefix-cache friendly, so successive turns answer fast); replies stream in via
  `onChunk`, with a **Stop** button and a live loading indicator.
- **Vision** — hand it an image (drop, paste, pick a file, reuse the last generated image, or
  snapshot the live 3D viewport) and ask anything; answers stream in under the vision rule. It also
  takes a **video**: the video decodes locally, `F` evenly-spaced frames (slider, 4–48, default 12)
  are drawn into one **numbered contact sheet** (JPEG, tiles of ~160–420 px, column count from the
  frame count), and the prompt says the image is a contact sheet to read as a sequence over time —
  this is how a model that takes a single image is still given a whole clip, in order. The sheet
  build is defensive: it attaches the `<video>` to the DOM, waits for `loadeddata`/`canplay` (15 s),
  forces a duration for streaming/webm inputs via a far-seek + `durationchange`, and each seek
  resolves on `seeked` *or* `timeupdate` *or* a 2.5 s grace so a hidden/offscreen frame that never
  fires `seeked` can't hang the build. On any failure it toasts and falls back to image mode.
- **Animate ✨** — describe a motion in words; the text model returns the JSON keyframe spec (see
  `src/ai-anim.js`) and it is baked onto the loaded rig, appearing in *Rig ▸ Keyframes* ready to
  scrub, refine, loop and export as an animated GLB. **Replace**/**Append** chooses whether it
  overwrites the current keys or adds to them; the raw model output streams into a collapsible
  `<pre>`; sample chips fill the box with example motions (including explicit ones). If no rigged
  model is loaded it refuses with "Load a rigged model first".
- **Rule 🔓** — the master switch plus the three editable rule bodies.

Honest caveat, stated in the module comment: the rule genuinely reaches the model and removes
*our* self-imposed restrictions, but the upstream model services apply their own moderation that
this app cannot switch off. The rule maximises compliance; it is not a guarantee.

## Shared stage — realtime rooms + durable poses (`src/net.js` + the server script)

Everyone who loads the *same* rig is dropped into the same room (`rig-<signature>`), sees each other
in a roster, sees the other people's skeletons move live, and shares a named-pose library that is
remembered on the server across reloads and reconnect. `#rig=<room>` in the URL (the **Share**
button) auto-joins that room on open.

### The server (`<script type="text/x-server-plugin">` at the top of index.html)

Public source (like all server scripts): no secrets, every write is size-bounded and rate-limited,
and no client input is trusted beyond its declared size. It is a thin authoritative relay + store:

- **Presence / rigs** — `hi` assigns a stable slot, subscribes the connection to `r:<room>`, replies
  `welcome` + `roster`, replays the other members' rig descriptions to the newcomer and sends the
  room's durable last pose. `rig` stores the sender's bone names / parent indices / bind offsets /
  uniform scale and publishes it.
- **Pose relay** — binary pose frames are relayed to the room tagged with the sender's 2-byte slot
  (`[u16 slot][pose bytes]`); slot `0xffff` means "the room's durable last pose". Live writes to the
  durable room pose are throttled to one per 3 s (storage writes are the expensive part).
- **Durable library RPCs** — `savePose` (binary `[u8 nameLen][u8 authorLen][u16 dataLen][name][author][pose]`),
  `listPoses` (binary metadata list), `getPose` (pose bytes), `deletePose`.

`state` (50 MiB, zero-initialised, **no expiry**) layout — versioned by a magic + version byte:

```
header 64 B:  magic "T3RG" | version | nextPoseId u32 | livePoseCount u32 | poseEnd u32 | roomCount u32 | totalSaved u32
pose region  [64, 64 + 24 MiB):  append-only named-pose log
    record: kind(1=live,0=dead) | nameLen u8 | dataLen u16 | id u32 | roomHash u32 | ts u32 | authorLen u8 | author | name | pose
room region  after that:  256 slots x 3072 B  — each room's last pose (hash, ts, len, bytes)
```

The pose log is compacted (tombstones + `copyWithin` re-pack) and LRU-trimmed to `MAX_POSES = 2000`
when it runs out of room, so the store can never fill up and silently lose the whole feature.
Rooms are recycled least-recently-written-first. Rate limits use `conn.net[2]`; there is no admin
surface (nothing to secure) and no secret of any kind in the script.

**Gotcha (do not regress):** the server cannot use `TextEncoder`/`TextDecoder`, so names/authors are
opaque bytes end-to-end — the server slices and stores them, the *client* decodes. And `listPoses`
sends **metadata only** (no pose bytes), so the client parser must read `dataLen` but **not skip
`dataLen` bytes** — skipping them truncates the list to a single entry.

### Wire format

Rig descriptions are JSON (low rate). Poses are binary, ~8 bytes/bone + a sparse position channel:

```
format 1 (quaternions only):  [u8 1][u16 count][int16 x4 x count]
format 2 (+ translations):    [u8 2][u16 count][f32 posScale][mask ceil(count/8)][int16 x3 per set bit][int16 x4 x count]
```

Format 2 is chosen automatically whenever the rig reports position deltas. The mask marks the bones
whose local position differs from bind; each such bone's delta is quantised by a single `posScale`.
In practice glTF exporters bake constant position/scale tracks for every joint, so **one** bone
usually moves (the root) and format 2 costs ~30 bytes more than format 1 — measured 1963 vs 1924
bytes for a 240-bone rig — while preserving root motion that would otherwise be lost. Quantisation
error is ~1.5e-5 per quaternion component and ~7e-7 per position, i.e. invisible.

`net.js` broadcasts on a 66 ms interval with a 60 ms floor and skips a frame when neither the
quaternions nor the deltas moved beyond an epsilon. The room's durable last pose is restored on
join (toggle **Restore room pose on join**), and on joining/roster change each client force-sends
its current pose once so a newcomer does not see a bind-pose ghost.

### Ghosts

A remote rig is drawn by `createGhostPuppet({bones, parent, offs, scale, color})` — one `LineSegments`
(1 draw call) over a hierarchy of `Object3D`s carrying the sender's local bind offsets. Applying a
pose sets each node's quaternion and `position = bindOffset + delta`. The sender's **uniform world
scale** is sent with the rig description and applied to the ghost group so a remote skeleton is the
same size as the model here. Verified: a 240-bone ghost reproduces the sender's world-space skeleton
to 0.00005 units max error (quantisation only), with a deliberate +0.5/+0.25 root translation.

**Gotcha (do not regress):** every offset in `netInfo()` must be computed from the **frozen bind
snapshot** (`bindPos` / `bindWorldPos` / `bindWorldInv`, captured in `createRig` before any pose), never
from the bones' live `matrixWorld`. `netInfo()` is called while joining or announcing — often mid-clip —
so reading `bones[p].matrixWorld` bakes the *current* animation into the recipe and every remote ghost
comes out mangled (observed on a 21-bone model: max shape error 1.93 with a live pose, 0 after the fix).
Two details: a root bone uses its **bind local** position (world positions carry the model's
normalisation scale, which pose deltas do not); a parented bone is placed relative to the parent bone's
**bind** world matrix so the ghost hierarchy stays correct even when bones hang under non-bone nodes.

### Stress case — the `toga` 240-bone rig

The heaviest rig we test with is the user's `(pot)(selfsuck)toga.1.0.0.6.7.9.glb` (signature
`147a032d`; ~51.6k verts / 94k tris in the GLB, one `SkinnedMesh`
`orc_fat_toga_bbwchainSALINE_penis_ball_TEST006`, one material, no morph targets). It is a good
stress case because it is far from a stock humanoid:

- **240 bones, single root `root`**, 93 leaves, max depth 16, fanning out to 11 children under
  `spine01` and 4 fingers × 3 phalanges per hand. Extra leg "twist" side-branches hang off
  `lowerleg01_L/R` and `upperleg02_L/R` (`lowerleg01_L001/002`, `upperleg02_L001`, …).
- Bone names mix English, French and (misspelled) Latin — `fesse_gauche`, `plevis`, `couille_*`,
  `anus_droite1..8`, `bite1..10` / `gland`, `sein`/`teton`/`nipel`, and a full set of facial-muscle
  bones (`levator`, `oris`, `orbicularis`, `oculi`, `temporalis`, `risorius`). That mix is exactly
  why `classifyBone`'s family list is as broad as it is. With the current rules the rig reads
  **head 62 · arm 66 · leg 53 · spine 21 · other 38 · tail 0** (other = genitals + the 7 `special*`
  face-attachment bones).
- Its one clip (`models. toga_saline_testAction`, 9.58 s, 723 tracks = 241 nodes × TRS) is a
  **test action, not a performance**: only **17 of 240 bones** actually rotate, and **only the root
  translates** — every other bone keeps a constant position/scale, which is precisely what the
  format-2 position channel exists to survive. Most-animated: `upperleg01_L`, `fesse_gauche`,
  `foot_R`.

Loading it here takes ~2 s; the overlay is 2 draw calls, the bone tree handles all 240 rows, and the
network path reproduces it as a ghost to 5e-5. Re-test with it whenever a change might only break at
large bone counts.

### Testing without a second browser

While `window.generatorIsUnsaved` is true the socket is a **local emulator** limited to the current
document — no cross-tab play. To exercise the multi-peer path, open a second socket in the same page
and drive it by hand:

```js
const peer = root.createServerSocket();
peer.binaryType = "arraybuffer";
await new Promise(r => peer.readyState === 1 ? r() : peer.addEventListener("open", r));
peer.send(JSON.stringify({ t: "hi", room: "lab", name: "Bob" }));
peer.send(JSON.stringify({ t: "rig", bones, parent, offs, sig, sc }));  // from textTo3d.rig.netInfo()
const enc = (await import("./src/armature.js")).encodePose(textTo3d.rig.capturePose());
const frame = new Uint8Array(1 + enc.length); frame[0] = 1; frame.set(enc, 1);
peer.send(frame.buffer);                                                 // [1][pose] → server adds the slot
```



`window.textTo3d` exposes `{ scene, camera, controls, renderer, model, grid, ground, sceneBase,
frontMat, solidMat, render, applyShading, setStudioMode, get studio, tests, armature, get rig,
refreshRig, library, setSize(w,h), generate(),
generateImageOnly, get generatedImage, get generatedImages, showGeneratedImage,
fromImage(src, label), fromAiImage(src, label), rebuildAi(threshold, resolution, smooth),
setQuality(q), get quality, img3dSupported(), img3dModelsLoaded(), probeBackbone(src), fromFiles(files),
setReference, clearReference, describeReference, get ref, export(kind), exportDataUrl(kind), info(),
look: { setPreset, setEnv, setEnvIntensity, setEnvBackground, setLightRig, setFx, setFxPreset, params,
fx, env, fxEngine } }`.
Handy for testing/automation from the console. `fromAiImage(url, label)` builds through the AI
pipeline directly; `rebuildAi` re-extracts from the cached density (pass `smooth` in world units).
`look.*` drives the realism layer — e.g. `textTo3d.look.setPreset("cinematic")` or
`textTo3d.look.setFx({ vignette: 0.4, bloom: 0.3 })`.

The motion / keyframe / no-limit-AI API is reachable too: `textTo3d.motions` (the procedural motion
layer — `play(id)`, `stop()`, `setSpeed(v)`, `setLoop(on)`, `update(dt)`, `motion`, `parts`,
`hasRig`), `textTo3d.author` (the keyframe author — `captureKey(t)`, `removeKeyNear(t)`, `clear()`,
`closeLoop()`, `sample(t)`, `applyAt(t)`, `setTime(t)`, `play()/pause()/stop()`, `setDuration(s)`,
`setAutoKey(on)`, `save(name)`/`load(name)`/`removeSaved(name)`, `buildClip()`, `exportGlb()`,
`get keys`/`get keyCount`/`get duration`), `textTo3d.nolimit` (the rule — `enabled`,
`setEnabled(on)`, `rules`, `setRule(kind, text)`, `resetRules()`, `apply`/`append`/`block`),
`textTo3d.ai` (the overlay — `open()/close()/toggle()`, `showTab(id)`, `setVisionUrl(dataUrl)`,
`setVisionVideo(file)`, `sendAnimate()`, `get visMode`, `get visFrames`, `messages`), and
`textTo3d.aiAnim` (the AI animation baker — `generate(desc, {onChunk, append})`,
`applySpec(spec, {append})`, `parseSpec(text)`, `prompt(desc)`, `stop()`, `get roles`,
`get hasRig`, `get pending`).

The guided pipeline is reachable too: `textTo3d.workflow` (the overlay — `open()/close()/toggle()`,
`go(i)`, `refresh()`, `get step`, `get isOpen`).

The rig/shared-stage API is reachable too: `textTo3d.rig` (the live controller — `netInfo()`,
`capturePose()/applyPose()/resetPose()`, `playClip()`, `stopClip()`, `setClipTime()`, `bones`,
`names`, `classes`, `clips`, `signature`, `boneCount`), `textTo3d.armature` (the panel —
`open()/close()/toggle()`, `join(room, name)`, `leave()`, `shareLink()`, `get room`, `get presence`,
`get ghosts`, `get isOpen`), and `textTo3d.armature.net` (the client — `online`, `slot`, `status`,
`sendPose(pose)`, `savePose(name, pose)`, `listPoses()`, `getPose(id)`, `deletePose(id)`).

```js
textTo3d.armature.open();
textTo3d.armature.join("lab", "Alice");
textTo3d.rig.playClip(0);                       // first animation clip
textTo3d.library.loadAsset(id);                 // load a saved rigged model from the library
const pose = textTo3d.rig.capturePose();        // { quats, deltas }
await textTo3d.armature.net.savePose("T-pose", pose);
```

## Gotchas while iterating

- `src/` files are served live, but a module already imported is cached: to pick up an edit made
  outside a page reload, import with a cache-buster (`import("./src/relief.js?v=" + n)`).
- **Animation only advances while the tab is visible.** The render loop is `renderer.setAnimationLoop`,
  i.e. `requestAnimationFrame`, which the browser freezes for a hidden document (`document.hidden`).
  So `playClip(0)` reads back `time === 0` when the preview tab is backgrounded — that is *not* a bug
  in the rig. To test playback headlessly, step the mixer yourself: `rig.playClip(0); rig.update(0.8);`
  and compare bone quaternions (this model's clips are quaternion-only, so bone *positions* won't move).
- Depth is estimated at 768×768 from the prepared canvas; `prepareInputs` composites transparent
  pixels over `#b4b4b4` so the depth model doesn't invent geometry in see-through areas.
- Vision-model checks of these renders over-report "banding/terracing" — it rates a mathematically
  perfect cone 4/10, and a single glance at the AI mesh called the smoothing default "still
  corrugated" while a labelled 0 / 0.022 / 0.04 side-by-side correctly picked 0.022 as the best
  trade-off. So: use **labelled A/B renders plus geometry metrics** (mean dihedral, Laplacian
  magnitude, vertex counts) to judge, never one unlabelled frame.
- **The preview iframe cannot decode media through an element.** In the live editor preview,
  `<video>`/`<audio>` elements never fire `loadedmetadata`/`loadeddata` for any source — blob URLs
  (including `MediaRecorder` output), `data:` URLs and remote MP4s all stall (verified; WAV audio
  too), even though `canPlayType` reports "probably". That limitation is real but it is **not** a
  dead end: **WebCodecs works there**, so `src/video.js` decodes video by demuxing the container and
  running `VideoDecoder` directly (see *Video decoding*). Both video features — the prompt
  reference video and the AI-vision contact sheet — therefore work end-to-end in the preview and are
  verified that way. A `<video>` element is still the fallback when WebCodecs is missing.

## Rebuild / regenerate the meta image

`$meta.image` is a rendered 3D 3/4 view (textured), uploaded to a permanent URL. To regenerate:
build a model, `renderer.setPixelRatio(1)`, `textTo3d.setSize(1200,800)`, re-frame (call
`fromImage` again so `frameObject` sees the new aspect), render, capture `canvas.toDataURL()`,
convert to JPEG, upload, and update `$meta.image`.
