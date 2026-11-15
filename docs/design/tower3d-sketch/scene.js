// Throwaway tower-view sketch: renders stills for the design canvas. Not app code.
// Frame: metres, x = east, y = up, z = south. Origin = EHAM reference point.
import * as THREE from 'three';

const eham = await (await fetch('./EHAM.json')).json();
const P = new URLSearchParams(location.search);
const preset = P.get('p') ?? 'west-day';
const W = +(P.get('w') ?? 2240);
const H = +(P.get('h') ?? 1200);

const FT = 0.3048;
const NM = 1852;
const cosLat = Math.cos((eham.lat * Math.PI) / 180);
const ll = (lat, lon) => ({ x: (lon - eham.lon) * 111320 * cosLat, z: -(lat - eham.lat) * 111320 });
const dir = (hdg) => {
  const r = (hdg * Math.PI) / 180;
  return { x: Math.sin(r), z: -Math.cos(r) };
};
// deterministic RNG so every render is identical
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();

const TOD = {
  day: {
    skyTop: '#3d7cc4', skyMid: '#8dbbe6', horizon: '#dbe7ef', fog: '#c9d8e4', fogDensity: 0.000055,
    sun: { az: 215, el: 38, color: '#fff3dc', i: 2.3 }, hemiSky: '#bcd6f0', hemiGround: '#6f8a52', hemiI: 1.25, lights: 0,
    grass: ['#8dbe62', '#a9cc6e', '#7db257', '#93c46a', '#b5d47a', '#82b85c', '#d2c26a', '#6fa650'],
  },
  dusk: {
    skyTop: '#1d2846', skyMid: '#6b5a7a', horizon: '#e0a070', fog: '#7f7782', fogDensity: 0.00034,
    sun: { az: 245, el: 3, color: '#ffb070', i: 0.9 }, hemiSky: '#6b6f95', hemiGround: '#3a4433', hemiI: 0.75, lights: 1,
    grass: ['#4f6a3f', '#5b7445', '#4a6339', '#56703f', '#62784a', '#4d6a3e', '#6d6a44', '#43603a'],
  },
}[preset.includes('dusk') ? 'dusk' : 'day'];

// ------------------------------------------------------------------ sky, light, fog
{
  const g = new THREE.SphereGeometry(60000, 32, 16);
  const c = [];
  const top = new THREE.Color(TOD.skyTop), mid = new THREE.Color(TOD.skyMid), hor = new THREE.Color(TOD.horizon);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, pos.getY(i) / 60000);
    const col = t < 0.08 ? hor.clone().lerp(mid, t / 0.08) : mid.clone().lerp(top, Math.min(1, (t - 0.08) / 0.5));
    c.push(col.r, col.g, col.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
}
scene.fog = new THREE.FogExp2(TOD.fog, TOD.fogDensity);
const sunDir = (() => {
  const a = (TOD.sun.az * Math.PI) / 180, e = (TOD.sun.el * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
})();
const sun = new THREE.DirectionalLight(TOD.sun.color, TOD.sun.i);
sun.position.copy(sunDir).multiplyScalar(1000);
scene.add(sun);
scene.add(new THREE.HemisphereLight(TOD.hemiSky, TOD.hemiGround, TOD.hemiI));

const DOT = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const flat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

// ------------------------------------------------------------------ ground: polder fields with ditches
{
  const water = new THREE.Mesh(new THREE.PlaneGeometry(120000, 120000), flat(preset.includes('dusk') ? '#33454f' : '#5a9bd0'));
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.6;
  scene.add(water);
  const far = new THREE.Mesh(new THREE.RingGeometry(16800, 70000, 64), flat(TOD.grass[0]));
  far.rotation.x = -Math.PI / 2;
  far.position.y = -0.25;
  scene.add(far);
}
const runways = eham.runways.filter((r) => ['18R', '06', '09', '18C', '18L', '04'].includes(r.id)).map((r) => {
  const t = ll(r.lat, r.lon);
  const d = dir(r.heading);
  const len = r.lengthFt * FT;
  return { id: r.id, thr: t, d, len, wid: r.widthFt * FT, hdg: r.heading, mid: { x: t.x + (d.x * len) / 2, z: t.z + (d.z * len) / 2 } };
});
const byId = (id) => {
  const r = eham.runways.find((x) => x.id === id);
  const t = ll(r.lat, r.lon), d = dir(r.heading), len = r.lengthFt * FT;
  return { id, thr: t, d, len, wid: r.widthFt * FT, hdg: r.heading, mid: { x: t.x + (d.x * len) / 2, z: t.z + (d.z * len) / 2 } };
};
const segDist = (p, r) => {
  const ax = r.thr.x, az = r.thr.z, bx = ax + r.d.x * r.len, bz = az + r.d.z * r.len;
  const t = Math.max(0, Math.min(1, ((p.x - ax) * (bx - ax) + (p.z - az) * (bz - az)) / (r.len * r.len)));
  return Math.hypot(p.x - (ax + t * (bx - ax)), p.z - (az + t * (bz - az)));
};
const terminal = ll(52.3125, 4.7655);
const nearAirport = (p) => runways.some((r) => segDist(p, r) < 420) || Math.hypot(p.x - terminal.x, p.z - terminal.z) < 1300;
{
  // Haarlemmermeer field grid, roughly aligned with the polder's main axis
  const ang = (-34 * Math.PI) / 180;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const cw = 170, ch = 72, gap = 4;
  const cells = [];
  for (let i = -105; i <= 105; i++)
    for (let j = -240; j <= 240; j++) {
      const u = i * cw, v = j * ch;
      const p = { x: u * ca - v * sa, z: u * sa + v * ca };
      if (Math.hypot(p.x, p.z) > 17000) continue;
      cells.push({ p, grass: nearAirport(p) });
    }
  const geo = new THREE.BoxGeometry(cw - gap, 0.6, ch - gap);
  const mesh = new THREE.InstancedMesh(geo, flat('#ffffff'), cells.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang);
  const col = new THREE.Color();
  cells.forEach((c, k) => {
    m.compose(new THREE.Vector3(c.p.x, c.grass ? -0.2 : -0.3 + rnd() * 0.1, c.p.z), q, new THREE.Vector3(c.grass ? 1.03 : 1, 1, c.grass ? 1.06 : 1));
    mesh.setMatrixAt(k, m);
    col.set(c.grass ? TOD.grass[k % 2 ? 0 : 2] : TOD.grass[Math.floor(rnd() * TOD.grass.length)]);
    mesh.setColorAt(k, col);
  });
  scene.add(mesh);
}

// ------------------------------------------------------------------ runways and markings
const ASPHALT = preset.includes('dusk') ? '#2e3238' : '#4a4f58';
const PAINT = preset.includes('dusk') ? '#9aa0a8' : '#eef1f4';
function stripe(x, z, hdg, along, across, y, color) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(across, along), new THREE.MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: -2 - y, polygonOffsetUnits: -2 }));
  m.rotation.order = 'YXZ';
  m.rotation.y = (-hdg * Math.PI) / 180;
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.02 * y, z);
  scene.add(m);
}
function designator(r, txt) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = PAINT; g.font = 'bold 150px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(txt, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshLambertMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -4 }));
  m.rotation.order = 'YXZ';
  m.rotation.y = (-r.hdg * Math.PI) / 180 + Math.PI;
  m.rotation.x = -Math.PI / 2;
  m.position.set(r.thr.x + r.d.x * 75, 0.08, r.thr.z + r.d.z * 75);
  scene.add(m);
}
const recip = (id) => {
  const n = ((+id.slice(0, 2) + 18 - 1) % 36) + 1;
  const s = { L: 'R', R: 'L', C: 'C' }[id[2]] ?? '';
  return String(n).padStart(2, '0') + s;
};
for (const r of runways) {
  stripe(r.mid.x, r.mid.z, r.hdg, r.len + 120, r.wid, 0, ASPHALT);
  // shoulders
  stripe(r.mid.x, r.mid.z, r.hdg, r.len + 120, r.wid + 16, -0.5, preset.includes('dusk') ? '#3b4048' : '#6b7280');
  const end = { thr: { x: r.thr.x + r.d.x * r.len, z: r.thr.z + r.d.z * r.len }, d: { x: -r.d.x, z: -r.d.z }, hdg: (r.hdg + 180) % 360 };
  for (const e of [r, end]) {
    // piano keys
    for (let k = -7; k <= 7; k++) {
      if (k === 0) continue;
      const off = k * 3.6 + Math.sign(k) * 2;
      const nx = -e.d.z, nz = e.d.x;
      stripe(e.thr.x + e.d.x * 25 + nx * off, e.thr.z + e.d.z * 25 + nz * off, e.hdg, 30, 1.8, 1, PAINT);
    }
    // aiming point
    for (const s of [-1, 1]) {
      const nx = -e.d.z, nz = e.d.x;
      stripe(e.thr.x + e.d.x * 400 + nx * 9 * s, e.thr.z + e.d.z * 400 + nz * 9 * s, e.hdg, 45, 9, 1, PAINT);
    }
  }
  designator(r, r.id);
  designator(end, recip(r.id));
  // centreline
  for (let s = 120; s < r.len - 120; s += 60) stripe(r.thr.x + r.d.x * s, r.thr.z + r.d.z * s, r.hdg, 30, 0.9, 1, PAINT);
  // parallel taxiway (generic; real layout not modelled)
  const nx = -r.d.z, nz = r.d.x, side = r.id === '18R' ? 1 : -1, off = 190 * side;
  stripe(r.mid.x + nx * off, r.mid.z + nz * off, r.hdg, r.len, 23, 0, ASPHALT);
  for (let s = 300; s < r.len; s += 700) {
    const cx = r.thr.x + r.d.x * s + nx * off * 0.5, cz = r.thr.z + r.d.z * s + nz * off * 0.5;
    stripe(cx, cz, (r.hdg + 90) % 360, Math.abs(off) - r.wid / 2, 23, 0, ASPHALT);
  }
}

// ------------------------------------------------------------------ runway lights (dusk)
if (TOD.lights) {
  const dot = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const pts = (list, color, size) => {
    const g = new THREE.BufferGeometry().setFromPoints(list.map((p) => new THREE.Vector3(p.x, 0.6, p.z)));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color, size, map: dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false, fog: false })));
  };
  for (const r of runways) {
    const nx = -r.d.z, nz = r.d.x, edge = [], thr = [], endL = [];
    for (let s = 0; s <= r.len; s += 60) for (const k of [-1, 1]) edge.push({ x: r.thr.x + r.d.x * s + nx * k * (r.wid / 2 + 1), z: r.thr.z + r.d.z * s + nz * k * (r.wid / 2 + 1) });
    for (let k = -22; k <= 22; k += 4) {
      thr.push({ x: r.thr.x + nx * k, z: r.thr.z + nz * k });
      endL.push({ x: r.thr.x + r.d.x * r.len + nx * k, z: r.thr.z + r.d.z * r.len + nz * k });
    }
    pts(edge, '#fff1d0', 7);
    pts(thr, '#5dff8a', 9);
    pts(endL, '#ff4a3a', 9);
    if (r.id === '18R' || r.id === '06') {
      const al = [];
      for (let s = 30; s <= 900; s += 30) {
        al.push({ x: r.thr.x - r.d.x * s, z: r.thr.z - r.d.z * s });
        if (s % 150 === 0) for (let k = -15; k <= 15; k += 5) al.push({ x: r.thr.x - r.d.x * s + nx * k, z: r.thr.z - r.d.z * s + nz * k });
      }
      pts(al, '#fff6e0', 9);
    }
  }
  // apron floodlights
  const apron = [];
  for (let i = 0; i < 40; i++) apron.push({ x: terminal.x + (rnd() - 0.5) * 1600, z: terminal.z + (rnd() - 0.5) * 900 });
  pts(apron, '#ffcf8a', 10);
}

// ------------------------------------------------------------------ terminal area (generic blocks, not the real layout)
{
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(1900, 1100), new THREE.MeshLambertMaterial({ color: preset.includes('dusk') ? '#4a4d52' : '#9ca3ac', polygonOffset: true, polygonOffsetFactor: -1 }));
  apron.rotation.x = -Math.PI / 2;
  apron.rotation.z = 0.35;
  apron.position.set(terminal.x, 0.01, terminal.z);
  scene.add(apron);
  const blocks = [
    [0, 0, 700, 90, 22], [-420, 260, 90, 420, 14], [-80, 300, 80, 460, 14], [260, 280, 80, 420, 14], [560, 180, 80, 360, 14],
    [120, -240, 380, 120, 32], [-520, -200, 220, 160, 18],
  ];
  for (const [dx, dz, w, d, h] of blocks) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flat(preset.includes('dusk') ? '#6d7686' : '#c7cdd6'));
    const a = 0.35, x = dx * Math.cos(a) + dz * Math.sin(a), z = -dx * Math.sin(a) + dz * Math.cos(a);
    m.rotation.y = a;
    m.position.set(terminal.x + x, h / 2, terminal.z + z);
    scene.add(m);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, 1, d * 0.96), flat(preset.includes('dusk') ? '#8a92a0' : '#e6eaf0'));
    roof.rotation.y = a;
    roof.position.set(terminal.x + x, h + 0.5, terminal.z + z);
    scene.add(roof);
  }
}

// ------------------------------------------------------------------ control towers
function tower(lat, lon, h) {
  const p = ll(lat, lon), g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, h - 12, 8), flat('#d9dde3'));
  shaft.position.y = (h - 12) / 2;
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(11, 8, 7, 8), flat('#2d3e57'));
  cab.position.y = h - 8;
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(9, 11.5, 2, 8), flat('#eef1f4'));
  roof.position.y = h - 3.5;
  const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(4, 0), flat('#ffffff'));
  dome.position.y = h + 1;
  g.add(shaft, cab, roof, dome);
  g.position.set(p.x, 0, p.z);
  scene.add(g);
}
const TWR = { centre: { lat: 52.30752, lon: 4.76244, h: 101, eye: 92 }, west: { lat: 52.3317, lon: 4.71787, h: 60, eye: 54 } };
if (!preset.startsWith('centre')) tower(TWR.centre.lat, TWR.centre.lon, TWR.centre.h);
if (!preset.startsWith('west')) tower(TWR.west.lat, TWR.west.lon, TWR.west.h);

// ------------------------------------------------------------------ scenery: tree rows, turbines, farms, distant city
{
  const cone = new THREE.ConeGeometry(4, 14, 5);
  const trees = [];
  for (let k = 0; k < 260; k++) {
    const a = rnd() * Math.PI * 2, d = 900 + rnd() * 9000;
    const base = { x: Math.cos(a) * d, z: Math.sin(a) * d };
    if (nearAirport(base)) continue;
    const ang = (-34 * Math.PI) / 180 + (rnd() < 0.5 ? 0 : Math.PI / 2);
    for (let i = 0; i < 14; i++) trees.push({ x: base.x + Math.cos(ang) * i * 14, z: base.z + Math.sin(ang) * i * 14, s: 0.7 + rnd() * 0.6 });
  }
  const tm = new THREE.InstancedMesh(cone, flat('#ffffff'), trees.length);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  trees.forEach((t, i) => {
    m.compose(new THREE.Vector3(t.x, 7 * t.s, t.z), new THREE.Quaternion(), new THREE.Vector3(t.s, t.s, t.s));
    tm.setMatrixAt(i, m);
    col.set(preset.includes('dusk') ? (i % 3 ? '#2f4a2c' : '#3a5534') : i % 3 ? '#3e7a3c' : '#5fa04e');
    tm.setColorAt(i, col);
  });
  scene.add(tm);
  // farmsteads
  for (let k = 0; k < 60; k++) {
    const a = rnd() * Math.PI * 2, d = 2000 + rnd() * 9000, p = { x: Math.cos(a) * d, z: Math.sin(a) * d };
    if (nearAirport(p)) continue;
    const house = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 22), flat(preset.includes('dusk') ? '#7a6a5a' : '#d8cbb8'));
    house.position.set(p.x, 3, p.z);
    house.rotation.y = -0.6;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(13, 7, 4), flat(preset.includes('dusk') ? '#4a3026' : '#7a3b2a'));
    roof.position.set(p.x, 9.5, p.z);
    roof.rotation.y = -0.6 + Math.PI / 4;
    roof.scale.set(1, 1, 1.6);
    scene.add(house, roof);
  }
  // wind turbines to the west
  for (let k = 0; k < 9; k++) {
    const p = { x: -9000 - (k % 3) * 600, z: -6000 + k * 900 };
    const g = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.2, 90, 6), flat('#eef1f4'));
    mast.position.y = 45;
    g.add(mast);
    for (let b = 0; b < 3; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.5, 42, 0.6), flat('#f4f6f9'));
      blade.geometry.translate(0, 21, 0);
      blade.position.set(0, 90, 2);
      blade.rotation.z = (b * 2 * Math.PI) / 3 + k;
      g.add(blade);
    }
    g.position.set(p.x, 0, p.z);
    g.rotation.y = 0.8;
    scene.add(g);
  }
  // Amsterdam skyline, north-east, mostly lost in haze
  for (let k = 0; k < 70; k++) {
    const a = 0.65 + rnd() * 0.5, d = 11000 + rnd() * 5000;
    const h = 15 + rnd() * rnd() * 90;
    const b = new THREE.Mesh(new THREE.BoxGeometry(40 + rnd() * 80, h, 40 + rnd() * 80), flat(preset.includes('dusk') ? '#4c5262' : '#a7b4c6'));
    b.position.set(Math.sin(a) * d, h / 2, -Math.cos(a) * d);
    scene.add(b);
  }
}

// ------------------------------------------------------------------ clouds
if (!preset.includes('dusk')) {
  for (let k = 0; k < 26; k++) {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(140 + rnd() * 160, 0), flat('#ffffff', { fog: false, emissive: '#9fb2c6' }));
      s.position.set(i * 260 - 520 + rnd() * 100, rnd() * 120, rnd() * 200);
      s.scale.y = 0.45;
      g.add(s);
    }
    const a = rnd() * Math.PI * 2, d = 7000 + rnd() * 20000;
    g.position.set(Math.cos(a) * d, 2200 + rnd() * 900, Math.sin(a) * d);
    scene.add(g);
  }
}

// ------------------------------------------------------------------ aircraft (procedural low-poly)
const TYPES = {
  A320: { len: 37.6, span: 35.8, d: 3.95, fin: 6.0 },
  B738: { len: 39.5, span: 35.8, d: 3.76, fin: 6.4 },
  A332: { len: 58.8, span: 60.3, d: 5.64, fin: 9.0 },
  E190: { len: 36.2, span: 28.7, d: 3.0, fin: 5.5 },
};
function aircraft(type, tail, belly, opts = {}) {
  const T = TYPES[type], r = T.d / 2, g = new THREE.Group();
  const white = flat('#f4f6f9'), grey = flat('#b9c3ce'), dark = flat('#3a4250');
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, T.len * 0.66, 8), white);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(r, T.len * 0.12, 8), white);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -T.len * 0.39;
  g.add(nose);
  const tailc = new THREE.Mesh(new THREE.ConeGeometry(r, T.len * 0.22, 8), white);
  tailc.rotation.x = Math.PI / 2;
  tailc.position.set(0, r * 0.35, T.len * 0.44);
  g.add(tailc);
  const bellyM = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.01, r * 1.01, T.len * 0.6, 8, 1, true, Math.PI * 0.62, Math.PI * 0.76), flat(belly));
  bellyM.rotation.x = Math.PI / 2;
  g.add(bellyM);
  // swept wing: one extruded trapezoid per side
  const wing = (side) => {
    const s = new THREE.Shape();
    const root = T.len * 0.2, tip = root * 0.3, semi = T.span / 2 - r, sweep = semi * 0.55;
    s.moveTo(0, 0); s.lineTo(semi, sweep); s.lineTo(semi, sweep + tip); s.lineTo(0, root); s.closePath();
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: false }), grey);
    m.rotation.x = Math.PI / 2;
    m.scale.x = side;
    m.position.set(side * r * 0.8, -r * 0.45, -T.len * 0.1);
    m.rotation.z = side * 0.06; // dihedral
    return m;
  };
  g.add(wing(1), wing(-1));
  const stab = (side) => {
    const s = new THREE.Shape();
    const root = T.len * 0.1, semi = T.span * 0.18, sweep = semi * 0.6;
    s.moveTo(0, 0); s.lineTo(semi, sweep); s.lineTo(semi, sweep + root * 0.4); s.lineTo(0, root); s.closePath();
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false }), grey);
    m.rotation.x = Math.PI / 2;
    m.scale.x = side;
    m.position.set(0, r * 0.4, T.len * 0.4);
    return m;
  };
  g.add(stab(1), stab(-1));
  {
    const s = new THREE.Shape();
    const root = T.len * 0.17;
    s.moveTo(0, 0); s.lineTo(T.fin * 0.9, T.fin); s.lineTo(T.fin * 0.9 + root * 0.45, T.fin); s.lineTo(root, 0); s.closePath();
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.4, bevelEnabled: false }), flat(tail));
    m.rotation.y = -Math.PI / 2;
    m.position.set(-0.2, r * 0.6, T.len * 0.3);
    g.add(m);
  }
  for (const side of [-1, 1]) {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(T.d * 0.32, T.d * 0.28, T.len * 0.11, 8), grey);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(side * T.span * 0.17, -r * 1.05, -T.len * 0.12);
    g.add(eng);
  }
  if (opts.gear) {
    for (const [x, z] of [[0, -T.len * 0.33], [-1.6 * r, 0], [1.6 * r, 0]]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 1.2), dark);
      w.position.set(x, -r - 0.9, z);
      g.add(w);
    }
  }
  if (opts.lights && TOD.lights) {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT, color: '#fff4d6', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, sizeAttenuation: false }));
    glow.scale.set(0.009, 0.009, 1);
    glow.position.set(0, -r, -T.len * 0.45);
    g.add(glow);
  }
  g.userData.height = r;
  return g;
}
/** Place an aircraft `distM` along a runway's centreline from its threshold (negative = on final). */
function placeOnRunway(ac, rwy, distM, alt, pitchDeg = 0) {
  const r = byId(rwy);
  const r0 = ac.userData.height;
  ac.position.set(r.thr.x + r.d.x * distM, alt + r0 + 1.6, r.thr.z + r.d.z * distM);
  ac.rotation.order = 'YXZ';
  ac.rotation.y = (-r.hdg * Math.PI) / 180;
  ac.rotation.x = (pitchDeg * Math.PI) / 180;
  scene.add(ac);
  return ac;
}
const glide = (nmOut) => nmOut * NM * Math.tan((3 * Math.PI) / 180) + 15;
const COLORS = { KLM: '#1b6fd1', TRA: '#22b36a', EZY: '#ff7a1a', BAW: '#24345c', DLH: '#0a1d3d' };

const labels = [];
const tag = (ac, cs, info, kind) => labels.push({ ac, cs, info, kind });

// ------------------------------------------------------------------ presets
const cam = new THREE.PerspectiveCamera(40, W / H, 1, 90000);
function cabLook(t, bearing, depression, fov) {
  const p = ll(t.lat, t.lon);
  cam.position.set(p.x, t.eye, p.z);
  const b = (bearing * Math.PI) / 180, e = (-depression * Math.PI) / 180;
  cam.lookAt(p.x + Math.sin(b) * Math.cos(e) * 1000, t.eye + Math.sin(e) * 1000, p.z - Math.cos(b) * Math.cos(e) * 1000);
  cam.fov = fov;
  cam.updateProjectionMatrix();
}
function cabAt(t, lookLat, lookLon, lookAlt, fov) {
  const p = ll(t.lat, t.lon);
  cam.position.set(p.x, t.eye, p.z);
  const q = typeof lookLat === 'object' ? lookLat : ll(lookLat, lookLon);
  cam.lookAt(q.x, lookAlt, q.z);
  cam.fov = fov;
  cam.updateProjectionMatrix();
}

if (preset.startsWith('west')) {
  const a1 = placeOnRunway(aircraft('A332', COLORS.KLM, '#1b6fd1', { gear: true, lights: true }), '18R', -2 * NM, glide(2), 2.5);
  tag(a1, 'KLM66P', 'A332/H · 2 NM final 18R', 'cleared');
  const a2 = placeOnRunway(aircraft('A320', COLORS.EZY, '#ff7a1a', { gear: true }), '18R', 1900, 0, 0);
  tag(a2, 'EZY81QK', 'A320 · rolling out, vacate E5', 'normal');
  const a3 = placeOnRunway(aircraft('B738', COLORS.TRA, '#22b36a', { gear: true, lights: true }), '18R', -7.5 * NM, glide(7.5), 2);
  tag(a3, 'TRA6015', 'B738 · 7 NM, on Approach', 'pending');
  const r = byId('18R');
  if (preset === 'west-bino') {
    const t = a1.position;
    cabAt(TWR.west, { x: t.x, z: t.z }, 0, t.y - 95, 2.6);
  } else {
    cabLook(TWR.west, +(P.get('b') ?? 340), +(P.get('dep') ?? 3.2), 32);
  }
} else {
  // centre tower, departures on 24
  const r = byId('24');
  const d1 = placeOnRunway(aircraft('B738', COLORS.TRA, '#22b36a', { lights: true, gear: true }), '24', 60, 0, 0);
  tag(d1, 'TRA5422', 'B738 · lined up 24', 'selected');
  const d2 = placeOnRunway(aircraft('E190', COLORS.KLM, '#1b6fd1', { lights: true, gear: true }), '24', 1100, 0, 0);
  tag(d2, 'KLM1601', 'E190 · take-off roll', 'normal');
  const hp = aircraft('A320', COLORS.EZY, '#ff7a1a', { lights: true, gear: true });
  {
    const nx = -r.d.z, nz = r.d.x;
    hp.position.set(r.thr.x + r.d.x * 120 - nx * 110, hp.userData.height + 1.6, r.thr.z + r.d.z * 120 - nz * 110);
    hp.rotation.y = (-(r.hdg - 90) * Math.PI) / 180;
    scene.add(hp);
    tag(hp, 'EZY45MP', 'A320 · holding point S1', 'pending');
  }
  cabLook(TWR.centre, +(P.get('b') ?? 145), +(P.get('dep') ?? 6), 46);
  // parked aircraft on the apron in the foreground
  const tp = ll(TWR.centre.lat, TWR.centre.lon);
  [['B738', COLORS.KLM], ['A320', COLORS.EZY], ['E190', COLORS.KLM], ['B738', COLORS.TRA]].forEach(([t, c], i) => {
    const a = aircraft(t, c, c, { gear: true });
    a.position.set(tp.x + 120 + i * 55, a.userData.height + 1.6, tp.z + 260 - i * 18);
    a.rotation.y = Math.PI * 0.9;
    scene.add(a);
  });
  const apron2 = new THREE.Mesh(new THREE.PlaneGeometry(330, 120), new THREE.MeshLambertMaterial({ color: '#4a4d52', polygonOffset: true, polygonOffsetFactor: -1 }));
  apron2.rotation.x = -Math.PI / 2;
  apron2.position.set(tp.x + 200, 0.01, tp.z + 235);
  scene.add(apron2);
}

renderer.render(scene, cam);
// screen positions for HTML labels on the design board
cam.updateMatrixWorld();
window.__labels = labels.map((l) => {
  const v = l.ac.position.clone().add(new THREE.Vector3(0, l.ac.userData.height * 2, 0)).project(cam);
  return { cs: l.cs, info: l.info, kind: l.kind, x: Math.round(((v.x + 1) / 2) * W), y: Math.round(((1 - v.y) / 2) * H), visible: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
});
window.__done = true;
