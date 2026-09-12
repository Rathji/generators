import * as THREE from "https://esm.sh/three@0.160.0";
import { makeGlowTexture } from "./lib.js";

export function createSpirits(scene, spots, geos, rng){
  const glowTex = makeGlowTexture(128, "#e8fff6");
  const list = [];

  for (const sp of spots){
    const group = new THREE.Group();
    group.position.set(sp.x, 0, sp.z);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x0a1a16, emissive: 0x8fe6c8, emissiveIntensity: 1.6,
      transparent: true, opacity: 0.42, depthWrite: false, roughness: 1,
    });
    const body = new THREE.Mesh(geos.cone6, bodyMat);
    body.scale.set(0.55, 2.1, 0.55);
    body.position.y = 0;
    group.add(body);

    const headMat = new THREE.MeshStandardMaterial({
      color: 0x0a1a16, emissive: 0xbff6e4, emissiveIntensity: 1.3,
      transparent: true, opacity: 0.5, depthWrite: false, roughness: 1,
    });
    const head = new THREE.Mesh(geos.sphere, headMat);
    head.scale.setScalar(0.26);
    head.position.y = 2.15;
    group.add(head);

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0x8fe6c8, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    halo.scale.set(3.2, 3.2, 1);
    halo.position.y = 1.1;
    group.add(halo);

    scene.add(group);

    list.push({
      group, body, head, halo, bodyMat, headMat,
      x: sp.x, z: sp.z,
      homeX: sp.x, homeZ: sp.z,
      tx: sp.x, tz: sp.z,
      phase: rng.float(0, Math.PI * 2),
      speed: rng.float(0.25, 0.7),
      profile: null,
      talking: false,
      alpha: 1,
    });
  }

  function update(dt, t, playerPos){
    for (const s of list){
      const dxp = playerPos.x - s.x, dzp = playerPos.z - s.z;
      const distP = Math.hypot(dxp, dzp);
      const near = distP < 9;

      // choose a new wander target now and then, staying near home
      const dxt = s.tx - s.x, dzt = s.tz - s.z;
      if (Math.hypot(dxt, dzt) < 1.2 || rng.next() < dt * 0.06){
        const a = rng.float(0, Math.PI * 2);
        const r = rng.float(3, 22);
        s.tx = s.homeX + Math.cos(a) * r;
        s.tz = s.homeZ + Math.sin(a) * r;
      }

      let vx = 0, vz = 0;
      if (s.talking || near){
        // drift slowly toward the player, keep a respectful distance
        if (distP > 2.6){
          vx = (dxp / distP) * 0.5;
          vz = (dzp / distP) * 0.5;
        }
      } else {
        const d = Math.hypot(dxt, dzt) || 1;
        vx = (dxt / d) * s.speed;
        vz = (dzt / d) * s.speed;
      }

      s.x += vx * dt;
      s.z += vz * dt;

      const bob = Math.sin(t * 1.1 + s.phase) * 0.16;
      const hover = 0.55 + Math.sin(t * 0.7 + s.phase * 2) * 0.12;
      s.group.position.set(s.x, hover + bob, s.z);
      // face the player when close, else face travel direction
      const faceX = near || s.talking ? dxp : vx;
      const faceZ = near || s.talking ? dzp : vz;
      if (Math.abs(faceX) + Math.abs(faceZ) > 0.001){
        s.group.rotation.y = Math.atan2(faceX, faceZ);
      }
      const pulse = 1 + Math.sin(t * 2 + s.phase) * 0.12;
      s.halo.scale.set(3.2 * pulse, 3.2 * pulse, 1);
      s.halo.material.opacity = 0.42 * pulse * s.alpha;
      s.bodyMat.opacity = 0.42 * s.alpha;
      s.headMat.opacity = 0.5 * s.alpha;
    }
  }

  return { list, update };
}
