import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Airport } from '../../core';
import { buildAircraft, disposeAircraftAssets, type AircraftMesh } from './aircraftMesh';
import {
  fieldTexture,
  mownGrassTexture,
  roughGrassTexture,
  waterTexture,
  shadeWalls,
  skyEnvironment,
  trees,
  tyreMarks,
} from './enhance';
import {
  holdingPosition,
  llToGround,
  reciprocal,
  ribbon,
  runwayEdges,
  runwayFrame,
  softBand,
  runwayMarkings,
  runwaySurface,
  type BuildingData,
  type BuildingStyle,
  type Designator,
  type GroundData,
  type LandData,
  type Polygon,
} from './ground';
import {
  addLight,
  airportLights,
  emptyLights,
  fogAmount,
  fogDensity,
  LIGHT_FOG,
  taxiwayLights,
  taxiwayEdgeLights,
  type LightSet,
  type TimeOfDay,
} from './lights';
import { SUN, lookDirection, toWorld, shadowPoint, type P3, type Pose } from './math';
import { apronObjects } from './parked';
import { parkAircraft, serviceVehicles, type Parked, type StandData } from './stands';

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
/** Look per time of day. `away` is the horizon opposite the sun (the glow is on the sun's side). */
interface Look {
  top: string;
  mid: string;
  horizon: string;
  away: string;
  haze: string;
  sun: { az: number; el: number; color: string; i: number };
  hemi: [string, string, number];
  env: number;
  exposure: number;
  cloud: [string, number];
  /** Window glow (emissive intensity) and airport/aircraft light brightness; 0 = off. */
  windows: number;
  lights: number;
}
const LOOKS: Record<TimeOfDay, Look> = {
  day: {
    top: SKY_TOP,
    mid: SKY_MID,
    horizon: SKY_HORIZON,
    away: SKY_HORIZON,
    haze: HAZE,
    sun: { az: SUN.azimuth, el: SUN.elevation, color: '#fff4e2', i: 6.5 },
    hemi: ['#cfe2ff', '#8a8f7a', 2.4],
    env: 0.6,
    exposure: 0.3,
    cloud: ['#ffffff', 0.92],
    windows: 0,
    lights: 0,
  },
  // sun just below the trees in the west-south-west, an orange glow on that side
  dusk: {
    top: '#1b2a52',
    mid: '#4e5f8f',
    horizon: '#f0a060',
    away: '#7a7c9e',
    haze: '#8d8590',
    sun: { az: 250, el: 3, color: '#ff9a55', i: 2.6 },
    hemi: ['#8f9fd0', '#4a4238', 2.2],
    env: 0.35,
    exposure: 0.6,
    cloud: ['#f2a07c', 0.85],
    windows: 0.8,
    lights: 0.75,
  },
  // moonlight from the south-east, the city glow low on the horizon
  night: {
    top: '#02040a',
    mid: '#081122',
    horizon: '#262a36',
    away: '#1a2131',
    haze: '#131925',
    sun: { az: 150, el: 35, color: '#8fa6ff', i: 0.5 },
    hemi: ['#3e5080', '#141414', 1.1],
    env: 0.12,
    exposure: 0.75,
    cloud: ['#1b2232', 0.5],
    windows: 1.4,
    lights: 1,
  },
};

/** The sky and haze in thick fog, per time of day: an even grey, lit by the airport and the city at night. */
const FOG_LOOK: Record<TimeOfDay, string> = { day: '#b7bcc0', dusk: '#77767c', night: '#1f2229' };
/** A look blended toward fog (`k` 0–1): sky and haze go grey, the sun weakens and the clouds disappear. */
function foggy(L: Look, fog: string, k: number): Look {
  if (k <= 0) return L;
  const mix = (c: string) => '#' + new THREE.Color(c).lerp(new THREE.Color(fog), k).getHexString();
  return {
    ...L,
    top: mix(L.top),
    mid: mix(L.mid),
    horizon: mix(L.horizon),
    away: mix(L.away),
    haze: mix(L.haze),
    sun: { ...L.sun, i: L.sun.i * (1 - 0.8 * k) },
    hemi: [L.hemi[0], L.hemi[1], L.hemi[2] * (1 + 0.3 * k)],
    cloud: [L.cloud[0], L.cloud[1] * (1 - k)],
  };
}

/** Shadows fade out as the aircraft climbs; above this they are not drawn. */
const SHADOW_MAX_AGL = 160;
/** Surface colours: a modelled airport, no photo (see docs/design/tower3d.md). */
const RUNWAY = '#74777a';
const TAXIWAY = '#6e7173';
const APRON = '#dedbd4';
/** Width of the concrete laid under each stand line (m): about a narrow-body's span plus margin (assumed). */
const STAND_PAD = 50;
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
/** Ditch round each field: Dutch polder fields are bounded by water-filled ditches (seen darker from the cab). */
const DITCH = '#4f6a63';
const DITCH_W = 3;
/** Field edges are drawn this far from a cab (m): beyond it they are too fine to see. */
const DITCH_RANGE_M = 5000;
/** Apron mast height when OSM has none (m): Schiphol's apron masts are roughly this tall (assumed). */
const MAST_H = 30;
/** Floodlight colour: warm white. */
const FLOOD: [number, number, number] = [1, 0.86, 0.66];
/** Roof tone per building style (varied per building), well below the walls so roofs read from the cab. */
const ROOF: Record<BuildingStyle, string> = {
  terminal: '#b3b6b7',
  hangar: '#a6aaad',
  office: '#9f9e99',
  plain: '#c4c3bf',
};
/** Wall tints per style, one picked per building (multiplied over the facade texture). */
const WALL: Record<BuildingStyle, string[]> = {
  terminal: ['#ffffff', '#f2f4f5', '#e9eef1'],
  hangar: ['#ffffff', '#e4ebf1', '#dfe6ec', '#f1ece2', '#d7dfe5'],
  office: ['#ffffff', '#f1efe9', '#e6e3dc'],
  plain: ['#ffffff'],
};
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
  private aircraft = new Map<
    number,
    { mesh: AircraftMesh; shadow: THREE.Mesh; nav: THREE.Points; landing: THREE.Points }
  >();
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private skyGeo!: THREE.SphereGeometry;
  private clouds: THREE.SpriteMaterial[] = [];
  private env: THREE.Texture | null = null;
  /** Wall materials with lit windows at dusk and night. */
  private glazed: THREE.MeshStandardMaterial[] = [];
  private lightMat = lightMaterial();
  /** Runway and taxiway lights: their own brightness (the tower's light panel); time, fog and pixel ratio shared. */
  private airfieldMat = lightMaterial(this.lightMat);
  private lightPts: THREE.Points[] = [];
  /** Pools of floodlight on the aprons, shown at dusk and night. */
  private poolMat = new THREE.MeshBasicMaterial({
    color: '#ffd9a8',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    visible: false,
  });
  private look: Look = LOOKS.day;
  private shadowTex: THREE.CanvasTexture;
  private w = 1;
  private h = 1;
  private disposables: { dispose(): void }[] = [];
  /** Pavement textures get the large-scale variation (macro) multiplied in. */
  private pavement = new Set<THREE.Texture>();
  private macro: THREE.Texture | null = null;
  private apronTex: THREE.Texture | undefined;

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
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    // about one shadow-map texel (1.5 m): no stair-step acne on walls lit at a grazing angle
    sun.shadow.normalBias = 1.2;
    this.sun = sun;
    this.hemi = new THREE.HemisphereLight('#cfe2ff', '#8a8f7a', 2.4);
    this.scene.add(sun, sun.target, this.hemi);
    this.addSky();
    this.shadowTex = shadowTexture();
    this.disposables.push(this.lightMat, this.airfieldMat);
    this.addLights(airportLights(ap));
    this.setTimeOfDay('day');
  }

  /** Day, dusk or night: sky, sun (or moon), haze, reflections, window glow and the lights. */
  setTimeOfDay(t: TimeOfDay) {
    this.tod = t;
    const L = (this.look = foggy(LOOKS[t], FOG_LOOK[t], fogAmount(this.visM)));
    this.paintSky(L);
    (this.scene.fog as THREE.FogExp2).density = fogDensity(this.visM);
    (this.scene.fog as THREE.FogExp2).color.set(L.haze);
    const d = lookDirection(L.sun.az, -L.sun.el);
    this.sun.position.set(d.x * 6000, d.y * 6000, d.z * 6000);
    this.sun.color.set(L.sun.color);
    this.sun.intensity = L.sun.i;
    this.hemi.color.set(L.hemi[0]);
    this.hemi.groundColor.set(L.hemi[1]);
    this.hemi.intensity = L.hemi[2];
    this.env?.dispose();
    this.env = skyEnvironment(this.renderer, L.top, L.horizon);
    this.scene.environment = this.env;
    this.scene.environmentIntensity = L.env;
    this.renderer.toneMappingExposure = L.exposure;
    for (const m of this.clouds) {
      m.color.set(L.cloud[0]);
      m.opacity = L.cloud[1];
    }
    for (const m of this.glazed) m.emissiveIntensity = L.windows;
    this.lightMat.uniforms.uIntensity!.value = L.lights;
    this.applyLightStage();
    this.poolMat.opacity = 0.8 * L.lights;
    this.poolMat.visible = L.lights > 0;
    this.applyFloodlight();
    for (const p of this.lightPts) p.visible = L.lights > 0;
  }

  private tod: TimeOfDay = 'day';
  private visM = 10000;
  /** Prevailing visibility in metres: the fog, a greyer sky and a weaker sun. */
  setVisibility(m: number) {
    if (m === this.visM) return;
    this.visM = m;
    this.setTimeOfDay(this.tod);
  }

  /** Runway light brightness, stage 1 (dim) to 5 (bright), as on a tower's lighting panel; 4 is the default. */
  setLightStage(stage: number) {
    this.lightStage = Math.max(1, Math.min(5, Math.round(stage)));
    this.applyLightStage();
  }

  private lightStage = 4;
  /** Apron objects (parked aircraft, bridges, vehicles) brightened by the floodlights at dusk and night. */
  private floodlit: THREE.MeshStandardMaterial[] = [];
  private applyFloodlight() {
    for (const m of this.floodlit) {
      // glow in the material's own colour (and livery), as if lit from the masts
      m.emissive.copy(m.color).multiply(new THREE.Color('#ffe2bd'));
      m.emissiveMap = m.map;
      m.emissiveIntensity = 0.22 * this.look.lights;
    }
  }
  private applyLightStage() {
    const k = this.lightStage - 1;
    this.airfieldMat.uniforms.uIntensity!.value = this.look.lights * [0.3, 0.5, 0.75, 1, 1.3][k]!;
    this.airfieldMat.uniforms.uSize!.value = [0.6, 0.72, 0.86, 1, 1.12][k]!;
  }

  private points(s: LightSet, mat = this.lightMat): THREE.Points {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(s.pos, 3));
    geo.setAttribute('lcolor', new THREE.Float32BufferAttribute(s.color, 3));
    geo.setAttribute('size', new THREE.Float32BufferAttribute(s.size, 1));
    geo.setAttribute('blink', new THREE.Float32BufferAttribute(s.blink, 1));
    const p = new THREE.Points(geo, mat);
    p.renderOrder = 10;
    return p;
  }

  private addLights(s: LightSet, airfield = true) {
    const p = this.points(s, airfield ? this.airfieldMat : this.lightMat);
    p.visible = this.look.lights > 0;
    this.scene.add(p);
    this.lightPts.push(p);
    this.disposables.push(p.geometry);
  }

  /** Flat triangles on the ground ([x0, z0, x1, z1, ...]) as one layer, stacked by render order. */
  private layer(tris: number[], color: string, order: number, map?: THREE.Texture) {
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
  }

  /** Stand lead-in lines, parked aircraft and jet bridges (scenery, not in the sim). */
  loadApron(data: StandData, buildings: BuildingData, ground: GroundData): Parked[] {
    const lines: number[] = [];
    const pads: number[] = [];
    for (const s of data.stands) {
      const pts = s.pts.map((p) => llToGround(this.ap, p));
      ribbon(pts, 0.5, lines);
      // OSM aprons stop short of many stands (lines run onto grass); real stands are paved throughout
      ribbon(pts, STAND_PAD, pads);
    }
    this.layer(pads, APRON, -45, this.apronTex);
    this.layer(lines, YELLOW, -42);
    const { parked, bridges } = parkAircraft(this.ap, data, buildings.buildings, ground.taxiways);
    const { objects, disposables, lit } = apronObjects(
      parked,
      bridges,
      serviceVehicles(parked),
      this.shadowTex,
    );
    this.floodlit = lit;
    this.applyFloodlight();
    this.addFloodlights(data.masts.map((m) => ({ ...llToGround(this.ap, m.p), h: m.h || MAST_H })));
    this.scene.add(...objects);
    this.disposables.push(...disposables);
    return parked;
  }

  /**
   * Draw the airport surfaces as graphics on top of the land: aprons, taxiways, runways and their markings.
   * Layers are stacked by render order (land -72..-64, these -46..-38, shadows -10), never by depth.
   */
  loadSurfaces(g: GroundData) {
    const ap = this.ap;
    const layer = this.layer.bind(this);
    const polygons = this.polygons.bind(this);

    const grass = mownGrassTexture();
    this.disposables.push(grass);
    polygons(g.grass, '#ffffff', -46, grass);

    const concrete = photoTexture('concrete.jpg', 15);
    const asphalt = photoTexture('asphalt.jpg', 30);
    this.macro ??= photoTexture('macro.jpg', 1, false);
    this.pavement.add(concrete).add(asphalt);
    this.disposables.push(concrete, asphalt);
    polygons(g.aprons, APRON, -45, concrete);
    this.apronTex = concrete;
    polygons(g.taxiwayAreas, TAXIWAY, -44, asphalt);
    const taxi: number[] = [];
    const taxiLine: number[] = [];
    for (const t of g.taxiways) {
      const pts = t.pts.map((p) => llToGround(ap, p));
      ribbon(pts, t.w, taxi);
      ribbon(pts, 0.5, taxiLine);
    }
    layer(taxi, TAXIWAY, -43, asphalt);
    this.addWear(g.taxiways.map((t) => t.pts.map((p) => llToGround(ap, p))));
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
    for (const m of tyreMarks(ap)) {
      this.scene.add(m);
      this.disposables.push(m.geometry, m.material as THREE.Material);
    }
    this.addLights(taxiwayLights(ap, g));
    this.addLights(taxiwayEdgeLights(ap, g));
  }

  /**
   * Apron floodlight masts (OSM tower:type=lighting): poles by day; at dusk and night a light on top and a
   * soft pool of light on the ground (additive, depth-tested: the ground layers write no depth).
   */
  private addFloodlights(masts: { x: number; z: number; h: number }[]) {
    const cabs = this.ap.towers.map((t) => toWorld(t.pos));
    masts = masts.filter((m) => !cabs.some((k) => Math.hypot(k.x - m.x, k.z - m.z) < 80));
    if (!masts.length) return;
    const poles: THREE.BufferGeometry[] = [];
    const lights = emptyLights();
    for (const m of masts) {
      poles.push(new THREE.BoxGeometry(0.7, m.h, 0.7).toNonIndexed().translate(m.x, m.h / 2, m.z));
      poles.push(new THREE.BoxGeometry(3.2, 1, 1.4).toNonIndexed().translate(m.x, m.h + 0.5, m.z));
      addLight(lights, m.x, m.h, m.z, FLOOD, 7);
    }
    const geo = mergeGeometries(poles)!;
    poles.forEach((g) => g.dispose());
    const mat = new THREE.MeshStandardMaterial({ color: '#9aa0a5', roughness: 0.6, metalness: 0.3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.addLights(lights, false);

    const tex = poolTexture();
    this.poolMat.map = tex;
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const pools = new THREE.InstancedMesh(plane, this.poolMat, masts.length);
    const m4 = new THREE.Matrix4();
    masts.forEach((m, i) => {
      const r = m.h * 3.2; // a pool about three mast heights across each way
      pools.setMatrixAt(i, m4.makeScale(r * 2, 1, r * 2).setPosition(m.x, 0.1, m.z));
    });
    pools.renderOrder = -9;
    pools.frustumCulled = false;
    this.scene.add(pools);
    this.disposables.push(geo, mat, tex, plane, this.poolMat);
  }

  /** The dark worn band down the middle of each taxiway, soft-edged, under the centreline paint. */
  private addWear(lines: { x: number; z: number }[][]) {
    const tris: number[] = [];
    const weight: number[] = [];
    for (const pts of lines) {
      const b = softBand(pts, 6);
      tris.push(...b.tris);
      weight.push(...b.weight);
    }
    const n = weight.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = tris[i * 2]!;
      pos[i * 3 + 2] = tris[i * 2 + 1]!;
      col[i * 4 + 3] = weight[i]! * 0.2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    // transparent, so it draws after the opaque scene: depth-tested to stay under aircraft and buildings
    // (the ground layers write no depth)
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -42.5;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.disposables.push(geo, mat);
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

  /** The land around the airport (land use, water, motorways), from OSM. */
  loadLand(l: LandData) {
    const fields = fieldTexture();
    const rough = roughGrassTexture();
    // built-up land: asphalt photo with the macro variation, like the aprons (no slab grid to tile visibly)
    const paved = photoTexture('asphalt.jpg', 30);
    this.macro = photoTexture('macro.jpg', 1, false);
    this.pavement.add(paved);
    this.disposables.push(fields, rough, paved, this.macro);
    const water = waterTexture();
    this.disposables.push(water);
    const maps: Record<string, THREE.Texture> = {
      water,
      farm: fields,
      park: rough,
      forest: rough,
      residential: paved,
      industrial: paved,
      greenhouse: paved,
    };
    LAND.forEach(([cls, color], i) => l.land[cls] && this.polygons(l.land[cls], color, -72 + i, maps[cls]));
    const cabs = this.ap.towers.map((t) => toWorld(t.pos));
    for (const o of trees(this.ap, l, cabs)) {
      this.scene.add(o);
      const m = o as THREE.InstancedMesh;
      this.disposables.push(m.geometry, m.material as THREE.Material);
    }
    const flat = (xz: number[], color: string, order: number) => {
      faceUp(xz);
      const pos = new Float32Array((xz.length / 2) * 3);
      for (let i = 0, j = 0; i < xz.length; i += 2, j += 3) [pos[j], pos[j + 2]] = [xz[i]!, xz[i + 1]!];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(normalsUp(pos.length / 3), 3));
      this.addFlat(geo, color, order);
    };
    const ditches: number[] = [];
    for (const poly of l.land.farm ?? [])
      for (const ring of poly) {
        const pts = ring.map((p) => llToGround(this.ap, p));
        if (pts.some((p) => cabs.some((c) => Math.hypot(p.x - c.x, p.z - c.z) < DITCH_RANGE_M)))
          ribbon(pts, DITCH_W, ditches);
      }
    flat(ditches, DITCH, -65);
    const roads: number[] = [];
    for (const r of l.roads)
      ribbon(
        r.pts.map((p) => llToGround(this.ap, p)),
        r.w,
        roads,
      );
    flat(roads, ROAD, -64);
  }

  /** The airport buildings from OSM (public/tower/buildings.json). */
  loadBuildings(data: BuildingData) {
    this.addBuildings(data.buildings);
  }

  /**
   * Buildings as extruded footprints, one merged mesh per wall style plus the roofs and parapets.
   * Roofs are clearly darker than the walls and vary per building: from the cab they are most of what is seen.
   */
  private addBuildings(list: BuildingData['buildings']) {
    const walls: Record<BuildingStyle, THREE.BufferGeometry[]> = {
      terminal: [],
      hangar: [],
      office: [],
      plain: [],
    };
    const roofs: THREE.BufferGeometry[] = [];
    const parapets: THREE.BufferGeometry[] = [];
    const rnd = seeded(31);
    const cabs = this.ap.towers.map((t) => toWorld(t.pos));
    const tint = (geo: THREE.BufferGeometry, c: THREE.Color) => {
      const col = geo.attributes.color as THREE.BufferAttribute;
      for (let i = 0; i < col.count; i++)
        col.setXYZ(i, col.getX(i) * c.r, col.getY(i) * c.g, col.getZ(i) * c.b);
    };
    for (const b of list) {
      const pts = b.r.map((p) => llToGround(this.ap, p));
      const c = pts.reduce((m, q) => ({ x: m.x + q.x / pts.length, z: m.z + q.z / pts.length }), {
        x: 0,
        z: 0,
      });
      // the cab's own tower would wall off the view
      if (cabs.some((k) => Math.hypot(k.x - c.x, k.z - c.z) < 80)) continue;
      const base = b.mh ?? 0;
      const tall = b.h - base;
      const shape = new THREE.Shape(pts.map((q) => new THREE.Vector2(q.x, -q.z)));
      // a ring every 4 m or less, so the darkened wall base fades over the bottom 4 m
      const steps = base > 0 ? 1 : Math.max(1, Math.ceil(tall / 4));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: tall, bevelEnabled: false, steps });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, base, 0);
      // ExtrudeGeometry: group 0 = caps, group 1 = side walls
      const [caps, sides] = geo.groups as [THREE.GeometryGroup, THREE.GeometryGroup];
      const roof = slice(geo, caps.start, caps.count);
      // higher roofs a little lighter (more sky, less soot), so stepped levels read apart
      const lift = 1 + 0.12 * Math.min(1, Math.max(0, (b.h - 8) / 25));
      const tone = new THREE.Color(ROOF[b.s]).multiplyScalar((0.88 + rnd() * 0.18) * lift);
      const rc = new Float32Array(roof.attributes.position!.count * 3);
      for (let i = 0; i < rc.length; i += 3) rc.set([tone.r, tone.g, tone.b], i);
      roof.setAttribute('color', new THREE.BufferAttribute(rc, 3));
      roofs.push(roof);
      const wall = shadeWalls(slice(geo, sides.start, sides.count));
      const shades = WALL[b.s];
      tint(wall, new THREE.Color(shades[Math.floor(rnd() * shades.length)]!));
      walls[b.s].push(wall);
      geo.dispose();
      if (b.s !== 'plain') parapets.push(parapet(pts, b.h));
    }

    const add = (
      geos: THREE.BufferGeometry[],
      opts: THREE.MeshStandardMaterialParameters,
      glow?: THREE.Texture,
    ) => {
      if (!geos.length) return;
      const geo = mergeGeometries(geos)!;
      geos.forEach((g) => g.dispose());
      const mat = new THREE.MeshStandardMaterial({
        roughness: 0.82,
        vertexColors: !!geo.attributes.color,
        ...opts,
      });
      if (glow) {
        // lit windows at dusk and night
        Object.assign(mat, { emissive: new THREE.Color('#ffd49a'), emissiveMap: glow });
        mat.emissiveIntensity = this.look.windows;
        this.glazed.push(mat);
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.disposables.push(geo, mat);
    };
    const tex = {
      office: windowTexture(),
      officeGlow: windowGlowTexture(),
      terminal: terminalTexture(),
      terminalGlow: terminalGlowTexture(),
      hangar: claddingTexture(),
      roof: roofTexture(),
    };
    this.disposables.push(...Object.values(tex));
    add(roofs, { color: '#ffffff', map: tex.roof, roughness: 0.92 });
    add(
      walls.terminal,
      { color: '#ffffff', map: tex.terminal, roughness: 0.55, metalness: 0.15 },
      tex.terminalGlow,
    );
    add(walls.office, { color: '#ffffff', map: tex.office }, tex.officeGlow);
    add(walls.hangar, { color: '#ffffff', map: tex.hangar, roughness: 0.7, metalness: 0.1 });
    add(walls.plain, { color: '#e6e4de' });
    // both faces: seen from outside as the top of the wall, from the roof as its rim
    add(parapets, { color: '#ffffff', roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide });
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
    if (map && this.macro && this.pavement.has(map)) withMacro(mat, this.macro);
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
    const geo = (this.skyGeo = new THREE.SphereGeometry(R, 32, 16));
    geo.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position!.count * 3), 3),
    );
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
    // uv in metres, as the other ground layers, for the grass texture
    const lp = landGeo.attributes.position!;
    for (let i = 0; i < lp.count; i++) landGeo.attributes.uv!.setXY(i, lp.getX(i), lp.getY(i));
    const rough = roughGrassTexture();
    const landMat = new THREE.MeshLambertMaterial({
      color: '#7d965a',
      map: rough,
      depthTest: false,
      depthWrite: false,
    });
    const land = new THREE.Mesh(landGeo, landMat);
    land.rotation.x = -Math.PI / 2;
    land.renderOrder = -90;
    this.scene.add(land);
    this.disposables.push(geo, skyMat, landGeo, landMat, rough);

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
      this.clouds.push(mat);
      this.disposables.push(tex, mat);
    }
  }

  /** Sky gradient: horizon → mid → top, the horizon shading from `horizon` on the sun's side to `away`. */
  private paintSky(L: Look) {
    const geo = this.skyGeo;
    const R = geo.parameters.radius;
    const top = new THREE.Color(L.top);
    const mid = new THREE.Color(L.mid);
    const near = new THREE.Color(L.horizon);
    const away = new THREE.Color(L.away);
    const sx = Math.sin((L.sun.az * Math.PI) / 180);
    const sz = -Math.cos((L.sun.az * Math.PI) / 180);
    const pos = geo.attributes.position!;
    const col = geo.attributes.color!;
    const hor = new THREE.Color();
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const t = Math.max(0, pos.getY(i) / R);
      const toSun = (1 + (x * sx + z * sz) / (Math.hypot(x, z) || 1)) / 2;
      hor.copy(away).lerp(near, Math.pow(toSun, 1.6));
      if (t < 0.1) c.copy(hor).lerp(mid, Math.pow(t / 0.1, 0.8));
      else c.copy(mid).lerp(top, Math.min(1, (t - 0.1) / 0.45));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
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
            // depth-tested so it stays under the aircraft; the ground layers write no depth
            depthWrite: false,
          }),
        );
        shadow.rotation.order = 'YXZ';
        shadow.renderOrder = -10;
        const nav = this.points(mesh.userData.lights.nav);
        const landing = this.points(mesh.userData.lights.landing);
        mesh.add(nav, landing);
        this.scene.add(mesh, shadow);
        this.aircraft.set(a.id, (e = { mesh, shadow, nav, landing }));
      }
      const { mesh, shadow, nav, landing } = e;
      nav.visible = this.look.lights > 0;
      // landing lights stay on below 10,000 ft, which is all the traffic a tower sees
      landing.visible = nav.visible;
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

    const u = this.lightMat.uniforms;
    u.uTime!.value = performance.now() / 1000;
    u.uPx!.value = this.renderer.getPixelRatio();
    u.uFog!.value = (this.scene.fog as THREE.FogExp2).density * LIGHT_FOG;
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
    this.env?.dispose();
    this.renderer.dispose();
  }
}

/** Glowing points with a fixed on-screen size (shrinking a little with distance), faded by the haze. */
/** `share`: take time, pixel ratio and fog from another light material (updated once per frame). */
function lightMaterial(share?: THREE.ShaderMaterial): THREE.ShaderMaterial {
  const u = share?.uniforms;
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: u?.uTime ?? { value: 0 },
      uPx: u?.uPx ?? { value: 1 },
      uFog: u?.uFog ?? { value: 0 },
      uIntensity: { value: 1 },
      uSize: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 lcolor;
      attribute float size;
      attribute float blink;
      uniform float uTime;
      uniform float uPx;
      uniform float uFog;
      uniform float uSize;
      varying vec3 vColor;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = max(1.0, -mv.z);
        float on = 1.0;
        if (blink > 0.5 && blink < 1.5) on = step(0.55, fract(uTime * 1.1));
        else if (blink > 1.5) {
          float t = fract(uTime * 0.75);
          on = step(t, 0.05) + step(0.12, t) * step(t, 0.17);
        }
        float f = uFog * d;
        vA = on * exp(-f * f);
        vColor = lcolor;
        // grow with the zoom (binoculars), by its square root so lights stay points; 4.33 = 1/tan(13°), the cab FOV
        float zoom = sqrt(max(1.0, projectionMatrix[1][1] / 4.33));
        gl_PointSize = on > 0.0 ? size * uSize * uPx * zoom * clamp(1500.0 / d, 0.8, 2.4) : 0.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      varying vec3 vColor;
      varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        if (r > 1.0) discard;
        float a = exp(-r * r * 4.0) + 0.6 * exp(-r * r * 30.0);
        gl_FragColor = vec4(vColor * uIntensity, a * vA);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
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

/** A pavement photo texture from public/tower/tex (scripts/build-tower-textures.py), `metres` per tile. */
function photoTexture(file: string, metres: number, srgb = true): THREE.Texture {
  const t = new THREE.TextureLoader().load(new URL(`./tower/tex/${file}`, document.baseURI).href);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / metres, 1 / metres);
  t.anisotropy = 8;
  return t;
}

/** Multiply a 1.2 km tile of soft variation over a ground material, so wide pavement is not one flat tone. */
function withMacro(mat: THREE.Material, macro: THREE.Texture) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.macroMap = { value: macro };
    sh.vertexShader =
      'varying vec2 vMacroUv;\n' +
      sh.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvMacroUv = (modelMatrix * vec4(transformed, 1.0)).xz / 1200.0;',
      );
    // macro.jpg has a mean of 200/255: scale so the average tone is unchanged
    sh.fragmentShader =
      'uniform sampler2D macroMap;\nvarying vec2 vMacroUv;\n' +
      sh.fragmentShader.replace(
        '#include <map_fragment>',
        '#include <map_fragment>\ndiffuseColor.rgb *= texture2D(macroMap, vMacroUv).r * 1.275;',
      );
  };
  mat.customProgramCacheKey = () => 'macro';
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

/**
 * Terminal and pier facade: a tall band of blue-grey glass between light metal spandrels, one storey (4.5 m)
 * per tile, mullions every 1.5 m. From memory of the Schiphol piers, not from drawings.
 */
function terminalTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 48;
  c.height = 36;
  const g = c.getContext('2d')!;
  g.fillStyle = '#dfe3e5';
  g.fillRect(0, 0, 48, 36);
  const glass = g.createLinearGradient(0, 6, 0, 31);
  glass.addColorStop(0, '#7b91a2');
  glass.addColorStop(1, '#4d6474');
  g.fillStyle = glass;
  g.fillRect(0, 6, 48, 25);
  g.fillStyle = '#aab3ba';
  for (let x = 0; x < 48; x += 12) g.fillRect(x, 6, 1, 25);
  return wallTexture(c, 6, 4.5);
}

/** Emissive map for the terminal glass: most of it lit, as a terminal is open all night. */
function terminalGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 48 * 8;
  c.height = 36;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, 36);
  const rnd = seeded(8);
  for (let k = 0; k < 8; k++) {
    const v = rnd() < 0.15 ? 0.15 : 0.6 + rnd() * 0.4;
    g.fillStyle = `rgb(${Math.round(255 * v)},${Math.round(240 * v)},${Math.round(215 * v)})`;
    g.fillRect(k * 48, 6, 48, 25);
  }
  return wallTexture(c, 48, 4.5);
}

/** Hangar and cargo cladding: vertical profiled sheet with a seam every 2 m and a darker band at 4 m. */
function claddingTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e1e4e6';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(0,0,0,0.06)';
  for (let x = 0; x < 64; x += 2) g.fillRect(x, 0, 1, 64);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 1, 64);
  g.fillStyle = 'rgba(0,0,0,0.08)';
  g.fillRect(0, 30, 64, 3);
  return wallTexture(c, 8, 8);
}

/**
 * A flat roof seen from above, tiling every 80 m: membrane strips (2 m) and panel joints (16 m), weathering
 * blotches, lighter repaired patches and drain stains. Multiplied over the roof tone; mean about 0.93.
 */
function roofTexture(): THREE.CanvasTexture {
  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  let seed = 4242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  g.fillStyle = '#f2f2f0';
  g.fillRect(0, 0, N, N);
  // draw wrapped so the tile repeats without seams
  const wrapped = (draw: (dx: number, dy: number) => void) => {
    for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) draw(dx, dy);
  };
  const px = N / 80; // pixels per metre
  for (let i = 0; i < 60; i++) {
    const [x, y, r, a] = [rnd() * N, rnd() * N, (4 + rnd() * 18) * px, 0.03 + rnd() * 0.05];
    wrapped((dx, dy) => {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      gr.addColorStop(0, `rgba(40,38,34,${a})`);
      gr.addColorStop(1, 'rgba(40,38,34,0)');
      g.fillStyle = gr;
      g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
    });
  }
  for (let i = 0; i < 8; i++) {
    const [x, y, w, h] = [rnd() * N, rnd() * N, (4 + rnd() * 10) * px, (2 + rnd() * 6) * px];
    g.fillStyle = 'rgba(255,255,255,0.35)';
    wrapped((dx, dy) => g.fillRect(x + dx, y + dy, w, h));
  }
  g.fillStyle = 'rgba(0,0,0,0.05)';
  for (let x = 0; x < N; x += 2 * px) g.fillRect(Math.round(x), 0, 1, N);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let v = 0; v < N; v += 16 * px) {
    g.fillRect(Math.round(v), 0, 2, N);
    g.fillRect(0, Math.round(v), N, 2);
  }
  for (let i = 0; i < 14; i++) {
    const [x, y] = [rnd() * N, rnd() * N];
    g.fillStyle = 'rgba(30,30,30,0.25)';
    g.beginPath();
    g.arc(x, y, 0.6 * px, 0, Math.PI * 2);
    g.fill();
  }
  return wallTexture(c, 80, 80);
}

function wallTexture(c: HTMLCanvasElement, wide: number, tall: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / wide, 1 / tall);
  t.anisotropy = 4;
  return t;
}

/** A soft round pool of light, bright in the middle and gone at the edge. */
function poolTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Roof edges stand this much above the roof (m). */
const PARAPET_H = 1;
/**
 * A parapet round a flat roof: a 1 m upstand along the outline with a light metal coping on top and a darker
 * inner face, so each roof level has a bright rim and a shadow line where it meets the roof.
 */
function parapet(pts: { x: number; z: number }[], h: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    if (a.x === b.x && a.z === b.z) continue;
    pos.push(
      a.x,
      h,
      a.z,
      b.x,
      h,
      b.z,
      b.x,
      h + PARAPET_H,
      b.z,
      a.x,
      h,
      a.z,
      b.x,
      h + PARAPET_H,
      b.z,
      a.x,
      h + PARAPET_H,
      a.z,
    );
    // dark where it meets the roof, coping-bright at the top
    for (const t of [0, 0, 1, 0, 1, 1]) col.push(...(t ? [0.95, 0.96, 0.97] : [0.55, 0.56, 0.58]));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Emissive map for the window bands: warm light, some offices dark, same layout as windowTexture. */
function windowGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 32 * 8;
  c.height = 28;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, 28);
  const rnd = seeded(5);
  for (let k = 0; k < 8; k++) {
    const v = rnd() < 0.3 ? 0.08 : 0.55 + rnd() * 0.45;
    g.fillStyle = `rgb(${Math.round(255 * v)},${Math.round(235 * v)},${Math.round(200 * v)})`;
    g.fillRect(k * 32 + 1, 8, 31, 14);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 32, 1 / 3.5);
  t.anisotropy = 4;
  return t;
}
