/**
 * Graphics test (branch tower-gfx-test, `?gfx=new`): extra detail, all built once at load.
 * Sky-lit materials, smooth curved walls with darkened bases, field and mown-grass textures, tyre marks,
 * instanced trees. Nothing here runs per frame.
 */
import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Airport } from '../../core';
import { at, llToGround, runwayFrame, type LandData, type P2, type Polygon } from './ground';

const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** Image-based light from a small copy of our sky dome over a green-grey ground: tints shading by the sky. */
export function skyEnvironment(renderer: THREE.WebGLRenderer, top: string, horizon: string): THREE.Texture {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const cols: number[] = [];
  const a = new THREE.Color(horizon);
  const b = new THREE.Color(top);
  const g = new THREE.Color('#6f7c5c');
  const p = geo.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 10;
    const c = y < 0 ? g : a.clone().lerp(b, Math.min(1, y / 0.6));
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.04, 0.1, 100);
  pmrem.dispose();
  geo.dispose();
  return rt.texture;
}

/**
 * Building walls: smooth shading across the short segments of curved outlines (creases above 35°), and a
 * darker base fading out over 4 m (baked ambient occlusion where the wall meets the ground).
 */
export function shadeWalls(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = toCreasedNormals(geo, (35 * Math.PI) / 180);
  const pos = out.attributes.position!;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, pos.getY(i) / 4);
    col.fill(0.62 + 0.38 * t * t * (3 - 2 * t), i * 3, i * 3 + 3);
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

function canvasTexture(
  N: number,
  draw: (g: CanvasRenderingContext2D, rnd: () => number) => void,
  metres: number,
) {
  const c = document.createElement('canvas');
  c.width = c.height = N;
  draw(c.getContext('2d')!, seeded(N + metres));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / metres, 1 / metres);
  t.anisotropy = 8;
  return t;
}

/**
 * Fields: crop rows along the Haarlemmermeer polder grid (about 40° off north) and patchy tone, multiplied
 * with each field's own colour. 256 px = 64 m.
 */
export function fieldTexture(): THREE.CanvasTexture {
  const t = canvasTexture(
    256,
    (g, rnd) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 256, 256);
      // fine speckle (no blotches: they repeat visibly; each field's own colour varies the tone)
      for (let i = 0; i < 4000; i++) {
        g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,240,0.10)' : 'rgba(40,50,25,0.10)';
        g.fillRect(rnd() * 256, rnd() * 256, 1, 1);
      }
      g.fillStyle = 'rgba(40,50,25,0.08)';
      for (let x = 0; x < 256; x += 6) g.fillRect(x, 0, 2, 256);
    },
    64,
  );
  t.center.set(0.5, 0.5);
  t.rotation = 0.7;
  return t;
}

/** Airside grass mown in 12 m swaths (faintly lighter and darker), over the fine grass detail. 512 px = 96 m. */
export function mownGrassTexture(): THREE.CanvasTexture {
  return canvasTexture(
    512,
    (g, rnd) => {
      g.fillStyle = '#76904f';
      g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? 'rgba(200,220,150,0.045)' : 'rgba(30,50,20,0.03)';
        g.fillRect(0, i * 64, 512, 64);
      }
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = rnd() < 0.5 ? 'rgba(170,190,120,0.22)' : 'rgba(35,55,25,0.22)';
        g.fillRect(rnd() * 512, rnd() * 512, 1, 2 + rnd() * 3);
      }
    },
    96,
  );
}

/** Rubber deposits in each touchdown zone (150–900 m in): dark streaks either side of the centreline. */
export function tyreMarks(ap: Airport): THREE.Mesh[] {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 512;
  const g = c.getContext('2d')!;
  const rnd = seeded(31);
  for (const lane of [20, 44]) {
    for (let k = 0; k < 140; k++) {
      const y = Math.pow(rnd(), 1.8) * 512; // dense at the touchdown end, fading out
      const x = lane + (rnd() - 0.5) * 14;
      g.fillStyle = `rgba(0,0,0,${0.12 + rnd() * 0.2})`;
      g.fillRect(x, y, 1 + rnd() * 2, 10 + rnd() * 60);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  const out: THREE.Mesh[] = [];
  for (const rw of ap.runways) {
    if (!rw.ils) continue; // landing directions only
    const f = runwayFrame(rw, ap);
    const corners = [at(f, 150, -12), at(f, 150, 12), at(f, 900, 12), at(f, 900, -12)];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        corners.flatMap((p) => [p.x, 0, p.z]),
        3,
      ),
    );
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 2, 1, 0, 3, 2]);
    const mat = new THREE.MeshBasicMaterial({
      color: '#202020',
      alphaMap: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // inverted alpha map: the canvas is dark where the rubber is
    mat.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace(
        '#include <alphamap_fragment>',
        'diffuseColor.a *= 1.0 - texture2D( alphaMap, vAlphaMapUv ).g;',
      );
    };
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = -39.5; // on the runway surface, under the paint
    m.frustumCulled = false;
    out.push(m);
  }
  return out;
}

function ringArea(r: P2[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j]!.x * r[i]!.z - r[i]!.x * r[j]!.z;
  return Math.abs(a) / 2;
}
function inside(p: P2, r: P2[]): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i]!;
    const b = r[j]!;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

/** Points scattered inside polygons at `perM2`, holes excluded, at most `max` in total (seeded). */
function scatter(ap: Airport, polys: Polygon[], perM2: number, max: number, rnd: () => number): P2[] {
  const rings = polys.map((poly) => poly.map((r) => r.map((p) => llToGround(ap, p))));
  const total = rings.reduce((s, r) => s + ringArea(r[0]!), 0);
  const density = Math.min(perM2, max / Math.max(total, 1));
  const out: P2[] = [];
  for (const [outer, ...holes] of rings) {
    let n = ringArea(outer!) * density;
    n = Math.floor(n) + (rnd() < n % 1 ? 1 : 0);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const q of outer!) {
      minX = Math.min(minX, q.x);
      maxX = Math.max(maxX, q.x);
      minZ = Math.min(minZ, q.z);
      maxZ = Math.max(maxZ, q.z);
    }
    for (let tries = 0; n > 0 && tries < n * 8; tries++) {
      const p = { x: minX + rnd() * (maxX - minX), z: minZ + rnd() * (maxZ - minZ) };
      if (!inside(p, outer!) || holes.some((h) => inside(p, h))) continue;
      out.push(p);
      n--;
    }
  }
  return out;
}

/**
 * Trees as two instanced meshes (trunks, crowns): dense in woods, scattered in towns. Never inside the
 * airport (OSM woods and towns lie outside the fence) or near a cab.
 */
export function trees(ap: Airport, land: LandData, keepClear: P2[]): THREE.Object3D[] {
  const rnd = seeded(77);
  const pts = [
    ...scatter(ap, land.land.forest ?? [], 1 / 90, 26000, rnd),
    ...scatter(ap, land.land.residential ?? [], 1 / 700, 9000, rnd),
  ].filter((p) => keepClear.every((k) => Math.hypot(k.x - p.x, k.z - p.z) > 150));
  // 20-triangle crowns, smooth-shaded so they read round; open trunks (10 triangles)
  const crownGeo = new THREE.IcosahedronGeometry(1, 0);
  crownGeo.scale(1, 1.25, 1);
  crownGeo.deleteAttribute('normal');
  const smooth = mergeVertices(crownGeo);
  smooth.computeVertexNormals();
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 1, 5, 1, true);
  trunkGeo.translate(0, 0.5, 0);
  const crownMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5a4a3a', roughness: 1 });
  // trees within the shadow map's 3 km cast shadows; the rest skip the shadow pass
  const near = pts.filter((p) => Math.abs(p.x) < 3000 && Math.abs(p.z) < 3000);
  const far = pts.filter((p) => !(Math.abs(p.x) < 3000 && Math.abs(p.z) < 3000));
  return [...grove(near, true), ...grove(far, false)];

  function grove(list: P2[], shadows: boolean): THREE.InstancedMesh[] {
    const crowns = new THREE.InstancedMesh(smooth, crownMat, list.length);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, list.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const v = new THREE.Vector3();
    const col = new THREE.Color();
    const greens = ['#4d6b37', '#567a3c', '#5f7f42', '#46612f', '#6a8448'];
    list.forEach((p, i) => {
      const h = 9 + rnd() * 9; // 9–18 m
      const r = h * (0.28 + rnd() * 0.1);
      q.setFromAxisAngle(v.set(0, 1, 0), rnd() * 6.3);
      m.compose(v.set(p.x, h - r * 1.1, p.z), q, s.set(r, r, r));
      crowns.setMatrixAt(i, m);
      crowns.setColorAt(
        i,
        col.set(greens[Math.floor(rnd() * greens.length)]!).offsetHSL(0, 0, (rnd() - 0.5) * 0.06),
      );
      m.compose(v.set(p.x, 0, p.z), q, s.set(1, h - r * 1.6, 1));
      trunks.setMatrixAt(i, m);
    });
    for (const mesh of [crowns, trunks]) {
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
    }
    return [crowns, trunks];
  }
}
