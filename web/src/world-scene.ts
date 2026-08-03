import * as THREE from "three";
import { traceSurfacePath, type SurfaceStart } from "./path-tracer";
import type { WorldData } from "./world-data";

const INVALID_INDEX = 0xffffffff;

interface SceneOptions {
  reducedMotion: boolean;
  onExplorerPlaced?: () => void;
}

const CAPTIONS = [
  "Click the world once to place the explorer.",
  "The violet chord is shorter—and impossible to walk.",
  "The pale route is Dijkstra constrained to mesh edges.",
  "Every color is interpolated from a C++ heat solve on this mesh.",
  "Sampled face gradients reveal direction; the amber route follows distance downhill.",
  "Contours are level sets of the reconstructed distance field.",
  "20,480 faces here; the same sparse architecture scales to far denser meshes.",
  "The route home, recovered from heat.",
] as const;

function colorTriplet(color: THREE.Color): [number, number, number] {
  return [color.r, color.g, color.b];
}

function vertexVector(array: Float32Array, index: number): THREE.Vector3 {
  return new THREE.Vector3().fromArray(array, 3 * index);
}

function makeMarker(color: number, radius: number): THREE.Group {
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 18, 12),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 2.2,
      roughness: 0.32,
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

function pathTube(
  points: THREE.Vector3[],
  radius: number,
  color: number,
): THREE.Mesh | null {
  if (points.length < 2) return null;
  const lifted = points.map((point) =>
    point.clone().addScaledVector(point.clone().normalize(), 0.012),
  );
  const curve = new THREE.CurvePath<THREE.Vector3>();
  for (let index = 0; index + 1 < lifted.length; index += 1) {
    curve.add(new THREE.LineCurve3(lifted[index]!, lifted[index + 1]!));
  }
  const segments = Math.max(80, Math.min(900, lifted.length * 4));
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, segments, radius, 5, false),
    new THREE.MeshBasicMaterial({ color, toneMapped: false }),
  );
}

export class WorldScene {
  private readonly data: WorldData;
  private readonly canvas: HTMLCanvasElement;
  private readonly reducedMotion: boolean;
  private readonly onExplorerPlaced?: () => void;
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
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly resizeObserver: ResizeObserver;
  private readonly cameraTarget = new THREE.Vector3(0.25, 0.08, 3.45);
  private ambientLine: THREE.Line | null = null;
  private dijkstraLine: THREE.Line | null = null;
  private geodesicPath: THREE.Mesh | null = null;
  private explorerStart: SurfaceStart | null = null;
  private explorerWasPlaced = false;
  private activeAct = 0;
  private heatStarted = false;
  private heatStartTime = 0;
  private actStartTime = performance.now();
  private animationFrame = 0;
  private disposed = false;
  private readonly palette = new Float32Array(256 * 3);

  constructor(
    canvas: HTMLCanvasElement,
    data: WorldData,
    options: SceneOptions,
  ) {
    this.canvas = canvas;
    this.data = data;
    this.reducedMotion = options.reducedMotion;
    this.onExplorerPlaced = options.onExplorerPlaced;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.scene.fog = new THREE.FogExp2(0x071216, 0.075);

    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(data.positions, 3),
    );
    this.geometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(data.normals, 3),
    );
    this.geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    this.baseColors = this.buildBaseColors();
    this.distanceColors = this.buildDistanceColors(false);
    this.contourColors = this.buildDistanceColors(true);
    this.colors = this.baseColors.slice();
    this.colorAttribute = new THREE.BufferAttribute(this.colors, 3);
    this.geometry.setAttribute("color", this.colorAttribute);
    this.geometry.computeBoundingSphere();

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.76,
      metalness: 0.02,
      transparent: true,
      opacity: 1,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "computed-curved-world";
    this.wireframe = new THREE.Mesh(
      this.geometry,
      new THREE.MeshBasicMaterial({
        color: 0x9bd0c5,
        wireframe: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.wireframe.scale.setScalar(1.0015);
    this.atmosphere = new THREE.Mesh(
      this.geometry,
      new THREE.MeshBasicMaterial({
        color: 0x65c8b6,
        side: THREE.BackSide,
        transparent: true,
        opacity: 0.055,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.atmosphere.scale.setScalar(1.075);
    this.world.add(this.mesh, this.wireframe, this.atmosphere);

    const sourcePoint = vertexVector(data.positions, data.sourceVertex);
    const sourceNormal = vertexVector(
      data.normals,
      data.sourceVertex,
    ).normalize();
    this.beacon = makeMarker(0xffc66d, 0.027);
    placeOnSurface(this.beacon, sourcePoint, sourceNormal, 0.035);
    const beaconLight = new THREE.PointLight(0xffb454, 1.8, 0.75, 1.8);
    beaconLight.position.set(0, 0.04, 0);
    this.beacon.add(beaconLight);
    this.world.add(this.beacon);

    this.explorer = makeMarker(0x78d5c6, 0.022);
    this.explorer.visible = false;
    this.world.add(this.explorer);

    this.gradientLines = this.createGradientLines();
    this.gradientLines.visible = false;
    this.world.add(this.gradientLines);

    this.world.rotation.y = -1.23;
    this.world.rotation.x = -0.08;
    this.scene.add(this.world);
    this.scene.add(new THREE.HemisphereLight(0xccebe4, 0x081114, 1.45));
    const key = new THREE.DirectionalLight(0xffead0, 2.2);
    key.position.set(3.5, 3, 4.5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x5ed7c2, 1.15);
    rim.position.set(-3, 0.2, -2);
    this.scene.add(rim);

    this.camera.position.set(0.25, 0.08, 4.75);
    this.camera.lookAt(0, 0, 0);
    this.buildPalette();
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("keydown", this.handleKeyDown);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.resize();
    this.animationFrame = requestAnimationFrame(this.render);
  }

  get caption(): string {
    return CAPTIONS[this.activeAct] ?? CAPTIONS[0];
  }

  setAct(act: number): void {
    const next = Math.max(0, Math.min(7, act));
    if (next === this.activeAct) return;
    this.activeAct = next;
    this.actStartTime = performance.now();
    if (next >= 1 && !this.explorerWasPlaced) this.placeDefaultExplorer();
    this.ambientLine?.removeFromParent();
    if (next === 1 && this.ambientLine) this.world.add(this.ambientLine);
    if (next === 2 && this.dijkstraLine) {
      this.dijkstraLine.geometry.setDrawRange(0, 1);
      this.world.add(this.dijkstraLine);
    } else {
      this.dijkstraLine?.removeFromParent();
    }
    this.gradientLines.visible = next === 4;
    if (this.geodesicPath) this.geodesicPath.visible = next >= 4;
    const wireMaterial = this.wireframe.material as THREE.MeshBasicMaterial;
    wireMaterial.opacity =
      next === 2 ? 0.42 : next === 6 ? 0.22 : next === 3 ? 0.06 : 0;
    this.wireframe.visible = wireMaterial.opacity > 0;
    if (next === 0 || next === 1 || next === 2 || next === 6)
      this.applyColors(this.baseColors);
    if (next === 4 || next === 7) this.applyColors(this.distanceColors);
    if (next === 5) this.applyColors(this.contourColors);
    this.cameraTarget.copy(this.cameraForAct(next));
  }

  releaseHeat(): void {
    this.heatStarted = true;
    this.heatStartTime = performance.now();
    this.activeAct = 3;
    this.cameraTarget.copy(this.cameraForAct(3));
  }

  replay(): void {
    this.heatStarted = false;
    this.activeAct = 0;
    this.actStartTime = performance.now();
    this.applyColors(this.baseColors);
    this.gradientLines.visible = false;
    if (this.geodesicPath) this.geodesicPath.visible = false;
    this.camera.position.set(0.25, 0.08, 4.75);
    this.cameraTarget.copy(this.cameraForAct(0));
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("keydown", this.handleKeyDown);
    this.geometry.dispose();
    this.material.dispose();
    (this.wireframe.material as THREE.Material).dispose();
    (this.atmosphere.material as THREE.Material).dispose();
    this.gradientLines.geometry.dispose();
    (this.gradientLines.material as THREE.Material).dispose();
    this.ambientLine?.geometry.dispose();
    (this.ambientLine?.material as THREE.Material | undefined)?.dispose();
    this.dijkstraLine?.geometry.dispose();
    (this.dijkstraLine?.material as THREE.Material | undefined)?.dispose();
    this.geodesicPath?.geometry.dispose();
    (this.geodesicPath?.material as THREE.Material | undefined)?.dispose();
    this.renderer.dispose();
  }

  private buildBaseColors(): Float32Array {
    const result = new Float32Array(this.data.vertexCount * 3);
    const low = new THREE.Color(0x153438);
    const high = new THREE.Color(0x6d7964);
    for (let vertex = 0; vertex < this.data.vertexCount; vertex += 1) {
      const point = vertexVector(this.data.positions, vertex);
      const normalY = this.data.normals[3 * vertex + 1]!;
      const height = THREE.MathUtils.clamp(
        (point.length() - 0.78) / 0.42,
        0,
        1,
      );
      const mix = THREE.MathUtils.clamp(
        0.14 + 0.64 * height + 0.12 * normalY,
        0,
        1,
      );
      const color = low.clone().lerp(high, mix);
      result.set(colorTriplet(color), 3 * vertex);
    }
    return result;
  }

  private buildDistanceColors(contours: boolean): Float32Array {
    const result = new Float32Array(this.data.vertexCount * 3);
    const maximum = Math.max(...this.data.distance);
    const cold = new THREE.Color(0x17383e);
    const middle = new THREE.Color(0x4b847a);
    const warm = new THREE.Color(0xf3b85e);
    for (let vertex = 0; vertex < this.data.vertexCount; vertex += 1) {
      const normalized = THREE.MathUtils.clamp(
        this.data.distance[vertex]! / maximum,
        0,
        1,
      );
      let color =
        normalized < 0.56
          ? cold.clone().lerp(middle, normalized / 0.56)
          : middle.clone().lerp(warm, (normalized - 0.56) / 0.44);
      if (contours) {
        const band =
          0.76 +
          0.24 * Math.pow(Math.abs(Math.sin(normalized * Math.PI * 22)), 7);
        color = color.multiplyScalar(band);
      }
      result.set(colorTriplet(color), 3 * vertex);
    }
    return result;
  }

  private buildPalette(): void {
    const cold = new THREE.Color(0x102e37);
    const ember = new THREE.Color(0xee7441);
    const hot = new THREE.Color(0xffd88c);
    for (let index = 0; index < 256; index += 1) {
      const value = index / 255;
      const color =
        value < 0.72
          ? cold.clone().lerp(ember, Math.pow(value / 0.72, 2.2))
          : ember.clone().lerp(hot, (value - 0.72) / 0.28);
      this.palette.set(colorTriplet(color), 3 * index);
    }
  }

  private applyColors(source: Float32Array): void {
    this.colors.set(source);
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
  }

  private createGradientLines(): THREE.LineSegments {
    const positions: number[] = [];
    let visibleSample = 0;
    for (const sample of this.data.gradientSamples) {
      const start = new THREE.Vector3(...sample.position);
      const rotatedZ = -Math.sin(-1.23) * start.x + Math.cos(-1.23) * start.z;
      if (rotatedZ <= 0 || visibleSample++ % 2 !== 0) continue;
      const direction = new THREE.Vector3(...sample.direction).normalize();
      const tip = start.clone().addScaledVector(direction, 0.055);
      const normal = start.clone().normalize();
      const side = new THREE.Vector3()
        .crossVectors(direction, normal)
        .normalize();
      const back = tip.clone().addScaledVector(direction, -0.014);
      positions.push(...start.toArray(), ...tip.toArray());
      positions.push(
        ...tip.toArray(),
        ...back.clone().addScaledVector(side, 0.006).toArray(),
      );
      positions.push(
        ...tip.toArray(),
        ...back.clone().addScaledVector(side, -0.006).toArray(),
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    return new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0xa6eee1,
        transparent: true,
        opacity: 0.74,
        depthTest: false,
        depthWrite: false,
      }),
    );
  }

  private placeDefaultExplorer(): void {
    let bestFace = 0;
    let bestDistance = -1;
    for (let face = 0; face < this.data.faceCount; face += 1) {
      const value =
        (this.data.distance[this.data.indices[3 * face]!]! +
          this.data.distance[this.data.indices[3 * face + 1]!]! +
          this.data.distance[this.data.indices[3 * face + 2]!]!) /
        3;
      if (value > bestDistance) {
        bestDistance = value;
        bestFace = face;
      }
    }
    const point = new THREE.Vector3();
    const normal = new THREE.Vector3();
    for (let local = 0; local < 3; local += 1) {
      const index = this.data.indices[3 * bestFace + local]!;
      point.add(vertexVector(this.data.positions, index));
      normal.add(vertexVector(this.data.normals, index));
    }
    point.multiplyScalar(1 / 3);
    normal.normalize();
    this.setExplorer({ face: bestFace, point }, normal, false);
  }

  private setExplorer(
    start: SurfaceStart,
    normal: THREE.Vector3,
    userPlaced: boolean,
  ): void {
    this.explorerStart = { face: start.face, point: start.point.clone() };
    this.explorerWasPlaced = true;
    this.explorer.visible = true;
    placeOnSurface(this.explorer, start.point, normal, 0.028);
    this.rebuildRoutes();
    if (userPlaced) this.onExplorerPlaced?.();
  }

  private rebuildRoutes(): void {
    if (!this.explorerStart) return;
    this.ambientLine?.removeFromParent();
    this.ambientLine?.geometry.dispose();
    (this.ambientLine?.material as THREE.Material | undefined)?.dispose();
    const source = vertexVector(this.data.positions, this.data.sourceVertex);
    const ambientGeometry = new THREE.BufferGeometry().setFromPoints([
      this.explorerStart.point,
      source,
    ]);
    const ambientMaterial = new THREE.LineDashedMaterial({
      color: 0xd7a8ff,
      dashSize: 0.055,
      gapSize: 0.035,
      transparent: true,
      opacity: 0.82,
      depthTest: false,
    });
    this.ambientLine = new THREE.Line(ambientGeometry, ambientMaterial);
    this.ambientLine.computeLineDistances();

    this.dijkstraLine?.removeFromParent();
    this.dijkstraLine?.geometry.dispose();
    (this.dijkstraLine?.material as THREE.Material | undefined)?.dispose();
    const faceVertices = [
      this.data.indices[3 * this.explorerStart.face]!,
      this.data.indices[3 * this.explorerStart.face + 1]!,
      this.data.indices[3 * this.explorerStart.face + 2]!,
    ];
    const startVertex = faceVertices.reduce((best, candidate) =>
      vertexVector(this.data.positions, candidate).distanceToSquared(
        this.explorerStart!.point,
      ) <
      vertexVector(this.data.positions, best).distanceToSquared(
        this.explorerStart!.point,
      )
        ? candidate
        : best,
    );
    const dijkstraPoints: THREE.Vector3[] = [this.explorerStart.point.clone()];
    let current = startVertex;
    for (let step = 0; step <= this.data.vertexCount; step += 1) {
      const point = vertexVector(this.data.positions, current);
      const normal = vertexVector(this.data.normals, current).normalize();
      dijkstraPoints.push(point.addScaledVector(normal, 0.014));
      if (current === this.data.sourceVertex) break;
      const next = this.data.dijkstraPredecessor[current]!;
      if (next === INVALID_INDEX || next === current) break;
      current = next;
    }
    const dijkstraGeometry = new THREE.BufferGeometry().setFromPoints(
      dijkstraPoints,
    );
    this.dijkstraLine = new THREE.Line(
      dijkstraGeometry,
      new THREE.LineBasicMaterial({
        color: 0xe4ddd1,
        transparent: true,
        opacity: 0.9,
      }),
    );

    this.geodesicPath?.removeFromParent();
    this.geodesicPath?.geometry.dispose();
    (this.geodesicPath?.material as THREE.Material | undefined)?.dispose();
    const traced = traceSurfacePath(this.data, this.explorerStart);
    this.geodesicPath = pathTube(traced.points, 0.009, 0xffbd62);
    if (this.geodesicPath) {
      this.geodesicPath.visible = this.activeAct >= 4;
      this.world.add(this.geodesicPath);
    }
  }

  private cameraForAct(act: number): THREE.Vector3 {
    const mobile = window.matchMedia("(max-width: 820px)").matches;
    const z = mobile
      ? [3.65, 3.5, 3.0, 3.4, 3.25, 3.15, 3.75, 3.4]
      : [3.45, 3.35, 2.7, 3.1, 2.95, 2.85, 3.55, 3.15];
    return new THREE.Vector3(
      act === 2 ? 0.48 : 0.2,
      act === 2 ? 0.15 : 0.06,
      z[act] ?? 3.3,
    );
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
  }

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.explorerWasPlaced || this.activeAct > 0) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersection = this.raycaster.intersectObject(this.mesh, false)[0];
    if (!intersection || intersection.faceIndex == null) return;
    const localPoint = this.world.worldToLocal(intersection.point.clone());
    const localNormal =
      intersection.face?.normal.clone() ?? localPoint.clone().normalize();
    this.setExplorer(
      { face: intersection.faceIndex, point: localPoint },
      localNormal,
      true,
    );
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (
      (event.key === "Enter" || event.key === " ") &&
      !this.explorerWasPlaced
    ) {
      event.preventDefault();
      this.placeDefaultExplorer();
      this.onExplorerPlaced?.();
    }
  };

  private readonly render = (time: number): void => {
    if (this.disposed) return;
    const cameraEase = this.reducedMotion ? 1 : 0.035;
    this.camera.position.lerp(this.cameraTarget, cameraEase);
    this.camera.lookAt(0, 0, 0);
    if (!this.reducedMotion) {
      this.world.rotation.y = -1.23 + 0.035 * Math.sin(time * 0.00016);
      this.beacon.scale.setScalar(1 + 0.09 * Math.sin(time * 0.004));
      this.explorer.scale.setScalar(1 + 0.035 * Math.sin(time * 0.0032 + 1));
    }
    if (this.activeAct === 2 && this.dijkstraLine?.parent) {
      const count = this.dijkstraLine.geometry.getAttribute("position").count;
      const progress = this.reducedMotion
        ? 1
        : Math.min(1, (time - this.actStartTime) / 2200);
      this.dijkstraLine.geometry.setDrawRange(
        0,
        Math.max(2, Math.floor(count * progress)),
      );
    }
    if (this.activeAct === 3 && this.heatStarted) {
      const duration = this.reducedMotion ? 1 : 5200;
      const progress = Math.min(1, (time - this.heatStartTime) / duration);
      this.applyHeat(progress);
    }
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.render);
  };
}
