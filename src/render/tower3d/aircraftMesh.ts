import * as THREE from 'three';
import { LIGHT, addLight, emptyLights, type LightSet } from './lights';
import { airframe, liveryFor, type Livery } from './math';

/** Procedural airliner: smooth lathe fuselage with a window line, swept wings, engines, gear. No model files. */
export interface AircraftMesh extends THREE.Group {
  userData: {
    gear: THREE.Group;
    wheelBase: number;
    len: number;
    span: number;
    /** Light positions in the model's own frame (nose towards -z), shown at dusk and night. */
    lights: { nav: LightSet; landing: LightSet };
  };
}

const textures = new Map<string, THREE.CanvasTexture>();

/** Fuselage skin. u runs around (0 belly, 0.25 right, 0.5 top, 0.75 left), v from nose (0) to tail (1). */
function skin(l: Livery): THREE.CanvasTexture {
  const key = `${l.body ?? ''}|${l.cheat ?? ''}`;
  let t = textures.get(key);
  if (t) return t;
  const W = 256;
  const H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // canvas y runs opposite to v
  const band = (u0: number, u1: number, v0: number, v1: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(u0 * W, (1 - v1) * H, (u1 - u0) * W, (v1 - v0) * H);
  };
  band(0, 1, 0, 1, '#f3f5f7');
  if (l.body) band(0.27, 0.73, 0, 1, l.body);
  band(0, 0.1, 0, 1, '#c9cfd6');
  band(0.9, 1, 0, 1, '#c9cfd6');
  for (const u of [0.29, 0.71]) {
    if (l.cheat) band(u - 0.035, u - 0.015, 0, 1, l.cheat);
    for (let v = 0.17; v < 0.8; v += 0.0105) band(u - 0.007, u + 0.007, v, v + 0.005, '#27313f');
  }
  // cockpit windows wrap over the top of the nose
  g.fillStyle = '#1c2530';
  g.beginPath();
  g.moveTo(0.3 * W, (1 - 0.085) * H);
  g.lineTo(0.7 * W, (1 - 0.085) * H);
  g.lineTo(0.62 * W, (1 - 0.06) * H);
  g.lineTo(0.38 * W, (1 - 0.06) * H);
  g.closePath();
  g.fill();
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  textures.set(key, t);
  return t;
}

const mats = new Map<string, THREE.MeshStandardMaterial>();
function paint(color: string, roughness = 0.42): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}`;
  let m = mats.get(key);
  if (!m)
    mats.set(
      key,
      (m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05, side: THREE.DoubleSide })),
    );
  return m;
}

/** A flat, slightly rounded surface (wing, tailplane, fin) from a planform outline. */
function surface(pts: [number, number][], thick: number, mat: THREE.Material): THREE.Mesh {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: thick,
    bevelEnabled: true,
    bevelThickness: thick * 0.45,
    bevelSize: thick * 0.9,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -thick / 2);
  return new THREE.Mesh(geo, mat);
}

/** Nose points to -z, wings along x, y up. Origin on the fuselage centreline at mid-length. */
export function buildAircraft(type: string, airline: string): AircraftMesh {
  const T = airframe(type);
  const livery = liveryFor(airline);
  const r = T.d / 2;
  const L = T.len;
  const g = new THREE.Group() as AircraftMesh;
  const grey = paint('#c3cad2', 0.5);
  const dark = paint('#23282f', 0.9);

  // fuselage: revolve a profile, then droop the nose and sweep the tail up
  const N = 48;
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    let rad = r;
    if (s < 0.12) rad = r * Math.pow(Math.sin((s / 0.12) * Math.PI * 0.5), 0.62);
    else if (s > 0.66) rad = r * Math.max(0.05, Math.cos(((s - 0.66) / 0.34) * Math.PI * 0.5) ** 0.75);
    prof.push(new THREE.Vector2(Math.max(rad, 0.02), (s - 0.5) * L));
  }
  const fg = new THREE.LatheGeometry(prof, 28);
  fg.rotateX(Math.PI / 2);
  const pos = fg.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const s = pos.getZ(i) / L + 0.5;
    if (s > 0.66) pos.setY(i, pos.getY(i) + ((s - 0.66) / 0.34) ** 1.6 * r * 0.78);
    if (s < 0.1) pos.setY(i, pos.getY(i) - (1 - s / 0.1) ** 2 * r * 0.22);
  }
  fg.computeVertexNormals();
  g.add(
    new THREE.Mesh(
      fg,
      new THREE.MeshStandardMaterial({
        map: skin(livery),
        roughness: 0.42,
        metalness: 0.05,
        side: THREE.DoubleSide,
      }),
    ),
  );

  const semi = T.span / 2;
  const rootC = L * (T.prop ? 0.16 : 0.205);
  const tipC = rootC * (T.prop ? 0.6 : 0.27);
  const sweep = semi * (T.prop ? 0.06 : 0.52);
  const wingZ = -L * (T.prop ? 0.06 : 0.115);
  const wingY = -r * 0.55;
  const gear = new THREE.Group();
  g.add(gear);
  // nav lights: red on the left tip, green on the right, white tail; red beacons top and bottom; white strobes
  const nav = emptyLights();
  const tipY = wingY + semi * 0.09;
  const tipZ = wingZ + sweep;
  addLight(nav, -semi, tipY, tipZ, LIGHT.red, 2.6);
  addLight(nav, semi, tipY, tipZ, LIGHT.green, 2.6);
  addLight(nav, 0, r * 0.3, L * 0.5, LIGHT.white, 2.2);
  addLight(nav, 0, r * 1.02, -L * 0.05, LIGHT.red, 3.2, 1);
  addLight(nav, 0, -r * 1.0, -L * 0.1, LIGHT.red, 3.2, 1);
  addLight(nav, -semi, tipY, tipZ + tipC, [1, 1, 1], 4, 2);
  addLight(nav, semi, tipY, tipZ + tipC, [1, 1, 1], 4, 2);
  // landing and taxi lights: what you see first of an arrival at night
  const landing = emptyLights();
  addLight(landing, 0, -r * 0.7, -L * 0.36, [1, 0.97, 0.9], 9);
  for (const side of [1, -1])
    addLight(landing, side * r * 1.6, wingY, wingZ + rootC * 0.1, [1, 0.97, 0.9], 7);
  g.userData = {
    gear,
    wheelBase: r * 0.6 + T.gearH + 0.28,
    len: L,
    span: T.span,
    lights: { nav, landing },
  };

  for (const side of [1, -1]) {
    const wing = surface(
      [
        [0, 0],
        [semi * 0.34, sweep * 0.34],
        [semi, sweep],
        [semi, sweep + tipC],
        [semi * 0.34, sweep * 0.34 + rootC * 0.62],
        [0, rootC],
      ],
      Math.max(0.12, r * 0.15),
      grey,
    );
    wing.rotation.x = Math.PI / 2;
    wing.scale.x = side;
    wing.position.set(0, wingY, wingZ);
    wing.rotation.z = side * -0.09; // dihedral
    g.add(wing);

    if (!T.prop) {
      // small upturned wingtip in the tail colour
      const h = T.span * 0.04;
      const tip = surface(
        [
          [0, 0],
          [tipC * 0.75, h],
          [tipC * 1.05, h],
          [tipC, 0],
        ],
        0.12,
        paint(livery.tail),
      );
      tip.rotation.y = -Math.PI / 2;
      tip.rotation.z = side * -0.2;
      tip.position.set(side * semi, wingY + semi * 0.09, wingZ + sweep);
      g.add(tip);
    }

    const ss = T.span * 0.19;
    const stab = surface(
      [
        [0, 0],
        [ss, ss * 0.62],
        [ss, ss * 0.62 + L * 0.045],
        [0, L * 0.105],
      ],
      Math.max(0.1, r * 0.1),
      grey,
    );
    stab.rotation.x = Math.PI / 2;
    stab.scale.x = side;
    stab.position.set(0, r * 0.55, L * 0.385);
    stab.rotation.z = side * -0.1;
    g.add(stab);

    // underwing engines: one or two per side
    const stations = T.prop ? [] : T.engines === 4 ? [0.3, 0.55] : [0.33];
    for (const st of stations) {
      const eR = T.engD / 2;
      const eL = T.engL;
      const ep: THREE.Vector2[] = [];
      for (let i = 0; i <= 12; i++) {
        const s = i / 12;
        const lip = 0.86 + 0.14 * Math.sin(Math.min(1, s / 0.3) * Math.PI * 0.5);
        ep.push(new THREE.Vector2(eR * lip * (s > 0.6 ? 1 - (s - 0.6) * 0.75 : 1), (s - 0.5) * eL));
      }
      const eg = new THREE.LatheGeometry(ep, 18);
      eg.rotateX(Math.PI / 2);
      const ex = side * semi * st;
      const ey = wingY - eR * 0.95;
      const ez = wingZ + sweep * st - eL * 0.25;
      const eng = new THREE.Mesh(eg, paint(livery.cowl, 0.35));
      eng.position.set(ex, ey, ez);
      const fan = new THREE.Mesh(new THREE.CircleGeometry(eR * 0.84, 18), dark);
      fan.position.set(ex, ey, ez - eL * 0.47);
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.35, eR * 0.9, eL * 0.6), grey);
      pylon.position.set(ex, ey + eR * 0.95, ez + eL * 0.1);
      g.add(eng, fan, pylon);
    }

    // main gear
    const wheelR = Math.max(0.25, r * 0.3);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(wheelR * 0.28, wheelR * 0.28, T.gearH, 8), grey);
    strut.position.set(side * r * 1.75, -r * 0.6 - T.gearH / 2, L * 0.03);
    gear.add(strut);
    for (const dz of T.prop ? [0] : [-wheelR * 1.3, wheelR * 1.3]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, wheelR * 1.5, 14), dark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * r * 1.75, -r * 0.6 - T.gearH + wheelR * 0.5, L * 0.03 + dz);
      gear.add(wheel);
    }
  }

  // nose gear
  {
    const wheelR = Math.max(0.2, r * 0.22);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(wheelR * 0.3, wheelR * 0.3, T.gearH, 8), grey);
    strut.position.set(0, -r * 0.6 - T.gearH / 2, -L * 0.36);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, wheelR * 1.6, 14), dark);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(0, -r * 0.6 - T.gearH + wheelR * 0.35, -L * 0.36);
    gear.add(strut, wheel);
  }

  if (T.prop) {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(T.engD * 1.25, 20),
      new THREE.MeshBasicMaterial({
        color: '#30363e',
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      }),
    );
    disc.position.set(0, -r * 0.2, -L * 0.5 - 0.1);
    g.add(disc);
  }

  const fin = surface(
    [
      [0, 0],
      [T.fin * 0.95, T.fin],
      [T.fin * 0.95 + L * 0.06, T.fin],
      [L * 0.16, 0],
    ],
    Math.max(0.12, r * 0.12),
    paint(livery.tail),
  );
  fin.rotation.y = -Math.PI / 2;
  fin.position.set(0, r * 0.95, L * 0.3);
  g.add(fin);
  return g;
}

/** Free the shared textures and materials (when the tower view closes). */
export function disposeAircraftAssets() {
  for (const t of textures.values()) t.dispose();
  for (const m of mats.values()) m.dispose();
  textures.clear();
  mats.clear();
}
