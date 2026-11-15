// Throwaway style test: "clean semi-realistic". One shot from Tower West. Not app code.
// Frame: metres, x = east, y = up, z = south. Origin = EHAM reference point.
import * as THREE from 'three';

const eham = await (await fetch('./EHAM.json')).json();
const P = new URLSearchParams(location.search);
const W = +(P.get('w') ?? 2240), H = +(P.get('h') ?? 1200);
const num = (k, d) => +(P.get(k) ?? d);

const FT = 0.3048, NM = 1852;
const cosLat = Math.cos((eham.lat * Math.PI) / 180);
const ll = (lat, lon) => ({ x: (lon - eham.lon) * 111320 * cosLat, z: -(lat - eham.lat) * 111320 });

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = num('exp', 0.62);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();

// ------------------------------------------------------------------ sky and light
const sunAz = num('az', 205), sunEl = num('el', 34);
const sunDir = (() => {
  const a = (sunAz * Math.PI) / 180, e = (sunEl * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
})();
{
  // gradient dome: deep blue overhead, pale at the horizon (not tone-mapped, so the colours are exact)
  const g = new THREE.SphereGeometry(85000, 48, 24);
  const top = new THREE.Color(P.get('top') ?? '#2a66ad'), mid = new THREE.Color('#6fa6da'), hor = new THREE.Color(P.get('hor') ?? '#cfe1f0');
  const c = [], pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, pos.getY(i) / 85000);
    const col = t < 0.1 ? hor.clone().lerp(mid, Math.pow(t / 0.1, 0.8)) : mid.clone().lerp(top, Math.min(1, (t - 0.1) / 0.45));
    c.push(col.r, col.g, col.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false })));
  // soft fair-weather clouds: billboards built from overlapping blurred blobs
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cloudTex = () => {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 256;
    const x = cv.getContext('2d');
    for (let k = 0; k < 26; k++) {
      const px = 90 + rnd() * 332, py = 150 - rnd() * rnd() * 90, r = 34 + rnd() * 52;
      const gr = x.createRadialGradient(px, py, 0, px, py, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 512, 256);
    }
    // flat, slightly grey base
    const sh = x.createLinearGradient(0, 120, 0, 200);
    sh.addColorStop(0, 'rgba(120,135,155,0)'); sh.addColorStop(1, 'rgba(120,135,155,0.35)');
    x.globalCompositeOperation = 'source-atop'; x.fillStyle = sh; x.fillRect(0, 0, 512, 256);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const n = num('clouds', 22);
  for (let k = 0; k < n; k++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex(), transparent: true, depthWrite: false, fog: false, toneMapped: false, opacity: 0.92 }));
    const brg = ((250 + rnd() * 160) * Math.PI) / 180, d = 14000 + rnd() * 30000, w = 2600 + rnd() * 3200;
    sp.scale.set(w, w * 0.42, 1);
    sp.position.set(Math.sin(brg) * d, 1500 + rnd() * 1400 + d * 0.035, -Math.cos(brg) * d);
    scene.add(sp);
  }
}
const HAZE = new THREE.Color(P.get('haze') ?? '#c6d9ea');
scene.fog = new THREE.FogExp2(HAZE, num('fog', 0.00007));

const sun = new THREE.DirectionalLight('#fff4e2', num('sun', 3.0));
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight('#cfe2ff', '#8a8f7a', num('hemi', 1.1)));

// ------------------------------------------------------------------ ground: aerial imagery in three tiers
const loader = new THREE.TextureLoader();
const aniso = renderer.capabilities.getMaxAnisotropy();
async function ground(name, y, order) {
  const b = await (await fetch(`./${name}.json`)).json();
  const tex = await loader.loadAsync(`./${name}.jpg`);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  const g = new THREE.PlaneGeometry(b.xmax - b.xmin, b.zmax - b.zmin);
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, color: P.get('gtint') ?? '#ffffff' }));
  m.rotation.x = -Math.PI / 2;
  m.position.set((b.xmin + b.xmax) / 2, y, (b.zmin + b.zmax) / 2);
  m.receiveShadow = true;
  m.renderOrder = order;
  scene.add(m);
}
await ground('outer', 0, 0);
await ground('mid', 0.4, 1);
await ground('inner', 0.8, 2);
const GROUND_Y = 0.8;
{
  // beyond the imagery: plain haze-coloured land so the horizon is clean
  const far = new THREE.Mesh(new THREE.RingGeometry(29000, 90000, 64), new THREE.MeshLambertMaterial({ color: '#6f7f63' }));
  far.rotation.x = -Math.PI / 2;
  far.position.y = -0.5;
  scene.add(far);
}

// ------------------------------------------------------------------ aircraft: smooth procedural
const TYPES = {
  A320: { len: 37.6, span: 35.8, d: 3.95, fin: 5.9, engD: 2.2, engL: 4.4, gearH: 3.3 },
  A332: { len: 58.8, span: 60.3, d: 5.64, fin: 8.6, engD: 3.1, engL: 6.2, gearH: 4.6 },
};
function liveryTexture(body, cheat) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 2048; // u (around: 0 belly, .25 right, .5 top, .75 left) × v (nose → tail)
  const g = c.getContext('2d');
  g.fillStyle = '#f3f5f7'; g.fillRect(0, 0, 1024, 2048);
  if (body) { g.fillStyle = body; g.fillRect(1024 * 0.27, 0, 1024 * 0.46, 2048); }
  g.fillStyle = '#c9cfd6'; g.fillRect(0, 0, 1024 * 0.1, 2048); g.fillRect(1024 * 0.9, 0, 1024 * 0.1, 2048); // belly
  for (const u of [0.29, 0.71]) {
    if (cheat) { g.fillStyle = cheat; g.fillRect(1024 * (u - 0.035), 0, 1024 * 0.02, 2048); }
    g.fillStyle = '#27313f';
    for (let v = 0.16; v < 0.8; v += 0.0105) g.fillRect(1024 * (u - 0.006), 2048 * v, 1024 * 0.012, 2048 * 0.005);
  }
  // cockpit windows
  g.fillStyle = '#1c2530';
  g.beginPath();
  g.moveTo(1024 * 0.3, 2048 * 0.075); g.lineTo(1024 * 0.7, 2048 * 0.075); g.lineTo(1024 * 0.64, 2048 * 0.05); g.lineTo(1024 * 0.36, 2048 * 0.05);
  g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}
const stdMat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.05, side: THREE.DoubleSide, ...o });
function surface(pts, thick, mat) {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.45, bevelSize: thick * 0.9, bevelSegments: 3 });
  g.translate(0, 0, -thick / 2);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}
function aircraft(type, { tail, body = null, cheat = null, cowl = '#dfe3e8', gear = true }) {
  const T = TYPES[type], r = T.d / 2, L = T.len, g = new THREE.Group();
  // fuselage: lathe profile, nose at -z, tail swept up
  const prof = [];
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    let rad = r;
    if (s < 0.12) rad = r * Math.pow(Math.sin((s / 0.12) * Math.PI * 0.5), 0.62);
    else if (s > 0.66) rad = r * Math.max(0.05, Math.cos(((s - 0.66) / 0.34) * Math.PI * 0.5) ** 0.75);
    prof.push(new THREE.Vector2(Math.max(rad, 0.02), (s - 0.5) * L));
  }
  const fg = new THREE.LatheGeometry(prof, 40);
  fg.rotateX(Math.PI / 2);
  const pos = fg.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const s = pos.getZ(i) / L + 0.5;
    if (s > 0.66) pos.setY(i, pos.getY(i) + ((s - 0.66) / 0.34) ** 1.6 * r * 0.78);
    if (s < 0.1) pos.setY(i, pos.getY(i) - (1 - s / 0.1) ** 2 * r * 0.22);
  }
  fg.computeVertexNormals();
  const fus = new THREE.Mesh(fg, stdMat({ map: liveryTexture(body, cheat) }));
  fus.castShadow = true;
  g.add(fus);

  const grey = stdMat({ color: '#c3cad2', roughness: 0.5 });
  const semi = T.span / 2, rootC = L * 0.205, tipC = rootC * 0.27, sweep = semi * 0.52;
  for (const side of [1, -1]) {
    // wing planform in (span, chord) → rotate flat
    const w = surface([[0, 0], [semi * 0.34, sweep * 0.34], [semi, sweep], [semi, sweep + tipC], [semi * 0.34, sweep * 0.34 + rootC * 0.62], [0, rootC]], 0.3, grey);
    w.rotation.x = Math.PI / 2;
    w.scale.x = side;
    w.position.set(0, -r * 0.55, -L * 0.115);
    w.rotation.z = side * -0.09; // dihedral
    g.add(w);
    // winglet
    const wl = surface([[0, 0], [1.0, 2.4], [1.7, 2.4], [tipC, 0]], 0.18, stdMat({ color: tail }));
    wl.rotation.y = -Math.PI / 2;
    wl.position.set(side * semi * 0.995, -r * 0.55 + semi * 0.09, -L * 0.115 + sweep);
    wl.rotation.z = side * -0.25;
    g.add(wl);
    // tailplane
    const ss = T.span * 0.19;
    const st = surface([[0, 0], [ss, ss * 0.62], [ss, ss * 0.62 + L * 0.045], [0, L * 0.105]], 0.32, grey);
    st.rotation.x = Math.PI / 2;
    st.scale.x = side;
    st.position.set(0, r * 0.55, L * 0.385);
    st.rotation.z = side * -0.1;
    g.add(st);
    // engine
    const eR = T.engD / 2, eL = T.engL;
    const ep = [];
    for (let i = 0; i <= 20; i++) {
      const s = i / 20;
      ep.push(new THREE.Vector2(eR * (0.86 + 0.14 * Math.sin(Math.min(1, s / 0.3) * Math.PI * 0.5)) * (s > 0.6 ? 1 - (s - 0.6) * 0.75 : 1), (s - 0.5) * eL));
    }
    const eg = new THREE.LatheGeometry(ep, 28);
    eg.rotateX(Math.PI / 2);
    const eng = new THREE.Mesh(eg, stdMat({ color: cowl, roughness: 0.35 }));
    eng.castShadow = true;
    const ex = side * semi * 0.33, ey = -r * 0.55 - eR * 0.95, ez = -L * 0.115 + sweep * 0.33 - eL * 0.25;
    eng.position.set(ex, ey, ez);
    g.add(eng);
    const fan = new THREE.Mesh(new THREE.CircleGeometry(eR * 0.84, 28), new THREE.MeshStandardMaterial({ color: '#20262e', roughness: 0.8, side: THREE.DoubleSide }));
    fan.position.set(ex, ey, ez - eL * 0.47);
    g.add(fan);
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.35, eR * 0.9, eL * 0.6), grey);
    pylon.position.set(ex, ey + eR * 0.95, ez + eL * 0.1);
    g.add(pylon);
    if (gear) {
      const dark = new THREE.MeshStandardMaterial({ color: '#23282f', roughness: 0.9 });
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, T.gearH, 10), grey);
      strut.position.set(side * r * 1.75, -r * 0.6 - T.gearH / 2, L * 0.03);
      g.add(strut);
      for (const dz of [-0.75, 0.75]) {
        const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.9, 18), dark);
        wh.rotation.z = Math.PI / 2;
        wh.position.set(side * r * 1.75, -r * 0.6 - T.gearH + 0.3, L * 0.03 + dz);
        wh.castShadow = true;
        g.add(wh);
      }
    }
  }
  if (gear) {
    const dark = new THREE.MeshStandardMaterial({ color: '#23282f', roughness: 0.9 });
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, T.gearH, 10), grey);
    strut.position.set(0, -r * 0.6 - T.gearH / 2, -L * 0.36);
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.7, 18), dark);
    wh.rotation.z = Math.PI / 2;
    wh.position.set(0, -r * 0.6 - T.gearH + 0.14, -L * 0.36);
    g.add(strut, wh);
  }
  // fin
  const fin = surface([[0, 0], [T.fin * 0.95, T.fin], [T.fin * 0.95 + L * 0.06, T.fin], [L * 0.16, 0]], 0.36, stdMat({ color: tail }));
  fin.rotation.y = -Math.PI / 2;
  fin.position.set(0, r * 0.95, L * 0.3);
  g.add(fin);
  g.userData.wheelBase = r * 0.6 + T.gearH + 0.28;
  return g;
}

const rw = eham.runways.find((r) => r.id === '18R');
const thr = ll(rw.lat, rw.lon);
const hr = (rw.heading * Math.PI) / 180;
const rd = { x: Math.sin(hr), z: -Math.cos(hr) };
function place(ac, alongM, agl, pitchDeg = 0) {
  ac.position.set(thr.x + rd.x * alongM, GROUND_Y + ac.userData.wheelBase + agl, thr.z + rd.z * alongM);
  ac.rotation.order = 'YXZ';
  ac.rotation.y = -hr;
  ac.rotation.x = (pitchDeg * Math.PI) / 180;
  scene.add(ac);
  return ac;
}
const glide = (nm) => nm * NM * Math.tan((3 * Math.PI) / 180) + 15;

const rolling = place(aircraft('A320', { tail: '#f36a12', cowl: '#f36a12', cheat: '#f36a12' }), num('roll', 2750), 0, -0.5);
const final = place(aircraft('A332', { tail: '#1f6fd0', body: '#4aa3e6', cowl: '#f3f5f7' }), -num('fin', 0.9) * NM, glide(num('fin', 0.9)), 3);

// soft shadow around the foreground aircraft
sun.position.copy(rolling.position).addScaledVector(sunDir, 400);
sun.target.position.copy(rolling.position);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 50, far: 800 });
sun.shadow.bias = -0.0005;
sun.shadow.radius = 4;

// ------------------------------------------------------------------ camera: Tower West cab
const tw = ll(52.3317, 4.71787);
const cam = new THREE.PerspectiveCamera(num('fov', 27), W / H, 2, 120000);
cam.position.set(tw.x, 54, tw.z);
{
  const b = (num('b', 329) * Math.PI) / 180, e = (-num('dep', 4.2) * Math.PI) / 180;
  cam.lookAt(tw.x + Math.sin(b) * Math.cos(e) * 1000, 54 + Math.sin(e) * 1000, tw.z - Math.cos(b) * Math.cos(e) * 1000);
}
if (P.get('look') === 'roll') cam.lookAt(rolling.position);
if (P.get('look') === 'fin') cam.lookAt(final.position);
renderer.render(scene, cam);
cam.updateMatrixWorld();
window.__labels = [['roll', rolling], ['fin', final]].map(([k, a]) => {
  const v = a.position.clone().project(cam);
  return { k, x: +(((v.x + 1) / 2) * 100).toFixed(1), y: +(((1 - v.y) / 2) * 100).toFixed(1), dist: Math.round(a.position.distanceTo(cam.position)) };
});
window.__done = true;
