import * as THREE from 'three';
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
  type Polygon,
} from './ground';
import { SUN, lookDirection, shadowPoint, tileRect, type ImageryManifest, type P3, type Pose } from './math';

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
/** Surface colours, picked to sit with the photo under the same light. */
const RUNWAY = '#6a6d70';
const TAXIWAY = '#77797b';
const APRON = '#a3a49f';
const WHITE_PAINT = '#f4f4f0';
const YELLOW = '#e8c23a';

/**
 * The out-of-the-window view. Reads poses only; knows nothing about the sim.
 * Look: aerial photo ground, gradient sky with soft clouds, haze, smooth procedural aircraft.
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
    sun.position.set(s.x, s.y, s.z);
    this.scene.add(sun, new THREE.HemisphereLight('#cfe2ff', '#8a8f7a', 2.4));
    this.addSky();
    this.shadowTex = shadowTexture();
  }

  /** Load the ground imagery. The view is usable (plain ground) while this runs. */
  async loadGround(
    manifest: ImageryManifest,
    baseUrl: string,
    onProgress?: (done: number, total: number) => void,
  ) {
    const loader = new THREE.TextureLoader();
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const tiles = manifest.tiers.flatMap((tier, order) => tier.tiles.map((t) => ({ t, order })));
    let done = 0;
    await Promise.all(
      tiles.map(async ({ t, order }) => {
        const tex = await loader.loadAsync(baseUrl + t.file);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = aniso;
        const r = tileRect(t, this.ap);
        const geo = new THREE.PlaneGeometry(r.width, r.depth);
        const mat = new THREE.MeshLambertMaterial({ map: tex, depthTest: false, depthWrite: false });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(r.cx, 0, r.cz);
        // tiers are stacked by draw order, not by height, so they can't z-fight
        mesh.renderOrder = -50 + order;
        this.scene.add(mesh);
        this.disposables.push(tex, geo, mat);
        onProgress?.(++done, tiles.length);
      }),
    );
  }

  /**
   * Draw the airport surfaces as graphics on top of the photo: aprons, taxiways, runways and their markings.
   * Layers are stacked by render order (photo tiers -50.., these -45..-38, shadows -10), never by depth.
   */
  loadSurfaces(g: GroundData) {
    const ap = this.ap;
    const layer = (tris: number[], color: string, order: number) => {
      faceUp(tris);
      const pos = new Float32Array((tris.length / 2) * 3);
      for (let i = 0, j = 0; i < tris.length; i += 2, j += 3) {
        pos[j] = tris[i]!;
        pos[j + 2] = tris[i + 1]!;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(normalsUp(pos.length / 3), 3));
      this.addFlat(geo, color, order);
    };
    const polygons = (list: Polygon[], color: string, order: number, map?: THREE.Texture) => {
      const shapes = list.map((poly) => {
        const ring = (r: Polygon[number]) =>
          r.map((p) => llToGround(ap, p)).map((q) => new THREE.Vector2(q.x, -q.z));
        const shape = new THREE.Shape(ring(poly[0]!));
        shape.holes = poly.slice(1).map((h) => new THREE.Path(ring(h)));
        return shape;
      });
      // uv = metres east / north, so a repeating texture keeps its real size
      const geo = new THREE.ShapeGeometry(shapes);
      geo.rotateX(-Math.PI / 2);
      this.addFlat(geo, color, order, map);
    };

    const grass = grassTexture();
    this.disposables.push(grass);
    polygons(g.grass, '#ffffff', -46, grass);

    polygons(g.aprons, APRON, -45);
    polygons(g.taxiwayAreas, TAXIWAY, -44);
    const taxi: number[] = [];
    const taxiLine: number[] = [];
    for (const t of g.taxiways) {
      const pts = t.pts.map((p) => llToGround(ap, p));
      ribbon(pts, t.w, taxi);
      ribbon(pts, 0.5, taxiLine);
    }
    layer(taxi, TAXIWAY, -43);
    layer(taxiLine, YELLOW, -42);
    const holds: number[] = [];
    for (const h of g.holds)
      holdingPosition(
        h.map((p) => llToGround(ap, p)),
        holds,
      );
    layer(holds, YELLOW, -42);

    polygons(g.runways, RUNWAY, -41);
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
    layer(surface, RUNWAY, -40);
    layer(marks, WHITE_PAINT, -39);
    for (const d of designators) this.addDesignator(d);
  }

  private addFlat(geo: THREE.BufferGeometry, color: string, order: number, map?: THREE.Texture) {
    const mat = new THREE.MeshLambertMaterial({
      color,
      map: map ?? null,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
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

    // land beyond the imagery, so the horizon is never a hole
    const landGeo = new THREE.CircleGeometry(R, 48);
    const landMat = new THREE.MeshLambertMaterial({ color: '#6f7f63', depthTest: false, depthWrite: false });
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
    // capped: the photo ground gains nothing from more pixels, and laptops pay for them
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
