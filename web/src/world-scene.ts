import * as THREE from "three";
import { OrbitController, type OrbitPose } from "./orbit-controller";
import {
  barycentric,
  traceSurfacePath,
  type SurfaceStart,
  type TracedPath,
} from "./path-tracer";
import type {
  RoutePreset,
  RoutePresetId,
  WorldData,
  WorldMetadata,
} from "./world-data";

const INVALID_INDEX = 0xffffffff;
const DEFAULT_ROUTE: RoutePresetId = "ridge-crossing";

const ROUTE_COLORS: Record<RoutePresetId, number> = {
  "ridge-crossing": 0xffbd62,
  "inner-saddle-pass": 0x78d5c6,
  "basin-rim": 0xc9afff,
};

const ACT_CAPTIONS = [
  "A closed genus-one torus generated and solved by the C++ engine.",
  "The ambient chord can cross the tube or empty space, so it cannot be walked.",
  "Dijkstra follows mesh edges and inherits their directional bias.",
  "Choose a native-authored start at the ridge, inner throat, or basin rim.",
  "Six exported diffusion states spread over the torus from the amber beacon.",
  "Depth-tested face arrows and a lifted route follow the reconstructed field.",
  "Contours show level sets of one Heat Method distance field.",
  "A restrained x-ray overlay keeps three fallback-free Heat paths readable.",
  "C++20 and Eigen export geometry, sparse-solve fields, and measured routes.",
  "Orbit the torus to inspect the approximate surface path from either side.",
] as const;

interface SceneOptions {
  reducedMotion: boolean;
  onRouteSelected?: (preset: RoutePreset) => void;
  onExploreChange?: (engaged: boolean) => void;
  onCaptionChange?: (caption: string) => void;
}

type RouteVisual = {
  preset: RoutePreset;
  start: SurfaceStart;
  startNormal: THREE.Vector3;
  ambientLine: THREE.Line;
  dijkstraLine: THREE.Line;
  heatPath: THREE.Mesh;
  traced: TracedPath;
};

function vertexVector(
  data: WorldData | Float32Array,
  index: number,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  return target.fromArray(
    data instanceof Float32Array ? data : data.positions,
    3 * index,
  );
}

function triangleVertices(
  data: WorldData,
  face: number,
): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  return [
    vertexVector(data, data.indices[3 * face]!),
    vertexVector(data, data.indices[3 * face + 1]!),
    vertexVector(data, data.indices[3 * face + 2]!),
  ];
}

function interpolateSurfaceStart(
  data: WorldData,
  preset: RoutePreset,
): SurfaceStart {
  const point = new THREE.Vector3();
  for (let local = 0; local < 3; local += 1) {
    point.addScaledVector(
      vertexVector(data, data.indices[3 * preset.startFace + local]!),
      preset.startBarycentric[local]!,
    );
  }
  return { face: preset.startFace, point };
}

function interpolatedNormal(
  data: WorldData,
  face: number,
  point: THREE.Vector3,
): THREE.Vector3 {
  const vertices = triangleVertices(data, face);
  const weights = barycentric(point, ...vertices);
  const normal = new THREE.Vector3();
  for (let local = 0; local < 3; local += 1) {
    normal.addScaledVector(
      vertexVector(data.normals, data.indices[3 * face + local]!),
      weights[local]!,
    );
  }
  return normal.normalize();
}

function nearestVertexNormal(
  data: WorldData,
  point: THREE.Vector3,
): THREE.Vector3 {
  let best = 0;
  let bestSquaredDistance = Number.POSITIVE_INFINITY;
  const candidate = new THREE.Vector3();
  for (let vertex = 0; vertex < data.vertexCount; vertex += 1) {
    candidate.fromArray(data.positions, 3 * vertex);
    const squaredDistance = candidate.distanceToSquared(point);
    if (squaredDistance < bestSquaredDistance) {
      best = vertex;
      bestSquaredDistance = squaredDistance;
    }
  }
  return vertexVector(data.normals, best).normalize();
}

function liftedTracePoints(
  data: WorldData,
  traced: TracedPath,
  offset: number,
): THREE.Vector3[] {
  return traced.points.map((point, index) => {
    const face = traced.faces[index] ?? -1;
    const normal =
      face >= 0
        ? interpolatedNormal(data, face, point)
        : nearestVertexNormal(data, point);
    return point.clone().addScaledVector(normal, offset);
  });
}

function makeMarker(color: number, radius: number): THREE.Group {
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 18, 12),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 2.1,
      roughness: 0.34,
    }),
  );
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 1.9, radius * 0.07, 8, 36),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65 }),
  );
  ring.rotation.x = Math.PI / 2;
  group.add(core, ring);
  return group;
}

function placeOnSurface(
  marker: THREE.Object3D,
  point: THREE.Vector3,
  normal: THREE.Vector3,
  offset: number,
): void {
  marker.position.copy(point).addScaledVector(normal, offset);
  marker.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    normal.clone().normalize(),
  );
}

function makePathTube(
  points: readonly THREE.Vector3[],
  radius: number,
  color: number,
): THREE.Mesh {
  if (points.length < 2) throw new Error("A route needs at least two points");
  const curve = new THREE.CurvePath<THREE.Vector3>();
  for (let index = 0; index + 1 < points.length; index += 1) {
    curve.add(
      new THREE.LineCurve3(points[index]!.clone(), points[index + 1]!.clone()),
    );
  }
  return new THREE.Mesh(
    new THREE.TubeGeometry(
      curve,
      Math.max(72, Math.min(760, points.length * 4)),
      radius,
      6,
      false,
    ),
    new THREE.MeshBasicMaterial({
      color,
      toneMapped: false,
      transparent: true,
      opacity: 1,
      depthTest: true,
      depthWrite: false,
    }),
  );
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

export class WorldScene {
  private readonly data: WorldData;
  private readonly metadata: WorldMetadata;
  private readonly canvas: HTMLCanvasElement;
  private readonly reducedMotion: boolean;
  private readonly onRouteSelected?: (preset: RoutePreset) => void;
  private readonly onCaptionChange?: (caption: string) => void;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly world = new THREE.Group();
  private readonly geometry = new THREE.BufferGeometry();
  private readonly colors: Float32Array;
  private readonly baseColors: Float32Array;
  private readonly distanceColors: Float32Array;
  private readonly contourColors: Float32Array;
  private readonly colorAttribute: THREE.BufferAttribute;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly wireframe: THREE.Mesh;
  private readonly atmosphere: THREE.Mesh;
  private readonly beacon: THREE.Group;
  private readonly explorer: THREE.Group;
  private readonly gradientLines: THREE.LineSegments;
  private readonly routeVisuals = new Map<RoutePresetId, RouteVisual>();
  private readonly resizeObserver: ResizeObserver;
  private readonly worldCenter = new THREE.Vector3();
  private readonly sourcePoint: THREE.Vector3;
  private readonly sourceNormal: THREE.Vector3;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly controls: OrbitController;
  private readonly palette = new Float32Array(256 * 3);
  private selectedRouteId: RoutePresetId = DEFAULT_ROUTE;
  private comparisonVisible = false;
  private activeAct = 0;
  private heatStarted = false;
  private heatStartTime = 0;
  private routeReplayStart = 0;
  private routeReplayRevision = 0;
  private actStartTime = performance.now();
  private animationFrame = 0;
  private lastFrameTime = performance.now();
  private disposed = false;

  constructor(
    canvas: HTMLCanvasElement,
    data: WorldData,
    metadata: WorldMetadata,
    options: SceneOptions,
  ) {
    this.canvas = canvas;
    this.data = data;
    this.metadata = metadata;
    this.reducedMotion = options.reducedMotion;
    this.onRouteSelected = options.onRouteSelected;
    this.onCaptionChange = options.onCaptionChange;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.03;
    this.scene.fog = new THREE.FogExp2(0x000000, 0.035);

    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(data.positions, 3),
    );
    this.geometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(data.normals, 3),
    );
    this.geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    this.geometry.computeBoundingSphere();
    if (this.geometry.boundingSphere) {
      this.worldCenter.copy(this.geometry.boundingSphere.center);
    }
    this.baseColors = this.buildBaseColors();
    this.distanceColors = this.buildDistanceColors(false);
    this.contourColors = this.buildDistanceColors(true);
    this.colors = this.baseColors.slice();
    this.colorAttribute = new THREE.BufferAttribute(this.colors, 3);
    this.geometry.setAttribute("color", this.colorAttribute);

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.77,
      metalness: 0.015,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "computed-curved-world";
    this.wireframe = new THREE.Mesh(
      this.geometry,
      new THREE.MeshBasicMaterial({
        color: 0xa6c9c2,
        wireframe: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.wireframe.scale.setScalar(1.0012);
    this.atmosphere = new THREE.Mesh(
      this.geometry,
      new THREE.MeshBasicMaterial({
        color: 0x65c8b6,
        side: THREE.BackSide,
        transparent: true,
        opacity: 0.035,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.atmosphere.scale.setScalar(1.045);
    this.world.add(this.mesh, this.wireframe, this.atmosphere);

    this.sourcePoint = vertexVector(data, data.sourceVertex);
    this.sourceNormal = vertexVector(
      data.normals,
      data.sourceVertex,
    ).normalize();
    this.beacon = makeMarker(0xffc66d, 0.027);
    placeOnSurface(this.beacon, this.sourcePoint, this.sourceNormal, 0.035);
    const beaconLight = new THREE.PointLight(0xffb454, 1.55, 0.78, 1.8);
    beaconLight.position.set(0, 0.04, 0);
    this.beacon.add(beaconLight);
    this.world.add(this.beacon);

    this.explorer = makeMarker(0xf5f7f6, 0.022);
    this.world.add(this.explorer);

    this.gradientLines = this.createGradientLines();
    this.gradientLines.visible = false;
    this.world.add(this.gradientLines);
    this.buildPalette();
    this.buildRouteVisuals();

    this.scene.add(this.world);
    this.scene.add(new THREE.HemisphereLight(0xe5f4ef, 0x18201f, 1.7));
    const key = new THREE.DirectionalLight(0xffead0, 2.0);
    key.position.set(3.5, 3.2, 4.8);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x65d9c5, 1.2);
    rim.position.set(-3.2, 1.2, -2.5);
    this.scene.add(rim);
    const innerFill = new THREE.PointLight(0x9abeb8, 0.8, 5.5, 1.2);
    innerFill.position.set(0, 0.25, 0.35);
    this.scene.add(innerFill);

    this.canvas.dataset.act = "0";
    this.canvas.dataset.activeRoute = DEFAULT_ROUTE;
    this.canvas.dataset.comparison = "false";
    this.canvas.dataset.heatMode = "idle";
    this.canvas.dataset.worldKind = metadata.mesh.kind;
    this.canvas.dataset.topology = `genus-${metadata.topology.genus}`;
    this.canvas.dataset.vertexCount = String(data.vertexCount);
    this.canvas.dataset.faceCount = String(data.faceCount);
    this.canvas.dataset.beaconClickable = "true";
    this.canvas.dataset.routeStartClickable = "true";
    this.positionExplorer();
    this.applyVisualState();

    this.controls = new OrbitController(
      this.camera,
      this.canvas,
      this.routePose(DEFAULT_ROUTE),
      {
        reducedMotion: this.reducedMotion,
        onExploreChange: options.onExploreChange,
        onInteraction: () => {
          this.canvas.dataset.focusTarget = "manual";
        },
        onTap: (clientX, clientY) => this.focusMarkerAt(clientX, clientY),
        onDoubleTap: (clientX, clientY) => {
          if (!this.focusMarkerAt(clientX, clientY)) this.resetView();
        },
        onReset: () => this.resetView(),
      },
    );

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.resize();
    if (!document.hidden)
      this.animationFrame = requestAnimationFrame(this.render);
  }

  get caption(): string {
    if (this.comparisonVisible) return ACT_CAPTIONS[7];
    return ACT_CAPTIONS[this.activeAct] ?? ACT_CAPTIONS[0];
  }

  get selectedPreset(): RoutePreset {
    return this.routeVisuals.get(this.selectedRouteId)!.preset;
  }

  get exploreEngaged(): boolean {
    return this.controls.isExploreEngaged;
  }

  setExplore(engaged: boolean): void {
    this.controls.setExplore(engaged);
  }

  toggleExplore(): void {
    this.controls.toggleExplore();
  }

  resetView(): void {
    this.canvas.dataset.focusTarget = "route";
    this.controls.setPose(this.routePose(this.selectedRouteId), true);
    this.onCaptionChange?.("The selected route and beacon are framed again.");
  }

  focusBeacon(): void {
    this.canvas.dataset.focusTarget = "beacon";
    this.controls.setPose(
      this.focusPose(this.sourcePoint, this.sourceNormal),
      true,
      850,
    );
    this.onCaptionChange?.(
      "Focused on the amber heat source. Drag to inspect its position.",
    );
  }

  focusRouteStart(): void {
    const visual = this.routeVisuals.get(this.selectedRouteId)!;
    this.canvas.dataset.focusTarget = "route-start";
    this.controls.setPose(
      this.focusPose(visual.start.point, visual.startNormal),
      true,
      850,
    );
    this.onCaptionChange?.(
      `Focused on the ${visual.preset.label.toLowerCase()} start.`,
    );
  }

  selectRoute(routeId: RoutePresetId): void {
    const visual = this.routeVisuals.get(routeId);
    if (!visual) throw new Error(`Unknown route preset: ${routeId}`);
    this.selectedRouteId = routeId;
    this.comparisonVisible = false;
    this.canvas.dataset.activeRoute = routeId;
    this.canvas.dataset.comparison = "false";
    this.positionExplorer();
    this.canvas.dataset.focusTarget = "route";
    this.controls.setPose(this.routePose(routeId), true);
    this.applyVisualState();
    this.onRouteSelected?.(visual.preset);
  }

  showRouteComparison(frameView = true): void {
    this.comparisonVisible = true;
    this.canvas.dataset.comparison = "true";
    this.canvas.dataset.focusTarget = "comparison";
    if (frameView) this.controls.setPose(this.comparisonPose(), true);
    this.applyVisualState();
  }

  hideRouteComparison(): void {
    this.comparisonVisible = false;
    this.canvas.dataset.comparison = "false";
    this.applyVisualState();
  }

  replayRoute(): void {
    this.hideRouteComparison();
    this.routeReplayStart = performance.now();
    this.routeReplayRevision += 1;
    this.canvas.dataset.routeReplay = String(this.routeReplayRevision);
  }

  resetJourney(): void {
    this.heatStarted = false;
    this.canvas.dataset.heatMode = "idle";
    delete this.canvas.dataset.heatProgress;
    this.activeAct = 0;
    this.canvas.dataset.act = "0";
    this.applyColors(this.baseColors);
    this.selectRoute(DEFAULT_ROUTE);
    this.resetView();
  }

  setAct(act: number): void {
    const next = Math.max(0, Math.min(9, act));
    if (next === this.activeAct) return;
    this.activeAct = next;
    this.canvas.dataset.act = String(next);
    this.actStartTime = performance.now();
    if (next === 7) this.showRouteComparison(false);
    else if (this.comparisonVisible) this.hideRouteComparison();

    const wireMaterial = this.wireframe.material as THREE.MeshBasicMaterial;
    wireMaterial.opacity = next === 2 ? 0.22 : next === 8 ? 0.16 : 0;
    this.wireframe.visible = wireMaterial.opacity > 0;
    this.gradientLines.visible = next === 5;
    if ([0, 1, 2, 3, 8].includes(next)) this.applyColors(this.baseColors);
    if (next === 4 && !this.heatStarted)
      this.applyHeatFrame(Math.floor(this.data.heatFrameCount / 2));
    if ([5, 7, 9].includes(next)) this.applyColors(this.distanceColors);
    if (next === 6) this.applyColors(this.contourColors);
    this.requestStoryPose(next);
    this.applyVisualState();
  }

  releaseHeat(): void {
    this.heatStarted = true;
    this.heatStartTime = performance.now();
    this.activeAct = 4;
    this.canvas.dataset.act = "4";
    this.canvas.dataset.heatMode = "animation";
    this.canvas.dataset.heatProgress = "0";
    this.hideRouteComparison();
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
    this.controls.destroy();
    for (const visual of this.routeVisuals.values()) {
      disposeObject(visual.ambientLine);
      disposeObject(visual.dijkstraLine);
      disposeObject(visual.heatPath);
    }
    this.routeVisuals.clear();
    this.gradientLines.geometry.dispose();
    (this.gradientLines.material as THREE.Material).dispose();
    disposeObject(this.beacon);
    disposeObject(this.explorer);
    this.geometry.dispose();
    this.material.dispose();
    (this.wireframe.material as THREE.Material).dispose();
    (this.atmosphere.material as THREE.Material).dispose();
    this.renderer.dispose();
  }

  private buildBaseColors(): Float32Array {
    const result = new Float32Array(this.data.vertexCount * 3);
    const radii = new Float32Array(this.data.vertexCount);
    let minimumRadius = Number.POSITIVE_INFINITY;
    let maximumRadius = Number.NEGATIVE_INFINITY;
    for (let vertex = 0; vertex < this.data.vertexCount; vertex += 1) {
      const radius = vertexVector(this.data.positions, vertex).length();
      radii[vertex] = radius;
      minimumRadius = Math.min(minimumRadius, radius);
      maximumRadius = Math.max(maximumRadius, radius);
    }
    const range = Math.max(maximumRadius - minimumRadius, 1e-9);
    const low = new THREE.Color(0x102b2e);
    const high = new THREE.Color(0x748076);
    for (let vertex = 0; vertex < this.data.vertexCount; vertex += 1) {
      const radial = (radii[vertex]! - minimumRadius) / range;
      const normalY = this.data.normals[3 * vertex + 1]!;
      const mix = THREE.MathUtils.clamp(
        0.1 + 0.72 * radial + 0.1 * normalY,
        0,
        1,
      );
      const color = low.clone().lerp(high, mix);
      result.set([color.r, color.g, color.b], 3 * vertex);
    }
    return result;
  }

  private buildDistanceColors(contours: boolean): Float32Array {
    const result = new Float32Array(this.data.vertexCount * 3);
    let maximum = 0;
    for (const value of this.data.distance) maximum = Math.max(maximum, value);
    const cold = new THREE.Color(0x153438);
    const middle = new THREE.Color(0x4d857b);
    const warm = new THREE.Color(0xf2b65f);
    for (let vertex = 0; vertex < this.data.vertexCount; vertex += 1) {
      const normalized = THREE.MathUtils.clamp(
        this.data.distance[vertex]! / Math.max(maximum, 1e-9),
        0,
        1,
      );
      let color =
        normalized < 0.56
          ? cold.clone().lerp(middle, normalized / 0.56)
          : middle.clone().lerp(warm, (normalized - 0.56) / 0.44);
      if (contours) {
        const band =
          0.72 +
          0.28 * Math.pow(Math.abs(Math.sin(normalized * Math.PI * 22)), 7);
        color = color.multiplyScalar(band);
      }
      result.set([color.r, color.g, color.b], 3 * vertex);
    }
    return result;
  }

  private buildPalette(): void {
    const cold = new THREE.Color(0x0f2c34);
    const ember = new THREE.Color(0xc9693d);
    const hot = new THREE.Color(0xffd88c);
    for (let index = 0; index < 256; index += 1) {
      const value = index / 255;
      const color =
        value < 0.72
          ? cold.clone().lerp(ember, Math.pow(value / 0.72, 2.2))
          : ember.clone().lerp(hot, (value - 0.72) / 0.28);
      this.palette.set([color.r, color.g, color.b], 3 * index);
    }
  }

  private applyColors(source: Float32Array): void {
    this.colors.set(source);
    this.colorAttribute.needsUpdate = true;
  }

  private applyHeatFrame(frameIndex: number): void {
    const frame = this.data.heatFrames[frameIndex];
    if (!frame) return;
    for (let vertex = 0; vertex < this.data.vertexCount; vertex += 1) {
      const paletteIndex = Math.min(
        255,
        Math.max(0, Math.round(frame[vertex]! / 257)),
      );
      this.colors[3 * vertex] = this.palette[3 * paletteIndex]!;
      this.colors[3 * vertex + 1] = this.palette[3 * paletteIndex + 1]!;
      this.colors[3 * vertex + 2] = this.palette[3 * paletteIndex + 2]!;
    }
    this.colorAttribute.needsUpdate = true;
  }

  private applyHeat(progress: number): void {
    const scaled =
      THREE.MathUtils.clamp(progress, 0, 1) * (this.data.heatFrameCount - 1);
    const first = Math.floor(scaled);
    const second = Math.min(first + 1, this.data.heatFrameCount - 1);
    const mix = scaled - first;
    const a = this.data.heatFrames[first]!;
    const b = this.data.heatFrames[second]!;
    for (let vertex = 0; vertex < this.data.vertexCount; vertex += 1) {
      const normalized =
        THREE.MathUtils.lerp(a[vertex]!, b[vertex]!, mix) / 65535;
      const paletteIndex = Math.min(
        255,
        Math.max(0, Math.round(normalized * 255)),
      );
      this.colors[3 * vertex] = this.palette[3 * paletteIndex]!;
      this.colors[3 * vertex + 1] = this.palette[3 * paletteIndex + 1]!;
      this.colors[3 * vertex + 2] = this.palette[3 * paletteIndex + 2]!;
    }
    this.colorAttribute.needsUpdate = true;
    this.canvas.dataset.heatProgress = THREE.MathUtils.clamp(
      progress,
      0,
      1,
    ).toFixed(3);
  }

  private createGradientLines(): THREE.LineSegments {
    const positions: number[] = [];
    this.data.gradientSamples.forEach((sample, sampleIndex) => {
      if (sampleIndex % 2 !== 0) return;
      const start = new THREE.Vector3(...sample.position);
      const direction = new THREE.Vector3(...sample.direction).normalize();
      const tip = start.clone().addScaledVector(direction, 0.052);
      const normal = new THREE.Vector3();
      for (let local = 0; local < 3; local += 1) {
        normal.add(
          vertexVector(
            this.data.normals,
            this.data.indices[3 * sample.face + local]!,
          ),
        );
      }
      normal.normalize();
      const side = new THREE.Vector3()
        .crossVectors(direction, normal)
        .normalize();
      const back = tip.clone().addScaledVector(direction, -0.013);
      positions.push(...start.toArray(), ...tip.toArray());
      positions.push(
        ...tip.toArray(),
        ...back.clone().addScaledVector(side, 0.0055).toArray(),
      );
      positions.push(
        ...tip.toArray(),
        ...back.clone().addScaledVector(side, -0.0055).toArray(),
      );
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    return new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0xb5eee4,
        transparent: true,
        opacity: 0.7,
        depthTest: true,
        depthWrite: false,
      }),
    );
  }

  private buildRouteVisuals(): void {
    const source = vertexVector(this.data.positions, this.data.sourceVertex);
    for (const preset of this.metadata.routePresets) {
      const start = interpolateSurfaceStart(this.data, preset);
      const startNormal = interpolatedNormal(
        this.data,
        start.face,
        start.point,
      );
      const ambientLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([start.point, source]),
        new THREE.LineDashedMaterial({
          color: 0xd7a8ff,
          dashSize: 0.055,
          gapSize: 0.035,
          transparent: true,
          opacity: 0.9,
          depthTest: true,
          depthWrite: false,
        }),
      );
      ambientLine.computeLineDistances();

      const dijkstraPoints = [
        start.point.clone().addScaledVector(startNormal, 0.014),
      ];
      let current = preset.dijkstraStartVertex;
      for (let step = 0; step <= this.data.vertexCount; step += 1) {
        const point = vertexVector(this.data.positions, current);
        const normal = vertexVector(this.data.normals, current).normalize();
        dijkstraPoints.push(point.addScaledVector(normal, 0.014));
        if (current === this.data.sourceVertex) break;
        const next = this.data.dijkstraPredecessor[current]!;
        if (next === INVALID_INDEX || next === current)
          throw new Error(`Dijkstra route failed for ${preset.id}`);
        current = next;
      }
      const dijkstraLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(dijkstraPoints),
        new THREE.LineBasicMaterial({
          color: 0xe0b8ff,
          transparent: true,
          opacity: 1,
          depthTest: true,
          depthWrite: false,
        }),
      );

      const traced = traceSurfacePath(this.data, start);
      if (!traced.reachedSource)
        throw new Error(
          `Browser tracer failed for ${preset.id}: ${traced.termination}`,
        );
      const heatPath = makePathTube(
        liftedTracePoints(this.data, traced, 0.015),
        0.009,
        ROUTE_COLORS[preset.id],
      );
      this.routeVisuals.set(preset.id, {
        preset,
        start,
        startNormal,
        ambientLine,
        dijkstraLine,
        heatPath,
        traced,
      });
    }
  }

  private positionExplorer(): void {
    const visual = this.routeVisuals.get(this.selectedRouteId)!;
    placeOnSurface(
      this.explorer,
      visual.start.point,
      visual.startNormal,
      0.029,
    );
  }

  private poseFromDirection(
    target: THREE.Vector3,
    direction: THREE.Vector3,
    distance: number,
  ): OrbitPose {
    const normalized = direction.clone().normalize();
    return {
      target,
      azimuth: Math.atan2(normalized.x, normalized.z),
      elevation: Math.asin(THREE.MathUtils.clamp(normalized.y, -1, 1)),
      distance,
    };
  }

  private routePose(routeId: RoutePresetId): OrbitPose {
    const visual = this.routeVisuals.get(routeId)!;
    const midpoint = visual.start.point
      .clone()
      .add(this.sourcePoint)
      .multiplyScalar(0.5);
    const target = this.worldCenter.clone().lerp(midpoint, 0.16);
    const directions: Record<RoutePresetId, THREE.Vector3> = {
      "ridge-crossing": new THREE.Vector3(1.45, 0.34, 0.82),
      "inner-saddle-pass": new THREE.Vector3(-1.05, 0.34, 1.22),
      "basin-rim": new THREE.Vector3(-0.62, 0.68, 1.38),
    };
    const endpointSeparation = visual.start.point.distanceTo(this.sourcePoint);
    const mobile = window.matchMedia("(max-width: 760px)").matches;
    const distance = THREE.MathUtils.clamp(
      7.55 + 0.15 * endpointSeparation + (mobile ? 0.28 : 0),
      7.72,
      8.28,
    );
    return this.poseFromDirection(target, directions[routeId], distance);
  }

  private focusPose(point: THREE.Vector3, normal: THREE.Vector3): OrbitPose {
    const target = this.worldCenter.clone().lerp(point, 0.62);
    const direction = normal.clone().add(new THREE.Vector3(0, 0.18, 0));
    return this.poseFromDirection(target, direction, 3.45);
  }

  private comparisonPose(): OrbitPose {
    return this.poseFromDirection(
      this.worldCenter.clone(),
      new THREE.Vector3(0.88, 0.46, 1),
      window.matchMedia("(max-width: 760px)").matches ? 8.25 : 8.0,
    );
  }

  private chapterPose(act: number): OrbitPose {
    if (act === 4) {
      const pose = this.routePose(this.selectedRouteId);
      pose.target.lerp(this.sourcePoint, 0.18);
      return pose;
    }
    if (act === 6) {
      return this.poseFromDirection(
        this.worldCenter.clone(),
        new THREE.Vector3(-0.75, 0.54, 1),
        7.15,
      );
    }
    if (act === 7) return this.comparisonPose();
    if (act === 8) {
      return this.poseFromDirection(
        this.worldCenter.clone(),
        new THREE.Vector3(0.82, 0.62, -1),
        7.2,
      );
    }
    return this.routePose(this.selectedRouteId);
  }

  private requestStoryPose(act: number): void {
    if (this.controls.setPose(this.chapterPose(act), false)) {
      this.canvas.dataset.focusTarget = "chapter";
    }
  }

  private focusMarkerAt(clientX: number, clientY: number): boolean {
    const rectangle = this.canvas.getBoundingClientRect();
    if (rectangle.width <= 0 || rectangle.height <= 0) return false;
    this.pointer.set(
      ((clientX - rectangle.left) / rectangle.width) * 2 - 1,
      -((clientY - rectangle.top) / rectangle.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.raycaster.intersectObject(this.beacon, true).length > 0) {
      this.focusBeacon();
      return true;
    }
    if (this.raycaster.intersectObject(this.explorer, true).length > 0) {
      this.focusRouteStart();
      return true;
    }
    return false;
  }

  private applyVisualState(): void {
    for (const [id, visual] of this.routeVisuals) {
      visual.ambientLine.removeFromParent();
      visual.dijkstraLine.removeFromParent();
      visual.heatPath.removeFromParent();
      const heatMaterial = visual.heatPath.material as THREE.MeshBasicMaterial;
      heatMaterial.opacity = id === this.selectedRouteId ? 1 : 0.86;
      heatMaterial.depthTest = true;
      visual.heatPath.renderOrder = 0;
    }
    if (this.comparisonVisible) {
      for (const visual of this.routeVisuals.values()) {
        const heatMaterial = visual.heatPath
          .material as THREE.MeshBasicMaterial;
        heatMaterial.depthTest = false;
        heatMaterial.opacity = 0.9;
        visual.heatPath.renderOrder = 3;
        this.world.add(visual.heatPath);
      }
      return;
    }
    const active = this.routeVisuals.get(this.selectedRouteId)!;
    if (this.activeAct === 1) this.world.add(active.ambientLine);
    if (this.activeAct === 2) {
      active.dijkstraLine.geometry.setDrawRange(0, 1);
      this.world.add(active.dijkstraLine);
    }
    if (this.activeAct >= 3 && this.activeAct !== 4)
      this.world.add(active.heatPath);
    if (this.activeAct === 4 && this.heatStarted)
      this.world.add(active.heatPath);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      if (this.animationFrame !== 0) cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
      return;
    }
    if (!this.disposed && this.animationFrame === 0) {
      this.lastFrameTime = performance.now();
      this.animationFrame = requestAnimationFrame(this.render);
    }
  };

  private readonly render = (time: number): void => {
    if (this.disposed || document.hidden) {
      this.animationFrame = 0;
      return;
    }
    const deltaSeconds = Math.min(
      Math.max((time - this.lastFrameTime) / 1000, 0),
      0.1,
    );
    this.lastFrameTime = time;
    this.controls.update(deltaSeconds, time);
    if (!this.reducedMotion) {
      const beaconAmplitude =
        this.activeAct === 4 && this.heatStarted ? 0.065 : 0.018;
      this.beacon.scale.setScalar(
        1 + beaconAmplitude * Math.sin(time * 0.0042),
      );
      this.explorer.scale.setScalar(1 + 0.018 * Math.sin(time * 0.0032 + 1));
    }
    const selected = this.routeVisuals.get(this.selectedRouteId)!;
    if (this.activeAct === 2 && selected.dijkstraLine.parent) {
      const count =
        selected.dijkstraLine.geometry.getAttribute("position").count;
      const progress = this.reducedMotion
        ? 1
        : Math.min(1, (time - this.actStartTime) / 1700);
      selected.dijkstraLine.geometry.setDrawRange(
        0,
        Math.max(2, Math.floor(count * progress)),
      );
    }
    if (this.activeAct === 4 && this.heatStarted) {
      const duration = this.reducedMotion ? 1 : 4200;
      const progress = Math.min(1, (time - this.heatStartTime) / duration);
      this.applyHeat(progress);
    }
    if (this.routeReplayStart > 0 && selected.heatPath.parent) {
      const progress = this.reducedMotion
        ? 1
        : Math.min(1, (time - this.routeReplayStart) / 1200);
      (selected.heatPath.material as THREE.MeshBasicMaterial).opacity =
        0.2 + 0.8 * progress;
      if (progress >= 1) this.routeReplayStart = 0;
    }
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.render);
  };
}
