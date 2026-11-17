/**
 * Parked aircraft and jet bridges in a few draw calls: one low-detail model per type and livery, copied
 * to every stand and merged by material. Placement lives in stands.ts.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildAircraft } from './aircraftMesh';
import { airframe } from './math';
import type { Bridge, Parked, Vehicle } from './stands';

/** Mirrored parts (scale -1) baked into a geometry face the wrong way: swap two corners of each triangle. */
function flipWinding(geo: THREE.BufferGeometry) {
  for (const attr of Object.values(geo.attributes) as THREE.BufferAttribute[]) {
    const a = attr.array;
    const n = attr.itemSize;
    for (let t = 0; t < attr.count; t += 3)
      for (let k = 0; k < n; k++) {
        const i = (t + 1) * n + k;
        const j = (t + 2) * n + k;
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
  }
}

/** One aircraft model merged into one geometry per material, in the model's own frame. */
function template(type: string, airline: string): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  const g = buildAircraft(type, airline, true);
  g.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const mat = m.material as THREE.Material;
    if (mat.transparent) return; // propeller discs
    const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(
      m.matrixWorld,
    );
    for (const k of Object.keys(geo.attributes))
      if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (m.matrixWorld.determinant() < 0) flipWinding(geo);
    if (!geo.attributes.uv)
      geo.setAttribute(
        'uv',
        new THREE.BufferAttribute(new Float32Array(geo.attributes.position!.count * 2), 2),
      );
    (byMat.get(mat) ?? byMat.set(mat, []).get(mat)!).push(geo);
  });
  g.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
  return [...byMat].map(([mat, geos]) => {
    const geo = mergeGeometries(geos)!;
    geos.forEach((x) => x.dispose());
    return { geo, mat };
  });
}

const up = new THREE.Vector3(0, 1, 0);

/** A box with a vertex colour, turned by `yaw` (radians, three.js Y rotation) and placed at x, y, z. */
function box(w: number, h: number, l: number, yaw: number, x: number, y: number, z: number, color: string) {
  const g = new THREE.BoxGeometry(w, h, l).toNonIndexed().rotateY(yaw).translate(x, y, z);
  const c = new THREE.Color(color);
  const col = new Float32Array(g.attributes.position!.count * 3);
  for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

/** A jet bridge: rotunda at the wall, a tunnel with a window band, the cab at the door, a drive unit on legs. */
function bridgeParts(b: Bridge): THREE.BufferGeometry[] {
  const dx = b.b.x - b.a.x;
  const dz = b.b.z - b.a.z;
  const d = Math.hypot(dx, dz);
  const ux = dx / d;
  const uz = dz / d;
  const yaw = Math.atan2(dx, dz);
  const at = (t: number) => ({ x: b.a.x + ux * t, z: b.a.z + uz * t });
  const top = b.y + 3.2;
  const out: THREE.BufferGeometry[] = [];
  const rot = at(2.2);
  const rotunda = new THREE.CylinderGeometry(2.3, 2.3, top, 10)
    .toNonIndexed()
    .translate(rot.x, top / 2, rot.z);
  const c = new THREE.Color('#b8bdc2');
  const col = new Float32Array(rotunda.attributes.position!.count * 3);
  for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
  rotunda.setAttribute('color', new THREE.BufferAttribute(col, 3));
  rotunda.deleteAttribute('uv');
  out.push(rotunda);
  const t0 = 4.4;
  const t1 = Math.max(t0 + 1, d - 3.2);
  const mid = at((t0 + t1) / 2);
  out.push(box(2.6, 2.9, t1 - t0, yaw, mid.x, b.y + 1.45, mid.z, '#c8ccd1'));
  out.push(box(2.7, 0.9, t1 - t0, yaw, mid.x, b.y + 1.7, mid.z, '#5f7484'));
  const cab = at(d - 1.6);
  out.push(box(3.6, 3.3, 3.2, yaw, cab.x, b.y + 1.65, cab.z, '#d4d7da'));
  const wheels = at(t0 + (t1 - t0) * 0.75);
  out.push(box(3.4, 1.1, 1.6, yaw, wheels.x, 0.55, wheels.z, '#4f5358'));
  for (const s of [-1, 1]) {
    const leg = { x: wheels.x + uz * s * 1.2, z: wheels.z - ux * s * 1.2 };
    out.push(box(0.45, b.y - 1.1, 0.45, yaw, leg.x, 1.1 + (b.y - 1.1) / 2, leg.z, '#8d9298'));
  }
  return out;
}

/**
 * Parked aircraft (merged per material), their ground shadows (instanced), the jet bridges and the service
 * vehicles. `lit` are the materials the apron floodlights brighten at night.
 */
export function apronObjects(
  parked: Parked[],
  bridges: Bridge[],
  vehicles: Vehicle[],
  shadowTex: THREE.Texture,
): { objects: THREE.Object3D[]; disposables: { dispose(): void }[]; lit: THREE.MeshStandardMaterial[] } {
  const objects: THREE.Object3D[] = [];
  const disposables: { dispose(): void }[] = [];
  const lit: THREE.MeshStandardMaterial[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const pose = (p: Parked, y: number, scale = one) =>
    m.compose(new THREE.Vector3(p.x, y, p.z), q.setFromAxisAngle(up, (-p.headingDeg * Math.PI) / 180), scale);

  // every parked aircraft merged into one mesh per material: a few dozen draw calls in all.
  // The fuselage material is new per model, so fuselages are grouped by their (cached) livery texture.
  const templates = new Map<string, ReturnType<typeof template>>();
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
  for (const p of parked) {
    const k = `${p.type}|${p.airline}`;
    const parts = templates.get(k) ?? templates.set(k, template(p.type, p.airline)).get(k)!;
    const T = airframe(p.type);
    pose(p, (T.d / 2) * 0.6 + T.gearH + 0.28); // wheel base, as in buildAircraft
    for (const { geo, mat } of parts) {
      const key = (mat as THREE.MeshStandardMaterial).map?.uuid ?? mat.uuid;
      const b = buckets.get(key) ?? buckets.set(key, { mat, geos: [] }).get(key)!;
      b.geos.push(geo.clone().applyMatrix4(m));
    }
  }
  for (const { mat, geos } of buckets.values()) {
    const geo = mergeGeometries(geos)!;
    geos.forEach((x) => x.dispose());
    // own copy of the shared paint materials, so the floodlight glow does not reach the moving aircraft
    const own = (mat as THREE.MeshStandardMaterial).map ? mat : mat.clone();
    const mesh = new THREE.Mesh(geo, own);
    mesh.receiveShadow = true;
    objects.push(mesh);
    disposables.push(geo, own);
    lit.push(own as THREE.MeshStandardMaterial);
  }
  for (const parts of templates.values()) for (const { geo } of parts) geo.dispose();

  // soft ground shadows: one unit plane, scaled to each aircraft
  const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false,
  });
  const shadows = new THREE.InstancedMesh(plane, shadowMat, parked.length);
  parked.forEach((p, i) => {
    const T = airframe(p.type);
    shadows.setMatrixAt(i, pose(p, 0.05, new THREE.Vector3(T.span * 1.25, 1, T.len * 1.25)));
  });
  shadows.renderOrder = -10;
  objects.push(shadows);
  disposables.push(plane, shadowMat);

  // jet bridges and service vehicles: vertex-coloured boxes, one mesh
  const parts: THREE.BufferGeometry[] = bridges.flatMap(bridgeParts);
  for (const v of vehicles) {
    const yaw = (-v.headingDeg * Math.PI) / 180;
    parts.push(box(v.w, v.h - 0.5, v.l, yaw, v.x, 0.5 + (v.h - 0.5) / 2, v.z, v.color));
    parts.push(box(v.w * 0.9, 0.5, v.l * 0.8, yaw, v.x, 0.25, v.z, '#2c2f33'));
  }
  if (parts.length) {
    const geo = mergeGeometries(parts)!;
    parts.forEach((x) => x.dispose());
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    objects.push(mesh);
    disposables.push(geo, mat);
    lit.push(mat);
  }
  return { objects, disposables, lit };
}
