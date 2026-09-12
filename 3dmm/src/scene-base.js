import { THREE } from "./three.js";

const AXIS_LEN = 4.4;
const GRID_HALF = 12;
const COL = {
  x: 0xff4d4d,
  y: 0x53d769,
  z: 0x4d8bff,
  origin: 0xdfe6f2,
};

function axisLine(from, to, color, opacity = 0.95) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = 3;
  return line;
}

function axisArrow(dir, color) {
  const g = new THREE.Group();
  const d = dir.clone().normalize();
  g.add(axisLine(new THREE.Vector3(), d.clone().multiplyScalar(AXIS_LEN), color));
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 0.26, 16),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.96 }),
  );
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  cone.position.copy(d.clone().multiplyScalar(AXIS_LEN));
  cone.renderOrder = 3;
  g.add(cone);
  return g;
}

function originMarker() {
  const g = new THREE.Group();
  const ringGeo = new THREE.RingGeometry(0.1, 0.128, 48);
  const ring = new THREE.Mesh(
    ringGeo,
    new THREE.MeshBasicMaterial({ color: COL.origin, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 12;
  g.add(ring);
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.03, 24),
    new THREE.MeshBasicMaterial({ color: COL.x, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false, depthWrite: false }),
  );
  dot.rotation.x = -Math.PI / 2;
  dot.renderOrder = 12;
  g.add(dot);
  return g;
}

function defaultCube() {
  const geo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
  const mat = new THREE.MeshStandardMaterial({ color: 0xb8bfcb, roughness: 0.55, metalness: 0.04 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(-1.95, 0.45, 0.75);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cameraMarker() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2, roughness: 0.5, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.2), mat);
  body.castShadow = true;
  g.add(body);
  const lens = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.18, 18), mat);
  lens.rotation.x = -Math.PI / 2;
  lens.position.set(0, 0, -0.19);
  g.add(lens);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xb7c2d6, transparent: true, opacity: 0.7 });
  const tip = new THREE.Vector3(0, 0, -0.28);
  const corners = [
    new THREE.Vector3(-0.3, 0.22, -1.15),
    new THREE.Vector3(0.3, 0.22, -1.15),
    new THREE.Vector3(0.3, -0.22, -1.15),
    new THREE.Vector3(-0.3, -0.22, -1.15),
  ];
  for (const c of corners) {
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([tip, c]), lineMat));
  }
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([...corners, corners[0]]), lineMat));
  return g;
}

function lightMarker() {
  const g = new THREE.Group();
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xffd479 }),
  );
  bulb.renderOrder = 3;
  g.add(bulb);
  const mat = new THREE.LineBasicMaterial({ color: 0xffd479, transparent: true, opacity: 0.7 });
  const dirs = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    [1, 1, 1], [-1, -1, -1], [1, -1, 1], [-1, 1, -1],
  ];
  for (const d of dirs) {
    const v = new THREE.Vector3(d[0], d[1], d[2]).normalize();
    const geo = new THREE.BufferGeometry().setFromPoints([
      v.clone().multiplyScalar(0.08),
      v.clone().multiplyScalar(0.34),
    ]);
    g.add(new THREE.Line(geo, mat));
  }
  return g;
}

export function createSceneBase() {
  const group = new THREE.Group();
  group.name = "SceneBase";

  const floor = new THREE.Group();
  floor.name = "BaseFloor";

  const axes = new THREE.Group();
  axes.userData.studioName = "Axes";
  axes.add(axisLine(new THREE.Vector3(-GRID_HALF, 0, 0), new THREE.Vector3(GRID_HALF, 0, 0), COL.x, 0.9));
  axes.add(axisLine(new THREE.Vector3(0, 0, -GRID_HALF), new THREE.Vector3(0, 0, GRID_HALF), COL.z, 0.9));
  axes.add(axisArrow(new THREE.Vector3(0, 1, 0), COL.y));
  floor.add(axes);

  const origin = originMarker();
  origin.userData.studioName = "Origin";
  floor.add(origin);

  group.add(floor);

  const props = new THREE.Group();
  props.name = "BaseProps";

  const cube = defaultCube();
  cube.userData.studioName = "Cube";
  props.add(cube);

  const cam = cameraMarker();
  cam.userData.studioName = "Camera";
  cam.position.set(2.45, 1.6, 2.1);
  cam.scale.setScalar(1.15);
  cam.lookAt(0, 0.3, 0);
  props.add(cam);

  const light = lightMarker();
  light.userData.studioName = "Light";
  light.position.set(-1.3, 2.0, 1.5);
  props.add(light);

  group.add(props);

  let baseOn = true;
  let studioOn = false;

  function apply() {
    group.visible = baseOn;
    floor.visible = baseOn;
    props.visible = baseOn && studioOn;
  }

  apply();

  return {
    group,
    floor,
    props,
    axes,
    origin,
    cube,
    camera: cam,
    light,
    entries: [
      { obj: axes, icon: "\u2716" },
      { obj: origin, icon: "\u25CE" },
      { obj: cube, icon: "\u25A0" },
      { obj: cam, icon: "\u25B2" },
      { obj: light, icon: "\u2600" },
    ],
    isEnabled: () => baseOn,
    setEnabled(on) {
      baseOn = !!on;
      apply();
    },
    setStudio(on) {
      studioOn = !!on;
      apply();
    },
    setFloorY(y) {
      group.position.y = y + 0.006;
    },
  };
}
