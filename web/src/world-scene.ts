import * as THREE from "three";
import { OrbitController, type OrbitPose } from "./orbit-controller";
import {
  barycentric,
  traceSurfacePath,
  type SurfaceStart,
} from "./path-tracer";
import {
  heatFrameInterpolation,
  type RoutePreset,
  type RoutePresetId,
  type WorldData,
  type WorldMetadata,
} from "./world-data";

const INVALID_INDEX = 0xffffffff;
const HEAT_PATH_COLORS = [0x39ff88, 0x8bffad, 0x1fd66e] as const;
const FINAL_HEAT_EXPOSURE = 0.84;
const HEAT_ANIMATION_DURATION_MILLISECONDS = 5200;
const GRADIENT_FLOW_PERIOD_MILLISECONDS = 1050;
let activeSceneCount = 0;
let sceneGeneration = 0;

function actCaptions(genus: number, heatFrameCount: number): readonly string[] {
  return [
    `An explorer and amber beacon stand on a closed Genus ${genus} world generated and solved by C++.`,
    "The tempting ambient chord crosses empty space, so the explorer cannot walk it.",
    "The interior start first joins its nearest vertex; Dijkstra then follows the mesh edges.",
    "Choose one of three native explorer starts, all aimed at the same beacon.",
    `${heatFrameCount} native diffusion states spread only over the valid surface from the amber beacon.`,
    "Warmth reveals facewise direction before Poisson reconstructs distance.",
    "Contours show level sets of one Heat Method distance field.",
    "A restrained transparent overlay keeps all three validated Heat paths readable.",
    "C++20 and Eigen export geometry, fields from sparse solves, and measured routes.",
    "The explorer can follow the native approximate path without leaving the surface.",
  ];
}

interface SceneOptions {
  reducedMotion: boolean;
  onRouteSelected?: (preset: RoutePreset) => void;
  onExploreChange?: (engaged: boolean) => void;
  onCaptionChange?: (caption: string) => void;
  onHeatStateChange?: (state: "idle" | "animation" | "released") => void;
  onHeatFrameChange?: (frame: number, frameCount: number) => void;
}

type RouteVisual = {
  preset: RoutePreset;
  start: SurfaceStart;
  startNormal: THREE.Vector3;
  ambientLine: THREE.Line;
  dijkstraLine: THREE.Line;
  heatPath: THREE.Mesh;
};

type GradientFlowSample = {
  start: THREE.Vector3;
  direction: THREE.Vector3;
  phase: number;
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
      vertexVector(data, data.indices[3 * preset.start.face + local]!),
      preset.start.barycentric[local]!,
    );
  }
  return { face: preset.start.face, point };
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

function liftedNativePathPoints(
  data: WorldData,
  preset: RoutePreset,
  offset: number,
): THREE.Vector3[] {
  const result: THREE.Vector3[] = [];
  for (let index = 0; index < preset.nativePathCount; index += 1) {
    const point = new THREE.Vector3().fromArray(
      data.nativeRoutePoints,
      3 * (preset.nativePathOffset + index),
    );
    result.push(
      point.addScaledVector(nearestVertexNormal(data, point), offset),
    );
  }
  return result;
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
  private readonly onHeatStateChange?: SceneOptions["onHeatStateChange"];
  private readonly onHeatFrameChange?: SceneOptions["onHeatFrameChange"];
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
  private readonly heatGlow: THREE.Mesh;
  private readonly wireframe: THREE.Mesh;
  private readonly beacon: THREE.Group;
  private readonly beaconLight: THREE.PointLight;
  private readonly explorer: THREE.Group;
  private readonly gradientLines: THREE.LineSegments;
  private readonly gradientFlow: THREE.Points;
  private readonly gradientFlowSamples: readonly GradientFlowSample[];
  private readonly routeVisuals = new Map<RoutePresetId, RouteVisual>();
  private readonly resizeObserver: ResizeObserver;
  private readonly worldCenter = new THREE.Vector3();
  private readonly worldRadius: number;
  private readonly sourcePoint: THREE.Vector3;
  private readonly sourceNormal: THREE.Vector3;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly controls: OrbitController;
  private readonly palette = new Float32Array(256 * 3);
  private selectedRouteId: RoutePresetId;
  private routeChosen = false;
  private comparisonVisible = false;
  private activeAct = 0;
  private heatEnabled = false;
  private heatStartTime = 0;
  private lastHeatFrame = -1;
  private routeReplayStart = 0;
  private routeReplayRevision = 0;
  private actStartTime = performance.now();
  private animationFrame = 0;
  private lastFrameTime = performance.now();
  private disposed = false;
  private lifecycleRegistered = false;

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
    this.onHeatStateChange = options.onHeatStateChange;
    this.onHeatFrameChange = options.onHeatFrameChange;
    const firstRoute = metadata.routePresets[0];
    if (!firstRoute) throw new Error("World metadata has no route presets");
    this.selectedRouteId = firstRoute.id;
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
    this.worldRadius =
      this.geometry.boundingSphere?.radius ?? metadata.bounds.radius;
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
    this.heatGlow = new THREE.Mesh(
      this.geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.heatGlow.name = "native-heat-glow";
    this.heatGlow.scale.setScalar(1.0024);
    this.heatGlow.renderOrder = 1;
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
    this.world.add(this.mesh, this.heatGlow, this.wireframe);

    this.sourcePoint = vertexVector(data, data.sourceVertex);
    this.sourceNormal = vertexVector(
      data.normals,
      data.sourceVertex,
    ).normalize();
    this.beacon = makeMarker(0xffc66d, 0.034);
    placeOnSurface(this.beacon, this.sourcePoint, this.sourceNormal, 0.045);
    this.beaconLight = new THREE.PointLight(0xffb454, 2.15, 1.05, 1.8);
    this.beaconLight.position.set(0, 0.05, 0);
    this.beacon.add(this.beaconLight);
    this.world.add(this.beacon);

    this.explorer = makeMarker(0xf5f7f6, 0.022);
    this.world.add(this.explorer);

    const gradientVisuals = this.createGradientVisuals();
    this.gradientLines = gradientVisuals.lines;
    this.gradientFlow = gradientVisuals.flow;
    this.gradientFlowSamples = gradientVisuals.samples;
    this.gradientLines.visible = false;
    this.gradientFlow.visible = false;
    this.world.add(this.gradientLines, this.gradientFlow);
    this.buildPalette();
    this.buildRouteVisuals();

    this.scene.add(this.world);
    this.scene.add(new THREE.HemisphereLight(0xdce5e2, 0x141817, 1.65));
    const key = new THREE.DirectionalLight(0xf4eee5, 1.9);
    key.position.set(3.5, 3.2, 4.8);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xaab7b4, 0.28);
    rim.position.set(-3.2, 1.2, -2.5);
    this.scene.add(rim);
    const innerFill = new THREE.PointLight(0x879995, 0.62, 5.5, 1.2);
    innerFill.position.set(0, 0.25, 0.35);
    this.scene.add(innerFill);

    this.canvas.dataset.act = "0";
    this.canvas.dataset.activeRoute = "";
    this.canvas.dataset.routeSelected = "false";
    this.canvas.dataset.routeLocked = "false";
    this.canvas.dataset.comparison = "false";
    this.canvas.dataset.heatMode = "idle";
    this.canvas.dataset.routeReplay = "0";
    this.canvas.dataset.worldKind = metadata.mesh.kind;
    this.canvas.dataset.topology = `genus-${metadata.topology.genus}`;
    this.canvas.dataset.vertexCount = String(data.vertexCount);
    this.canvas.dataset.faceCount = String(data.faceCount);
    this.canvas.dataset.heatFrameCount = String(data.heatFrameCount);
    this.canvas.dataset.heatDisplayNative = "true";
    this.canvas.dataset.gradientFlow = "hidden";
    this.canvas.dataset.eulerCharacteristic = String(
      metadata.topology.eulerCharacteristic,
    );
    this.canvas.dataset.nativeRoutes = "true";
    this.canvas.dataset.atmosphere = "false";
    this.canvas.dataset.ambientColor = "#ff3030";
    this.canvas.dataset.heatPathColor = "#39ff88";
    this.canvas.dataset.dijkstraColor = "#f1f1f1";
    this.canvas.dataset.beaconClickable = "true";
    this.canvas.dataset.routeStartClickable = "true";
    this.positionExplorer();
    this.applyVisualState();

    this.controls = new OrbitController(
      this.camera,
      this.canvas,
      this.openingPose(),
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
    activeSceneCount += 1;
    this.lifecycleRegistered = true;
    this.canvas.dataset.activeScenes = String(activeSceneCount);
    this.canvas.dataset.sceneGeneration = String(++sceneGeneration);
    if (!document.hidden)
      this.animationFrame = requestAnimationFrame(this.render);
  }

  get caption(): string {
    const captions = actCaptions(
      this.metadata.topology.genus,
      this.data.heatFrameCount,
    );
    if (this.comparisonVisible) return captions[7]!;
    if (this.activeAct === 3 && this.routeChosen) {
      return `${this.selectedPreset.label} is selected. Its exported Heat Method path now connects this start to the beacon.`;
    }
    return captions[this.activeAct] ?? captions[0]!;
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
    this.canvas.dataset.focusTarget = "chapter";
    this.controls.setPose(this.chapterPose(this.activeAct), true);
    this.onCaptionChange?.("The current mathematical view is framed again.");
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

  clearRouteSelection(): void {
    this.routeChosen = false;
    this.comparisonVisible = false;
    this.canvas.dataset.activeRoute = "";
    this.canvas.dataset.routeSelected = "false";
    this.canvas.dataset.routeLocked = "false";
    this.canvas.dataset.comparison = "false";
    this.applyVisualState();
  }

  selectRoute(routeId: RoutePresetId, notify = true): void {
    const visual = this.routeVisuals.get(routeId);
    if (!visual) throw new Error(`Unknown route preset: ${routeId}`);
    this.selectedRouteId = routeId;
    this.routeChosen = true;
    this.comparisonVisible = false;
    this.canvas.dataset.activeRoute = routeId;
    this.canvas.dataset.routeSelected = "true";
    this.canvas.dataset.comparison = "false";
    this.positionExplorer();
    this.canvas.dataset.focusTarget = "route";
    this.controls.setPose(this.routePose(routeId), true);
    this.applyVisualState();
    if (notify) this.onRouteSelected?.(visual.preset);
  }

  setRouteLocked(locked: boolean): void {
    this.canvas.dataset.routeLocked = String(locked);
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
    this.controls.setExplore(false);
    this.setHeatEnabled(false);
    this.activeAct = 0;
    this.canvas.dataset.act = "0";
    this.applyColors(this.baseColors);
    this.selectedRouteId = this.metadata.routePresets[0]!.id;
    this.positionExplorer();
    this.clearRouteSelection();
    this.resetView();
  }

  setAct(act: number): void {
    const next = Math.max(0, Math.min(9, act));
    if (next === this.activeAct) return;
    this.activeAct = next;
    this.canvas.dataset.act = String(next);
    this.actStartTime = performance.now();
    const wireMaterial = this.wireframe.material as THREE.MeshBasicMaterial;
    wireMaterial.opacity = next === 2 ? 0.22 : next === 8 ? 0.16 : 0;
    this.wireframe.visible = wireMaterial.opacity > 0;
    this.gradientLines.visible = next === 5;
    this.gradientFlow.visible = next === 5;
    this.canvas.dataset.gradientFlow =
      next === 5 ? (this.reducedMotion ? "static" : "animated") : "hidden";
    if (next !== 5) delete this.canvas.dataset.gradientFlowPhase;
    if (next === 4 && this.heatEnabled) {
      const progress =
        this.canvas.dataset.heatMode === "released"
          ? 1
          : Math.min(
              1,
              (performance.now() - this.heatStartTime) /
                HEAT_ANIMATION_DURATION_MILLISECONDS,
            );
      this.applyHeat(progress);
    } else {
      this.applyNonHeatColors();
    }
    this.requestStoryPose(next);
    this.applyVisualState();
  }

  setHeatEnabled(enabled: boolean): void {
    this.heatEnabled = enabled;
    if (!enabled) {
      this.canvas.dataset.heatMode = "idle";
      delete this.canvas.dataset.heatProgress;
      delete this.canvas.dataset.heatFrame;
      delete this.canvas.dataset.heatExposure;
      this.lastHeatFrame = -1;
      this.applyNonHeatColors();
      this.onHeatStateChange?.("idle");
      return;
    }
    this.heatStartTime = performance.now();
    this.activeAct = 4;
    this.canvas.dataset.act = "4";
    this.hideRouteComparison();
    this.canvas.dataset.heatMode = "animation";
    this.canvas.dataset.heatProgress = "0";
    this.applyHeat(0);
    this.onHeatStateChange?.("animation");
    this.applyVisualState();
  }

  releaseHeat(): boolean {
    if (this.heatEnabled) return false;
    this.setHeatEnabled(true);
    return true;
  }

  restoreHeatCompletion(): void {
    this.heatEnabled = true;
    this.applyHeat(1, this.activeAct === 4);
    this.canvas.dataset.heatMode = "released";
    if (this.activeAct !== 4) this.applyNonHeatColors();
    this.applyVisualState();
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
    this.gradientFlow.geometry.dispose();
    (this.gradientFlow.material as THREE.Material).dispose();
    disposeObject(this.beacon);
    disposeObject(this.explorer);
    this.geometry.dispose();
    this.material.dispose();
    (this.heatGlow.material as THREE.Material).dispose();
    (this.wireframe.material as THREE.Material).dispose();
    this.renderer.dispose();
    if (this.lifecycleRegistered) {
      activeSceneCount -= 1;
      this.lifecycleRegistered = false;
      this.canvas.dataset.activeScenes = String(activeSceneCount);
    }
  }

  private applyNonHeatColors(): void {
    (this.heatGlow.material as THREE.MeshBasicMaterial).opacity = 0;
    this.beaconLight.intensity = 2.15;
    if ([5, 7, 9].includes(this.activeAct)) {
      this.applyColors(this.distanceColors);
    } else if (this.activeAct === 6) {
      this.applyColors(this.contourColors);
    } else {
      this.applyColors(this.baseColors);
    }
  }

  private buildBaseColors(): Float32Array {
    const result = new Float32Array(this.data.vertexCount * 3);
    const low = new THREE.Color(0x10282b);
    const high = new THREE.Color(0x74817d);
    for (let vertex = 0; vertex < this.data.vertexCount; vertex += 1) {
      const x = this.data.positions[3 * vertex]! - this.worldCenter.x;
      const z = this.data.positions[3 * vertex + 2]! - this.worldCenter.z;
      const normalZ = this.data.normals[3 * vertex + 2]!;
      const mix = THREE.MathUtils.clamp(
        0.43 +
          0.24 * (z / Math.max(this.worldRadius, 1e-9)) +
          0.16 * normalZ +
          0.06 * Math.sin((3.1 * x) / Math.max(this.worldRadius, 1e-9)),
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
    const cold = new THREE.Color(0x082126);
    const copper = new THREE.Color(0xb85f3a);
    const gold = new THREE.Color(0xf2b960);
    const hot = new THREE.Color(0xfff0cf);
    for (let index = 0; index < 256; index += 1) {
      const value = index / 255;
      let color: THREE.Color;
      if (value < 0.58) {
        const mix = THREE.MathUtils.smoothstep(value / 0.58, 0, 1);
        color = cold.clone().lerp(copper, mix);
      } else if (value < 0.88) {
        const mix = THREE.MathUtils.smoothstep((value - 0.58) / 0.3, 0, 1);
        color = copper.clone().lerp(gold, mix);
      } else {
        const mix = THREE.MathUtils.smoothstep((value - 0.88) / 0.12, 0, 1);
        color = gold.clone().lerp(hot, mix);
      }
      this.palette.set([color.r, color.g, color.b], 3 * index);
    }
  }

  private applyColors(source: Float32Array): void {
    this.colors.set(source);
    this.colorAttribute.needsUpdate = true;
  }

  private applyHeat(progress: number, visible = true): void {
    const { first, second, mix, visibleFrame } = heatFrameInterpolation(
      this.data.heatFrameCount,
      progress,
    );
    this.canvas.dataset.heatFrame = String(visibleFrame + 1);
    if (visibleFrame !== this.lastHeatFrame) {
      this.lastHeatFrame = visibleFrame;
      this.onHeatFrameChange?.(visibleFrame + 1, this.data.heatFrameCount);
    }
    const a = this.data.heatFrames[first]!;
    const b = this.data.heatFrames[second]!;
    const heatExposure = THREE.MathUtils.lerp(
      1,
      FINAL_HEAT_EXPOSURE,
      THREE.MathUtils.smoothstep(progress, 0.58, 1),
    );
    if (visible) {
      for (let vertex = 0; vertex < this.data.vertexCount; vertex += 1) {
        const normalized =
          (THREE.MathUtils.lerp(a[vertex]!, b[vertex]!, mix) / 65535) *
          heatExposure;
        const paletteIndex = Math.min(
          255,
          Math.max(0, Math.round(normalized * 255)),
        );
        this.colors[3 * vertex] = this.palette[3 * paletteIndex]!;
        this.colors[3 * vertex + 1] = this.palette[3 * paletteIndex + 1]!;
        this.colors[3 * vertex + 2] = this.palette[3 * paletteIndex + 2]!;
      }
      this.colorAttribute.needsUpdate = true;
      (this.heatGlow.material as THREE.MeshBasicMaterial).opacity =
        0.03 + 0.025 * THREE.MathUtils.smoothstep(progress, 0, 1);
      this.beaconLight.intensity =
        2.35 + 0.38 * Math.sin(Math.min(progress, 1) * Math.PI);
    }
    this.canvas.dataset.heatProgress = THREE.MathUtils.clamp(
      progress,
      0,
      1,
    ).toFixed(3);
    this.canvas.dataset.heatExposure = heatExposure.toFixed(3);
  }

  private createGradientVisuals(): {
    lines: THREE.LineSegments;
    flow: THREE.Points;
    samples: readonly GradientFlowSample[];
  } {
    const positions: number[] = [];
    const samples: GradientFlowSample[] = [];
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
      samples.push({
        start: start.clone().addScaledVector(normal, 0.006),
        direction: direction.clone(),
        phase: (sampleIndex * 0.38196601125) % 1,
      });
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
    const lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0xb5eee4,
        transparent: true,
        opacity: 0.7,
        depthTest: true,
        depthWrite: false,
      }),
    );
    const flowPositions = new Float32Array(samples.length * 3);
    const flowAttribute = new THREE.BufferAttribute(flowPositions, 3);
    flowAttribute.setUsage(THREE.DynamicDrawUsage);
    const flowGeometry = new THREE.BufferGeometry();
    flowGeometry.setAttribute("position", flowAttribute);
    const flow = new THREE.Points(
      flowGeometry,
      new THREE.PointsMaterial({
        color: 0xe8fff9,
        size: 0.018,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.82,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    flow.name = "gradient-direction-flow";
    this.updateGradientFlowPositions(flow, samples, 0);
    return { lines, flow, samples };
  }

  private updateGradientFlowPositions(
    flow: THREE.Points,
    samples: readonly GradientFlowSample[],
    elapsedCycles: number,
  ): void {
    const positions = flow.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    samples.forEach((sample, index) => {
      const phase = (sample.phase + elapsedCycles) % 1;
      const offset = 0.006 + phase * 0.044;
      positions.setXYZ(
        index,
        sample.start.x + sample.direction.x * offset,
        sample.start.y + sample.direction.y * offset,
        sample.start.z + sample.direction.z * offset,
      );
    });
    positions.needsUpdate = true;
  }

  private buildRouteVisuals(): void {
    const source = vertexVector(this.data.positions, this.data.sourceVertex);
    this.metadata.routePresets.forEach((preset, routeIndex) => {
      const start = interpolateSurfaceStart(this.data, preset);
      const startNormal = interpolatedNormal(
        this.data,
        start.face,
        start.point,
      );
      const ambientLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([start.point, source]),
        new THREE.LineDashedMaterial({
          color: 0xff3030,
          dashSize: 0.055,
          gapSize: 0.035,
          transparent: true,
          opacity: 1,
          toneMapped: false,
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
          color: 0xf1f1f1,
          transparent: true,
          opacity: 1,
          toneMapped: false,
          depthTest: true,
          depthWrite: false,
        }),
      );

      const browserTrace = traceSurfacePath(this.data, start);
      if (!browserTrace.reachedSource)
        throw new Error(
          `Browser tracer failed for ${preset.id}: ${browserTrace.termination}`,
        );
      const heatPath = makePathTube(
        liftedNativePathPoints(this.data, preset, 0.015),
        0.011,
        HEAT_PATH_COLORS[routeIndex] ?? HEAT_PATH_COLORS[0],
      );
      heatPath.name = `native-heat-path-${preset.id}`;
      this.routeVisuals.set(preset.id, {
        preset,
        start,
        startNormal,
        ambientLine,
        dijkstraLine,
        heatPath,
      });
    });
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
    const routeIndex = Math.max(
      0,
      this.metadata.routePresets.findIndex((preset) => preset.id === routeId),
    );
    const directions = [
      new THREE.Vector3(0.16, 0.34, 1),
      new THREE.Vector3(-0.18, 0.3, 1),
      new THREE.Vector3(0.08, 0.43, 1),
    ];
    const endpointSeparation = visual.start.point.distanceTo(this.sourcePoint);
    const distance =
      this.fitDistance(1.14) +
      0.04 * Math.min(endpointSeparation, this.worldRadius);
    return this.poseFromDirection(target, directions[routeIndex]!, distance);
  }

  private focusPose(point: THREE.Vector3, normal: THREE.Vector3): OrbitPose {
    const target = this.worldCenter.clone().lerp(point, 0.62);
    const direction = normal.clone().add(new THREE.Vector3(0, 0.18, 0));
    return this.poseFromDirection(
      target,
      direction,
      Math.max(2.4, 1.55 * this.worldRadius),
    );
  }

  private comparisonPose(): OrbitPose {
    return this.poseFromDirection(
      this.worldCenter.clone(),
      new THREE.Vector3(0.1, 0.38, 1),
      this.fitDistance(1.18),
    );
  }

  private openingPose(): OrbitPose {
    const target = this.worldCenter
      .clone()
      .add(new THREE.Vector3(0, this.worldRadius * 0.16, 0));
    const genus = this.metadata.topology.genus;
    const direction =
      genus === 3
        ? new THREE.Vector3(0.08, 0.34, 1)
        : new THREE.Vector3(0.12, 0.31, 1);
    return this.poseFromDirection(target, direction, this.fitDistance(1.28));
  }

  private fitDistance(margin: number): number {
    const aspect =
      this.canvas.clientWidth > 0 && this.canvas.clientHeight > 0
        ? this.canvas.clientWidth / this.canvas.clientHeight
        : 1;
    const vertical = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
    const limiting = Math.min(vertical, horizontal);
    return (this.worldRadius * margin) / Math.max(Math.sin(limiting / 2), 0.12);
  }

  private chapterPose(act: number): OrbitPose {
    if (act === 0) return this.openingPose();
    if (act === 4) {
      const pose = this.routePose(this.selectedRouteId);
      pose.target.lerp(this.sourcePoint, 0.18);
      return pose;
    }
    if (act === 6) {
      return this.poseFromDirection(
        this.worldCenter.clone(),
        new THREE.Vector3(-0.12, 0.46, 1),
        this.fitDistance(1.1),
      );
    }
    if (act === 7) return this.comparisonPose();
    if (act === 8) {
      return this.poseFromDirection(
        this.worldCenter.clone(),
        new THREE.Vector3(0.18, 0.52, -1),
        this.fitDistance(1.12),
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
    this.explorer.visible = this.routeChosen;
    this.canvas.dataset.visibleHeatPaths = "0";
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
      this.canvas.dataset.visibleHeatPaths = String(this.routeVisuals.size);
      return;
    }
    const active = this.routeVisuals.get(this.selectedRouteId)!;
    if (this.activeAct === 1) {
      this.world.add(active.ambientLine);
      this.world.add(active.heatPath);
    }
    if (this.activeAct === 2) {
      active.dijkstraLine.geometry.setDrawRange(0, 1);
      this.world.add(active.dijkstraLine);
    }
    if (this.routeChosen && this.activeAct >= 3 && this.activeAct !== 4)
      this.world.add(active.heatPath);
    if (this.routeChosen && this.activeAct === 4 && this.heatEnabled)
      this.world.add(active.heatPath);
    if (active.heatPath.parent) this.canvas.dataset.visibleHeatPaths = "1";
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
        this.activeAct === 4 && this.heatEnabled ? 0.065 : 0.018;
      this.beacon.scale.setScalar(
        1 + beaconAmplitude * Math.sin(time * 0.0042),
      );
      this.explorer.scale.setScalar(1 + 0.018 * Math.sin(time * 0.0032 + 1));
    }
    if (this.activeAct === 5) {
      const rawCycles =
        (time - this.actStartTime) / GRADIENT_FLOW_PERIOD_MILLISECONDS;
      const elapsedCycles = this.reducedMotion
        ? 0.68
        : Math.min(rawCycles, 4.15);
      this.updateGradientFlowPositions(
        this.gradientFlow,
        this.gradientFlowSamples,
        elapsedCycles,
      );
      if (!this.reducedMotion && rawCycles >= 4.15) {
        this.canvas.dataset.gradientFlow = "settled";
      }
      this.canvas.dataset.gradientFlowPhase = (elapsedCycles % 1).toFixed(3);
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
    if (this.heatEnabled && this.canvas.dataset.heatMode === "animation") {
      const duration = this.reducedMotion
        ? 1
        : HEAT_ANIMATION_DURATION_MILLISECONDS;
      const progress = Math.min(1, (time - this.heatStartTime) / duration);
      this.applyHeat(progress, this.activeAct === 4);
      if (progress >= 1) {
        this.canvas.dataset.heatMode = "released";
        this.onHeatStateChange?.("released");
      }
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
