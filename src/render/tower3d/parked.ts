/**
 * Parked aircraft and jet bridges in a few draw calls: one low-detail model per type and livery, copied
 * to every stand and merged by material. Placement lives in stands.ts.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildAircraft } from './aircraftMesh';
import { airframe } from './math';
import type { Bridge, Parked } from './stands';

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

/** Parked aircraft, their ground shadows (instanced) and the jet bridges. */
export function apronObjects(
  parked: Parked[],
  bridges: Bridge[],
  shadowTex: THREE.Texture,
): { objects: THREE.Object3D[]; disposables: { dispose(): void }[] } {
  const objects: THREE.Object3D[] = [];
  const disposables: { dispose(): void }[] = [];
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
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    objects.push(mesh);
    disposables.push(geo);
  }
  for (const parts of templates.values())
    for (const { geo, mat } of parts) {
      geo.dispose();
      // paint materials are shared with the live aircraft and freed with them; the fuselage one is per model
      if ((mat as THREE.MeshStandardMaterial).map) disposables.push(mat);
    }

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

  // jet bridges: a tunnel from the wall to the door, on one leg near the aircraft end
  const parts: THREE.BufferGeometry[] = [];
  for (const b of bridges) {
    const dx = b.b.x - b.a.x;
    const dz = b.b.z - b.a.z;
    const d = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const tunnel = new THREE.BoxGeometry(2.8, 3, d)
      .rotateY(yaw)
      .translate((b.a.x + b.b.x) / 2, b.y + 1.5, (b.a.z + b.b.z) / 2);
    const legAt = { x: b.a.x + dx * 0.8, z: b.a.z + dz * 0.8 };
    const leg = new THREE.BoxGeometry(1.6, b.y, 0.8).rotateY(yaw).translate(legAt.x, b.y / 2, legAt.z);
    parts.push(tunnel.toNonIndexed(), leg.toNonIndexed());
    tunnel.dispose();
    leg.dispose();
  }
  if (parts.length) {
    const geo = mergeGeometries(parts)!;
    parts.forEach((x) => x.dispose());
    const mat = new THREE.MeshStandardMaterial({ color: '#c8ccd1', roughness: 0.6, metalness: 0.15 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    objects.push(mesh);
    disposables.push(geo, mat);
  }
  return { objects, disposables };
}
