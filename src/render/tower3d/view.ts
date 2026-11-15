import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Airport } from '../../core';
import { buildAircraft, disposeAircraftAssets, type AircraftMesh } from './aircraftMesh';
import {
  holdingPosition,
  llToGround,
  reciprocal,
  ribbon,
  runwayEdges,
  runwayFrame,
  runwayMarkings,
  runwaySurface,
  type Designator,
  type GroundData,
  type LandData,
  type Polygon,
} from './ground';
import { SUN, lookDirection, toWorld, shadowPoint, type P3, type Pose } from './math';

export interface TowerAircraft {
  id: number;
  type: string;
  airline: string;
  pose: Pose;
}

export interface Camera {
  eye: P3;
  bearing: number;
  depression: number;
  /** Vertical field of view, degrees. */
  fov: number;
}

/** Where an aircraft landed on screen (CSS pixels), for HTML labels and picking. */
export interface Anchor {
  id: number;
  x: number;
  y: number;
  visible: boolean;
  /** Metres from the eye. */
  dist: number;
}

const SKY_TOP = '#2a66ad';
const SKY_MID = '#6fa6da';
const SKY_HORIZON = '#cfe1f0';
const HAZE = '#c6d9ea';
/** Shadows fade out as the aircraft climbs; above this they are not drawn. */
const SHADOW_MAX_AGL = 160;
/** Surface colours: a modelled airport, no photo (see docs/design/tower3d.md). */
const RUNWAY = '#5a5d60';
const TAXIWAY = '#66696b';
const APRON = '#ffffff'; // the concrete texture carries the colour
/** Land use colours; a list means each polygon picks one (fields in a patchwork, seeded). */
const LAND: [string, string | string[]][] = [
  ['farm', ['#86a05c', '#7d9a52', '#91a862', '#748f4c', '#9aab66', '#a59c6e', '#b3a57a', '#8c9f5a']],
  ['park', ['#8aa862', '#82a05a', '#90aa66']],
  ['forest', ['#56723f', '#4f6a3a', '#5b7843']],
  ['residential', '#b4ab9d'],
  ['industrial', '#adadaa'],
  ['greenhouse', '#cdd6d9'],
  ['water', '#5d7f97'],
];
const ROAD = '#6e7173';
/** Building kinds drawn without window bands. */
const PLAIN = new Set(['hangar', 'storage_tank', 'industrial', 'warehouse', 'roof', 'service', 'shed']);
const WHITE_PAINT = '#f4f4f0';
const YELLOW = '#e8c23a';

/**
 * The out-of-the-window view. Reads poses only; knows nothing about the sim.
 * Look: a modelled airport and surroundings from OSM, gradient sky with soft clouds, haze, smooth procedural aircraft.
 */
export class TowerRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, 1, 2, 130000);
  private aircraft = new Map<number, { mesh: AircraftMesh; shadow: THREE.Mesh }>();
  private shadowTex: THREE.CanvasTexture;
  private w = 1;
  private h = 1;
  private disposables: { dispose(): void }[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    private ap: Airport,
  ) {
    // throws when WebGL is unavailable: the caller shows a message instead
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.3;
    this.scene.fog = new THREE.FogExp2(HAZE, 0.00006);

    const s = lookDirection(SUN.azimuth, -SUN.elevation);
    const sun = new THREE.DirectionalLight('#fff4e2', 6.5);
    // buildings cast shadows onto the ground layers within 3 km of the airport reference point
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    sun.position.set(s.x * 6000, s.y * 6000, s.z * 6000);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, {
      left: -3000,
      right: 3000,
      top: 3000,
      bottom: -3000,
      near: 10,
      far: 14000,
    });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.00005;
    this.scene.add(sun, sun.target, new THREE.HemisphereLight('#cfe2ff', '#8a8f7a', 2.4));
    this.addSky();
    this.shadowTex = shadowTexture();
  }

  /**
   * Draw the airport surfaces as graphics on top of the land: aprons, taxiways, runways and their markings.
   * Layers are stacked by render order (land -72..-64, these -46..-38, shadows -10), never by depth.
   */
  loadSurfaces(g: GroundData) {
    const ap = this.ap;
    const layer = (tris: number[], color: string, order: number, map?: THREE.Texture) => {
      faceUp(tris);
      const pos = new Float32Array((tris.length / 2) * 3);
      for (let i = 0, j = 0; i < tris.length; i += 2, j += 3) {
        pos[j] = tris[i]!;
        pos[j + 2] = tris[i + 1]!;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(normalsUp(pos.length / 3), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(tris), 2));
      this.addFlat(geo, color, order, map);
    };
    const polygons = this.polygons.bind(this);

    const grass = grassTexture();
    this.disposables.push(grass);
    polygons(g.grass, '#ffffff', -46, grass);

    const concrete = concreteTexture();
    const asphalt = asphaltTexture();
    this.disposables.push(concrete, asphalt);
    polygons(g.aprons, APRON, -45, concrete);
    polygons(g.taxiwayAreas, TAXIWAY, -44, asphalt);
    const taxi: number[] = [];
    const taxiLine: number[] = [];
    for (const t of g.taxiways) {
      const pts = t.pts.map((p) => llToGround(ap, p));
      ribbon(pts, t.w, taxi);
      ribbon(pts, 0.5, taxiLine);
    }
    layer(taxi, TAXIWAY, -43, asphalt);
    layer(taxiLine, YELLOW, -42);
    const holds: number[] = [];
    for (const h of g.holds)
      holdingPosition(
        h.map((p) => llToGround(ap, p)),
        holds,
      );
    layer(holds, YELLOW, -42);

    polygons(g.runways, RUNWAY, -41, asphalt);
    const surface: number[] = [];
    const marks: number[] = [];
    const designators: Designator[] = [];
    const done = new Set<string>();
    for (const rw of ap.runways) {
      const f = runwayFrame(rw, ap);
      designators.push(runwayMarkings(rw, f, marks).designator);
      if (done.has(rw.id)) continue;
      done.add(reciprocal(rw, ap)?.id ?? '');
      runwaySurface(f, surface);
      runwayEdges(f, marks);
    }
    layer(surface, RUNWAY, -40, asphalt);
    layer(marks, WHITE_PAINT, -39);
    for (const d of designators) this.addDesignator(d);
  }

  /** Filled polygons on the ground, uv in metres east / north so repeating textures keep their real size. */
  private polygons(list: Polygon[], color: string | string[], order: number, map?: THREE.Texture) {
    const ap = this.ap;
    const ring = (r: Polygon[number]) =>
      r.map((p) => llToGround(ap, p)).map((q) => new THREE.Vector2(q.x, -q.z));
    const shapes = list.map((poly) => {
      const shape = new THREE.Shape(ring(poly[0]!));
      shape.holes = poly.slice(1).map((h) => new THREE.Path(ring(h)));
      return shape;
    });
    const geo = new THREE.ShapeGeometry(shapes);
    geo.rotateX(-Math.PI / 2);
    if (typeof color === 'string') return this.addFlat(geo, color, order, map);
    // one group per shape: colour each polygon from the list
    const rnd = seeded(order + 100);
    const cols = new Float32Array(geo.attributes.position!.count * 3);
    const idx = geo.index!;
    const c = new THREE.Color();
    for (const g of geo.groups) {
      c.set(color[Math.floor(rnd() * color.length)]!);
      for (let i = g.start; i < g.start + g.count; i++) cols.set([c.r, c.g, c.b], idx.getX(i) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.addFlat(geo, '#ffffff', order, map, true);
  }

  /** The land around the airport (land use, water, motorways) and the airport buildings, all from OSM. */
  loadLand(l: LandData) {
    LAND.forEach(([cls, color], i) => l.land[cls] && this.polygons(l.land[cls], color, -72 + i));
    const roads: number[] = [];
    for (const r of l.roads)
      ribbon(
        r.pts.map((p) => llToGround(this.ap, p)),
        r.w,
        roads,
      );
    faceUp(roads);
    const pos = new Float32Array((roads.length / 2) * 3);
    for (let i = 0, j = 0; i < roads.length; i += 2, j += 3)
      [pos[j], pos[j + 2]] = [roads[i]!, roads[i + 1]!];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normalsUp(pos.length / 3), 3));
    this.addFlat(geo, ROAD, -64);
    this.addBuildings(l.buildings);
  }

  /** Buildings as extruded footprints: roofs, glazed walls and plain walls, each one merged mesh. */
  private addBuildings(list: LandData['buildings']) {
    const roofs: THREE.BufferGeometry[] = [];
    const glazed: THREE.BufferGeometry[] = [];
    const plain: THREE.BufferGeometry[] = [];
    const cabs = this.ap.towers.map((t) => toWorld(t.pos));
    for (const b of list) {
      const pts = b.r.map((p) => llToGround(this.ap, p));
      const c = pts.reduce((m, q) => ({ x: m.x + q.x / pts.length, z: m.z + q.z / pts.length }), {
        x: 0,
        z: 0,
      });
      // the cab's own tower would wall off the view
      if (cabs.some((k) => Math.hypot(k.x - c.x, k.z - c.z) < 80)) continue;
      const shape = new THREE.Shape(pts.map((q) => new THREE.Vector2(q.x, -q.z)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: b.h, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      // ExtrudeGeometry: group 0 = caps, group 1 = side walls
      const [caps, sides] = geo.groups as [THREE.GeometryGroup, THREE.GeometryGroup];
      roofs.push(slice(geo, caps.start, caps.count));
      (PLAIN.has(b.k) ? plain : glazed).push(slice(geo, sides.start, sides.count));
      geo.dispose();
    }
    const windows = windowTexture();
    this.disposables.push(windows);
    const add = (geos: THREE.BufferGeometry[], color: string, map?: THREE.Texture) => {
      if (!geos.length) return;
      const geo = mergeGeometries(geos)!;
      geos.forEach((g) => g.dispose());
      const mat = new THREE.MeshLambertMaterial({ color, map: map ?? null });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.disposables.push(geo, mat);
    };
    add(roofs, '#d4d3cf');
    add(glazed, '#ffffff', windows);
    add(plain, '#e6e4de');
  }

  private addFlat(
    geo: THREE.BufferGeometry,
    color: string,
    order: number,
    map?: THREE.Texture,
    vertexColors = false,
  ) {
    const mat = new THREE.MeshLambertMaterial({
      color,
      vertexColors,
      map: map ?? null,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.disposables.push(geo, mat);
  }

  /** Runway number (and letter) painted on the surface, 9 m tall, readable from the approach. */
  private addDesignator(d: Designator) {
    const paint = (text: string, p: { x: number; z: number }) => {
      const tex = designatorTexture(text);
      const w = 3.6 * text.length + 1.5 * (text.length - 1);
      const geo = new THREE.PlaneGeometry(w, 9);
      const mat = new THREE.MeshLambertMaterial({
        color: WHITE_PAINT,
        alphaMap: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      // lie flat, top of the text away from the approaching aircraft
      mesh.rotation.order = 'YXZ';
      mesh.rotation.y = (-d.headingDeg * Math.PI) / 180;
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(p.x, 0, p.z);
      mesh.renderOrder = -38;
      this.scene.add(mesh);
      this.disposables.push(tex, geo, mat);
    };
    paint(d.number, d.numberAt);
    if (d.letter) paint(d.letter, d.letterAt);
  }

  private addSky() {
    const R = 100000;
    const geo = new THREE.SphereGeometry(R, 32, 16);
    const top = new THREE.Color(SKY_TOP);
    const mid = new THREE.Color(SKY_MID);
    const hor = new THREE.Color(SKY_HORIZON);
    const colors: number[] = [];
    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / R);
      const c =
        t < 0.1
          ? hor.clone().lerp(mid, Math.pow(t / 0.1, 0.8))
          : mid.clone().lerp(top, Math.min(1, (t - 0.1) / 0.45));
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const skyMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const sky = new THREE.Mesh(geo, skyMat);
    sky.renderOrder = -100;
    this.scene.add(sky);

    // land beyond the OSM land use, so the horizon is never a hole
    const landGeo = new THREE.CircleGeometry(R, 48);
    const landMat = new THREE.MeshLambertMaterial({ color: '#7d965a', depthTest: false, depthWrite: false });
    const land = new THREE.Mesh(landGeo, landMat);
    land.rotation.x = -Math.PI / 2;
    land.renderOrder = -90;
    this.scene.add(land);
    this.disposables.push(geo, skyMat, landGeo, landMat);

    // soft fair-weather clouds: billboards, always the same ones (seeded)
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 40; k++) {
      const tex = cloudTexture(rnd);
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        fog: false,
        toneMapped: false,
        opacity: 0.92,
      });
      const sp = new THREE.Sprite(mat);
      const brg = rnd() * Math.PI * 2;
      const d = 14000 + rnd() * 30000;
      const w = 2600 + rnd() * 3200;
      sp.scale.set(w, w * 0.42, 1);
      sp.position.set(Math.sin(brg) * d, 1500 + rnd() * 1400 + d * 0.035, -Math.cos(brg) * d);
      sp.renderOrder = -80;
      this.scene.add(sp);
      this.disposables.push(tex, mat);
    }
  }

  setSize(width: number, height: number, dpr: number) {
    this.w = width;
    this.h = height;
    // capped: laptops pay for every extra pixel
    this.renderer.setPixelRatio(Math.min(dpr, 1.5));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
  }

  /** Draw one frame and report where each aircraft is on screen. */
  render(list: readonly TowerAircraft[], cam: Camera): Anchor[] {
    const seen = new Set<number>();
    for (const a of list) {
      seen.add(a.id);
      let e = this.aircraft.get(a.id);
      if (!e) {
        const mesh = buildAircraft(a.type, a.airline);
        const shadow = new THREE.Mesh(
          new THREE.PlaneGeometry(mesh.userData.span * 1.25, mesh.userData.len * 1.25),
          new THREE.MeshBasicMaterial({
            map: this.shadowTex,
            transparent: true,
            depthTest: false,
            depthWrite: false,
          }),
        );
        shadow.rotation.order = 'YXZ';
        shadow.renderOrder = -10;
        this.scene.add(mesh, shadow);
        this.aircraft.set(a.id, (e = { mesh, shadow }));
      }
      const { mesh, shadow } = e;
      const p = a.pose;
      mesh.position.set(p.pos.x, p.pos.y + mesh.userData.wheelBase, p.pos.z);
      mesh.rotation.order = 'YXZ';
      mesh.rotation.y = (-p.headingDeg * Math.PI) / 180;
      mesh.rotation.x = (p.pitchDeg * Math.PI) / 180;
      mesh.userData.gear.visible = p.gearDown;

      const fade = 1 - p.aglM / SHADOW_MAX_AGL;
      shadow.visible = fade > 0;
      if (shadow.visible) {
        const sp = shadowPoint(p.pos, p.aglM);
        shadow.position.set(sp.x, 0, sp.z);
        shadow.rotation.y = mesh.rotation.y;
        shadow.rotation.x = -Math.PI / 2;
        (shadow.material as THREE.MeshBasicMaterial).opacity = 0.5 * fade;
      }
    }
    for (const [id, e] of this.aircraft) {
      if (seen.has(id)) continue;
      this.scene.remove(e.mesh, e.shadow);
      disposeObject(e.mesh);
      e.shadow.geometry.dispose();
      (e.shadow.material as THREE.Material).dispose();
      this.aircraft.delete(id);
    }

    const d = lookDirection(cam.bearing, cam.depression);
    this.camera.position.set(cam.eye.x, cam.eye.y, cam.eye.z);
    this.camera.lookAt(cam.eye.x + d.x, cam.eye.y + d.y, cam.eye.z + d.z);
    this.camera.fov = cam.fov;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);

    const v = new THREE.Vector3();
    return list.map((a) => {
      const m = this.aircraft.get(a.id)!.mesh;
      v.copy(m.position).project(this.camera);
      return {
        id: a.id,
        x: ((v.x + 1) / 2) * this.w,
        y: ((1 - v.y) / 2) * this.h,
        visible: v.z < 1 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05,
        dist: m.position.distanceTo(this.camera.position),
      };
    });
  }

  /** Triangles and draw calls of the last frame (dev readout). */
  get stats() {
    const { triangles, calls } = this.renderer.info.render;
    return { triangles, calls };
  }

  dispose() {
    for (const e of this.aircraft.values()) {
      disposeObject(e.mesh);
      e.shadow.geometry.dispose();
      (e.shadow.material as THREE.Material).dispose();
    }
    this.aircraft.clear();
    for (const d of this.disposables) d.dispose();
    this.shadowTex.dispose();
    disposeAircraftAssets();
    this.renderer.dispose();
  }
}

/** Geometries are per aircraft; materials and textures are shared and freed by disposeAircraftAssets. */
function disposeObject(o: THREE.Object3D) {
  o.traverse((c) => (c as THREE.Mesh).geometry?.dispose());
}

/** Blurred top-down silhouette (nose up), used as a soft shadow on the ground. */
function shadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.filter = 'blur(5px)';
  g.fillStyle = '#0a1018';
  g.beginPath();
  g.ellipse(64, 64, 6, 50, 0, 0, Math.PI * 2); // fuselage
  g.fill();
  g.beginPath(); // swept wings
  g.moveTo(64, 50);
  g.lineTo(114, 78);
  g.lineTo(114, 86);
  g.lineTo(64, 72);
  g.lineTo(14, 86);
  g.lineTo(14, 78);
  g.closePath();
  g.fill();
  g.beginPath(); // tailplane
  g.moveTo(64, 100);
  g.lineTo(84, 112);
  g.lineTo(84, 116);
  g.lineTo(64, 110);
  g.lineTo(44, 116);
  g.lineTo(44, 112);
  g.closePath();
  g.fill();
  return new THREE.CanvasTexture(c);
}

function cloudTexture(rnd: () => number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const x = c.getContext('2d')!;
  for (let k = 0; k < 22; k++) {
    const px = 45 + rnd() * 166;
    const py = 75 - rnd() * rnd() * 45;
    const r = 17 + rnd() * 26;
    const gr = x.createRadialGradient(px, py, 0, px, py, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.22)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 256, 128);
  }
  // slightly grey underside
  const sh = x.createLinearGradient(0, 60, 0, 100);
  sh.addColorStop(0, 'rgba(120,135,155,0)');
  sh.addColorStop(1, 'rgba(120,135,155,0.35)');
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = sh;
  x.fillRect(0, 0, 256, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Make every triangle counter-clockwise seen from above, so lit faces point up. */
function faceUp(t: number[]) {
  for (let i = 0; i < t.length; i += 6) {
    const [ax, az, bx, bz, cx, cz] = t.slice(i, i + 6) as [number, number, number, number, number, number];
    // y of (b - a) × (c - a); world z points south
    if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) < 0) t.splice(i + 2, 4, cx, cz, bx, bz);
  }
}

function normalsUp(n: number): Float32Array {
  const a = new Float32Array(n * 3);
  for (let i = 1; i < a.length; i += 3) a[i] = 1;
  return a;
}

/** Mown grass, repeating every 48 m: a muted green with fine streaks and blotches (seeded, same every time). */
function grassTexture(): THREE.CanvasTexture {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  g.fillStyle = '#76904f';
  g.fillRect(0, 0, N, N);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 90; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(150,170,100,0.04)' : 'rgba(40,60,30,0.04)';
    g.beginPath();
    g.ellipse(rnd() * N, rnd() * N, 10 + rnd() * 40, 6 + rnd() * 24, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(170,190,120,0.25)' : 'rgba(35,55,25,0.25)';
    g.fillRect(rnd() * N, rnd() * N, 1, 2 + rnd() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 48, 1 / 48);
  t.anisotropy = 8;
  return t;
}

/** White-on-black text used as an alpha map: tall, narrow runway digits. */
function designatorTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64 * text.length;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 120px "Arial Narrow", Arial, sans-serif';
  // squeeze horizontally: painted digits are about 2.5 times as tall as wide
  g.setTransform(0.62, 0, 0, 1, c.width / 2, c.height / 2 + 6);
  g.fillText(text, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

/** A copy of vertices start..start+count of a non-indexed geometry (position, normal, uv). */
function slice(geo: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = geo.getAttribute(name) as THREE.BufferAttribute;
    out.setAttribute(
      name,
      new THREE.BufferAttribute(
        (a.array as Float32Array).slice(start * a.itemSize, (start + count) * a.itemSize),
        a.itemSize,
      ),
    );
  }
  return out;
}

function seeded(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/** Apron concrete: 5 m slabs with dark joints and a slight tone per slab; 128 px = 10 m. */
function concreteTexture(): THREE.CanvasTexture {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const rnd = seeded(5);
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) {
      const v = 184 + Math.round(rnd() * 12);
      g.fillStyle = `rgb(${v},${v - 1},${v - 5})`;
      g.fillRect(i * 64, j * 64, 64, 64);
    }
  for (let k = 0; k < 600; k++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    g.fillRect(rnd() * N, rnd() * N, 2, 2);
  }
  g.fillStyle = 'rgba(70,70,68,0.55)';
  for (const p of [0, 64]) {
    g.fillRect(p, 0, 1, N);
    g.fillRect(0, p, N, 1);
  }
  return tiling(c, 10);
}

/** Asphalt: a faint grain so large dark areas aren't dead flat; 128 px = 16 m. */
function asphaltTexture(): THREE.CanvasTexture {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, N, N);
  const rnd = seeded(9);
  for (let k = 0; k < 1500; k++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    g.fillRect(rnd() * N, rnd() * N, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  return tiling(c, 16);
}

/** Wall with a glass band per 3.5 m storey and a mullion every 4 m (uv: metres along the wall, metres up). */
function windowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 28;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e4e2dc';
  g.fillRect(0, 0, 32, 28);
  g.fillStyle = '#7f95a6';
  g.fillRect(0, 8, 32, 14);
  g.fillStyle = '#d0d0cc';
  g.fillRect(0, 8, 1, 14);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 4, 1 / 3.5);
  t.anisotropy = 4;
  return t;
}

function tiling(c: HTMLCanvasElement, metres: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / metres, 1 / metres);
  t.anisotropy = 8;
  return t;
}
