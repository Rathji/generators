import * as THREE from "https://esm.sh/three@0.160.0";
import { makeNoiseTexture, makeBumpTexture, makeCobbleTexture } from "./lib.js";

// Stone-like materials use a WHITE base and are coloured per-instance via
// InstancedMesh.instanceColor — so one material serves every tint in the city.
export function buildMaterials(seed){
  const stoneMap = makeNoiseTexture(512, seed + "-stone", { contrast: 1.05, grain: 0.09, range: [0.55, 1.0], tint: [1, 0.99, 0.95] });
  stoneMap.repeat.set(2, 2);
  const stoneBump = makeBumpTexture(512, seed + "-sb", 30);
  stoneBump.repeat.set(2, 2);

  const boneMap = makeNoiseTexture(256, seed + "-bone", { contrast: 0.4, grain: 0.08, range: [0.8, 1.0] });
  boneMap.repeat.set(2, 2);

  const groundMap = makeCobbleTexture(512, seed + "-ground", { cells: 14, joint: 0.34, contrast: 0.55, grime: 0.34, tint: [0.9, 0.93, 0.88] });
  groundMap.repeat.set(34, 34);
  const groundBump = makeCobbleTexture(512, seed + "-gb", { cells: 14, joint: 0.4, contrast: 0.8, grime: 0.25, tint: [1, 1, 1] });
  groundBump.repeat.set(34, 34);

  // paving for the avenues + plazas — jointed flagstones
  const roadMap = makeCobbleTexture(512, seed + "-road", { cells: 6, joint: 0.2, contrast: 1.15, grime: 0.12, tint: [0.96, 0.98, 1.0] });
  roadMap.repeat.set(6, 6);
  const roadBump = makeCobbleTexture(512, seed + "-rb", { cells: 6, joint: 0.26, contrast: 1.2, grime: 0.1, tint: [1, 1, 1] });
  roadBump.repeat.set(6, 6);

  const m = {};

  m.stone = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: stoneMap, bumpMap: stoneBump, bumpScale: 0.55, roughness: 0.95, metalness: 0.0,
  });
  m.bone = new THREE.MeshStandardMaterial({ color: 0xffffff, map: boneMap, bumpMap: stoneBump, bumpScale: 0.2, roughness: 0.85 });
  m.marble = new THREE.MeshStandardMaterial({ color: 0xffffff, map: stoneMap, bumpMap: stoneBump, bumpScale: 0.2, roughness: 0.62, metalness: 0.05 });

  m.void = new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 1.0, metalness: 0.0 });
  m.crypt = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.95 });

  m.metal = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.55 });
  m.gold = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.33, metalness: 0.7 });

  m.soul = new THREE.MeshStandardMaterial({ color: 0x0a1a16, emissive: 0x8fe6c8, emissiveIntensity: 1.35, roughness: 0.4 });
  m.ember = new THREE.MeshStandardMaterial({ color: 0x1a0d06, emissive: 0xff7a2a, emissiveIntensity: 1.25, roughness: 0.5 });
  m.goldGlow = new THREE.MeshStandardMaterial({ color: 0x1a1408, emissive: 0xffd98a, emissiveIntensity: 0.95, roughness: 0.4 });
  m.relief = new THREE.MeshStandardMaterial({ color: 0x3a3222, emissive: 0x8a7040, emissiveIntensity: 0.22, roughness: 0.6, metalness: 0.3 });

  m.ground = new THREE.MeshStandardMaterial({
    color: 0x676b5d, map: groundMap, bumpMap: groundBump, bumpScale: 0.7, roughness: 1.0,
  });
  const roadMap2 = roadMap.clone();
  const roadBump2 = roadBump.clone();
  m.road = new THREE.MeshStandardMaterial({ color: 0x565d64, map: roadMap, bumpMap: roadBump, bumpScale: 0.55, roughness: 0.88, metalness: 0.05 });
  m.plaza = new THREE.MeshStandardMaterial({ color: 0x5a5f5c, map: roadMap2, bumpMap: roadBump2, bumpScale: 0.5, roughness: 0.82 });

  return { materials: m, stoneMap, groundMap, roadMap };
}
