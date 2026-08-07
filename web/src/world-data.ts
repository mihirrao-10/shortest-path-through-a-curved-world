export const SUPPORTED_GENERA = [1, 2, 3] as const;
export type SupportedGenus = (typeof SUPPORTED_GENERA)[number];
export type RoutePresetId = string;

export interface WorldManifestEntry {
  genus: SupportedGenus;
  label: string;
  accessibleLabel: string;
  binary: string;
  metadata: string;
  binaryBytes: number;
  vertices: number;
  faces: number;
}

export interface WorldManifest {
  schema: "geodesic-world-manifest-v1";
  binarySchemaVersion: 3;
  defaultGenus: 2;
  supportedGenera: typeof SUPPORTED_GENERA;
  worlds: WorldManifestEntry[];
}

export interface SurfacePointMetadata {
  face: number;
  barycentric: readonly [number, number, number];
}

export interface RoutePreset {
  id: RoutePresetId;
  label: string;
  description: string;
  start: SurfacePointMetadata;
  dijkstraStartVertex: number;
  ambientChordLength: number;
  edgeDijkstraRouteLength: number;
  tracedHeatMethodRouteLength: number;
  tracingReachedSource: true;
  fallbackUsed: false;
  nativePathOffset: number;
  nativePathCount: number;
}

export interface WorldMetadata {
  schema: "geodesic-world-v4";
  title: string;
  accessibleLabel: string;
  mesh: {
    kind: "implicit-thickened-loop-graph";
    genus: SupportedGenus;
    resolution: number;
    tubeRadius: number;
    relief: number;
    seed: number;
  };
  generator: {
    composition: "irregular-ring" | "folded-double-loop" | "three-ring-chain";
    junction: "overlap-chain";
    cycleRank: SupportedGenus;
    centerlineSamples: number;
    ringRadius: number;
    loopWidth: number;
    effectiveTubeRadius: number;
    smoothMinimumRadius: number;
    gridOffsetFractions: readonly [number, number, number];
    smoothingPasses: number;
    reprojectionPasses: number;
    samplingMinimum: readonly [number, number, number];
    samplingMaximum: readonly [number, number, number];
  };
  vertices: number;
  edges: number;
  faces: number;
  bounds: { center: readonly [number, number, number]; radius: number };
  sourceVertex: number;
  source: {
    label: string;
    surfacePoint: SurfacePointMetadata;
    anchor: readonly [number, number, number];
  };
  topology: {
    closed: true;
    orientedManifold: true;
    connectedComponents: 1;
    boundaryEdges: 0;
    eulerCharacteristic: number;
    genus: SupportedGenus;
    signedVolume: number;
  };
  quality: {
    minimumAngleDegrees: number;
    onePercentileAngleDegrees: number;
    maximumAspectRatio: number;
    minimumFaceArea: number;
  };
  meanEdgeLength: number;
  heatMethodTimeStep: number;
  laplacianSign: string;
  boundaryCondition: string;
  heatEncoding: string;
  heatDisplay: {
    kind: "visualization-diffusion-frames";
    frameCount: number;
    pathSolveUsesDisplayFrames: false;
    timeStepMultipliers: number[];
    frameTimes: number[];
    normalizationLogDynamicRangeDecades: 14;
    routeStartReachThreshold: number;
    minimumFinalRouteStartNormalizedHeat: number;
    allRouteStartsReached: true;
  };
  heatResidual: number;
  poissonResidual: number;
  zeroGradientFaces: number;
  routePresets: RoutePreset[];
  solver: {
    language: string;
    library: string;
    precision: string;
    direct: string;
    iterative: string;
  };
  references: string[];
}

export interface GradientSample {
  face: number;
  position: readonly [number, number, number];
  direction: readonly [number, number, number];
}

export interface DerivedTopology {
  edges: number;
  connectedComponents: number;
  boundaryEdges: number;
  eulerCharacteristic: number;
  recoveredGenus: number;
  signedVolume: number;
}

export interface DerivedMeshQuality {
  minimumAngleDegrees: number;
  onePercentileAngleDegrees: number;
  maximumAspectRatio: number;
  minimumFaceArea: number;
}

export interface WorldData {
  version: 3;
  vertexCount: number;
  faceCount: number;
  heatFrameCount: number;
  sourceVertex: number;
  routePointCount: number;
  routeCount: number;
  meanEdgeLength: number;
  timeStep: number;
  frameTimes: Float64Array;
  frameLogMin: Float64Array;
  frameLogMax: Float64Array;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faceAdjacency: Int32Array;
  distance: Float32Array;
  dijkstraDistance: Float32Array;
  dijkstraPredecessor: Uint32Array;
  heatFrames: Uint16Array[];
  gradientSamples: GradientSample[];
  nativeRoutePoints: Float32Array;
  vertexNeighbors: number[][];
  derivedTopology: DerivedTopology;
  derivedQuality: DerivedMeshQuality;
  derivedBounds: {
    center: readonly [number, number, number];
    radius: number;
  };
}

export interface WorldBundle {
  data: WorldData;
  metadata: WorldMetadata;
  manifestEntry: WorldManifestEntry;
}

export interface HeatFrameInterpolation {
  first: number;
  second: number;
  mix: number;
  visibleFrame: number;
}

export function heatFrameInterpolation(
  frameCount: number,
  progress: number,
): HeatFrameInterpolation {
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new Error("Heat frame count must be a positive integer");
  }
  if (!Number.isFinite(progress)) {
    throw new Error("Heat progress must be finite");
  }
  const scaled = Math.max(0, Math.min(1, progress)) * (frameCount - 1);
  const first = Math.floor(scaled);
  const second = Math.min(first + 1, frameCount - 1);
  return {
    first,
    second,
    mix: scaled - first,
    visibleFrame: Math.min(frameCount - 1, Math.round(scaled)),
  };
}

const MAGIC = "GEOWRLD3";
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isSupportedGenus(value: unknown): value is SupportedGenus {
  return SUPPORTED_GENERA.some((genus) => value === genus);
}

const EXPECTED_COMPOSITIONS = {
  1: "irregular-ring",
  2: "folded-double-loop",
  3: "three-ring-chain",
} as const satisfies Record<SupportedGenus, string>;

function parseVector3(value: unknown, label: string): [number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(isFiniteNumber)
  ) {
    throw new Error(`${label} must be a finite three-vector`);
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

function parseSurfacePoint(
  value: unknown,
  data: WorldData,
  label: string,
): SurfacePointMetadata {
  if (!isRecord(value)) throw new Error(`${label} is invalid`);
  const barycentric = value.barycentric;
  if (
    !Number.isInteger(value.face) ||
    (value.face as number) < 0 ||
    (value.face as number) >= data.faceCount ||
    !Array.isArray(barycentric) ||
    barycentric.length !== 3 ||
    !barycentric.every(isFiniteNumber) ||
    barycentric.some((weight) => weight < 0 || weight > 1) ||
    Math.abs(barycentric.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-8
  ) {
    throw new Error(`${label} is invalid`);
  }
  return {
    face: value.face as number,
    barycentric: barycentric as [number, number, number],
  };
}

function surfacePointPosition(
  data: WorldData,
  point: SurfacePointMetadata,
): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0];
  for (let local = 0; local < 3; local += 1) {
    const vertex = data.indices[3 * point.face + local]!;
    for (let axis = 0; axis < 3; axis += 1) {
      result[axis] =
        result[axis]! +
        point.barycentric[local]! * data.positions[3 * vertex + axis]!;
    }
  }
  return result;
}

function distance3(
  first: ArrayLike<number>,
  second: ArrayLike<number>,
): number {
  return Math.hypot(
    first[0]! - second[0]!,
    first[1]! - second[1]!,
    first[2]! - second[2]!,
  );
}

function nativePathLength(
  data: WorldData,
  offset: number,
  count: number,
): number {
  let length = 0;
  for (let point = 1; point < count; point += 1) {
    const first = 3 * (offset + point - 1);
    const second = 3 * (offset + point);
    length += Math.hypot(
      data.nativeRoutePoints[second]! - data.nativeRoutePoints[first]!,
      data.nativeRoutePoints[second + 1]! - data.nativeRoutePoints[first + 1]!,
      data.nativeRoutePoints[second + 2]! - data.nativeRoutePoints[first + 2]!,
    );
  }
  return length;
}

function parseRoutePresets(value: unknown, data: WorldData): RoutePreset[] {
  if (!Array.isArray(value) || value.length !== 3 || data.routeCount !== 3) {
    throw new Error("World metadata must contain three route presets");
  }
  let expectedOffset = 0;
  const ids = new Set<string>();
  const routes = value.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error("World route preset is invalid");
    const start = parseSurfacePoint(
      candidate.start,
      data,
      `World route preset ${index + 1} start`,
    );
    if (
      typeof candidate.id !== "string" ||
      candidate.id.length === 0 ||
      ids.has(candidate.id) ||
      typeof candidate.label !== "string" ||
      candidate.label.length === 0 ||
      typeof candidate.description !== "string" ||
      candidate.description.length === 0 ||
      !Number.isInteger(candidate.dijkstraStartVertex) ||
      (candidate.dijkstraStartVertex as number) < 0 ||
      (candidate.dijkstraStartVertex as number) >= data.vertexCount ||
      !isFiniteNumber(candidate.ambientChordLength) ||
      !isFiniteNumber(candidate.edgeDijkstraRouteLength) ||
      !isFiniteNumber(candidate.tracedHeatMethodRouteLength) ||
      candidate.ambientChordLength <= 0 ||
      candidate.edgeDijkstraRouteLength <= candidate.ambientChordLength ||
      candidate.tracedHeatMethodRouteLength <= candidate.ambientChordLength ||
      candidate.tracedHeatMethodRouteLength >
        1.25 * candidate.edgeDijkstraRouteLength ||
      candidate.tracingReachedSource !== true ||
      candidate.fallbackUsed !== false ||
      !Number.isInteger(candidate.nativePathOffset) ||
      candidate.nativePathOffset !== expectedOffset ||
      !Number.isInteger(candidate.nativePathCount) ||
      (candidate.nativePathCount as number) < 4 ||
      expectedOffset + (candidate.nativePathCount as number) >
        data.routePointCount
    ) {
      throw new Error(`World route preset ${index + 1} is invalid`);
    }
    ids.add(candidate.id);
    const route: RoutePreset = {
      id: candidate.id,
      label: candidate.label,
      description: candidate.description,
      start,
      dijkstraStartVertex: candidate.dijkstraStartVertex as number,
      ambientChordLength: candidate.ambientChordLength,
      edgeDijkstraRouteLength: candidate.edgeDijkstraRouteLength,
      tracedHeatMethodRouteLength: candidate.tracedHeatMethodRouteLength,
      tracingReachedSource: true,
      fallbackUsed: false,
      nativePathOffset: candidate.nativePathOffset,
      nativePathCount: candidate.nativePathCount as number,
    };
    const startPosition = surfacePointPosition(data, start);
    const nativeStart = data.nativeRoutePoints.subarray(
      3 * route.nativePathOffset,
      3 * route.nativePathOffset + 3,
    );
    const finalOffset =
      3 * (route.nativePathOffset + route.nativePathCount - 1);
    const nativeEnd = data.nativeRoutePoints.subarray(
      finalOffset,
      finalOffset + 3,
    );
    const source = data.positions.subarray(
      3 * data.sourceVertex,
      3 * data.sourceVertex + 3,
    );
    const measuredLength = nativePathLength(
      data,
      route.nativePathOffset,
      route.nativePathCount,
    );
    if (
      distance3(startPosition, nativeStart) > data.meanEdgeLength * 0.12 ||
      distance3(source, nativeEnd) > data.meanEdgeLength * 0.12 ||
      Math.abs(measuredLength - route.tracedHeatMethodRouteLength) >
        Math.max(2e-4, route.tracedHeatMethodRouteLength * 2e-5)
    ) {
      throw new Error(`Native path payload does not match route ${route.id}`);
    }
    expectedOffset += route.nativePathCount;
    return route;
  });
  if (expectedOffset !== data.routePointCount) {
    throw new Error("Native route point ranges do not cover the payload");
  }
  return routes;
}

export function parseWorldManifest(value: unknown): WorldManifest {
  if (!isRecord(value) || !Array.isArray(value.worlds)) {
    throw new Error("World manifest is not an object");
  }
  const supported = value.supportedGenera;
  if (
    value.schema !== "geodesic-world-manifest-v1" ||
    value.binarySchemaVersion !== 3 ||
    value.defaultGenus !== 2 ||
    !Array.isArray(supported) ||
    supported.length !== SUPPORTED_GENERA.length ||
    !SUPPORTED_GENERA.every((genus, index) => supported[index] === genus) ||
    value.worlds.length !== SUPPORTED_GENERA.length
  ) {
    throw new Error("World manifest schema or supported genera are invalid");
  }
  const worlds = value.worlds.map((candidate, index) => {
    if (!isRecord(candidate))
      throw new Error("World manifest entry is invalid");
    const expectedGenus = SUPPORTED_GENERA[index]!;
    const safePath = (path: unknown): path is string =>
      typeof path === "string" &&
      path.length > 0 &&
      !path.startsWith("/") &&
      !path.includes("..") &&
      !path.includes("://");
    if (
      candidate.genus !== expectedGenus ||
      typeof candidate.label !== "string" ||
      candidate.label !== `Genus ${expectedGenus}` ||
      typeof candidate.accessibleLabel !== "string" ||
      candidate.accessibleLabel.length === 0 ||
      !safePath(candidate.binary) ||
      !safePath(candidate.metadata) ||
      !Number.isInteger(candidate.binaryBytes) ||
      (candidate.binaryBytes as number) <= 0 ||
      !Number.isInteger(candidate.vertices) ||
      (candidate.vertices as number) <= 0 ||
      !Number.isInteger(candidate.faces) ||
      (candidate.faces as number) <= 0
    ) {
      throw new Error(
        `World manifest entry for genus ${expectedGenus} is invalid`,
      );
    }
    return candidate as unknown as WorldManifestEntry;
  });
  return {
    schema: "geodesic-world-manifest-v1",
    binarySchemaVersion: 3,
    defaultGenus: 2,
    supportedGenera: SUPPORTED_GENERA,
    worlds,
  };
}

function copyTypedArray<
  T extends Float32Array | Uint32Array | Int32Array | Uint16Array,
>(
  buffer: ArrayBuffer,
  byteOffset: number,
  count: number,
  constructor: {
    new (buffer: ArrayBufferLike, byteOffset: number, length: number): T;
    readonly BYTES_PER_ELEMENT: number;
  },
): { values: T; nextOffset: number } {
  const byteLength = count * constructor.BYTES_PER_ELEMENT;
  if (
    byteOffset < 0 ||
    byteLength < 0 ||
    byteOffset + byteLength > buffer.byteLength
  ) {
    throw new Error("World binary array exceeds the payload length");
  }
  const view = new constructor(buffer, byteOffset, count);
  const values = new constructor(new ArrayBuffer(byteLength), 0, count);
  values.set(view);
  return { values, nextOffset: byteOffset + byteLength };
}

function deriveTopology(
  positions: Float32Array,
  indices: Uint32Array,
  faceAdjacency: Int32Array,
  vertexCount: number,
  faceCount: number,
): {
  topology: DerivedTopology;
  quality: DerivedMeshQuality;
  bounds: { center: [number, number, number]; radius: number };
  vertexNeighbors: number[][];
} {
  type EdgeRecord = {
    count: number;
    orientation: number;
    incidents: Array<{ face: number; oppositeLocal: number }>;
  };
  const edges = new Map<bigint, EdgeRecord>();
  const duplicateFaces = new Set<string>();
  const neighborSets = Array.from(
    { length: vertexCount },
    () => new Set<number>(),
  );
  const vertexFaces = Array.from({ length: vertexCount }, () => [] as number[]);
  const derivedAdjacency = new Int32Array(faceCount * 3);
  derivedAdjacency.fill(-1);
  const angles: number[] = [];
  let minimumAngleDegrees = Number.POSITIVE_INFINITY;
  let maximumAspectRatio = 0;
  let minimumFaceArea = Number.POSITIVE_INFINITY;
  let signedVolume = 0;
  const center: [number, number, number] = [0, 0, 0];
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    center[0] += positions[3 * vertex]!;
    center[1] += positions[3 * vertex + 1]!;
    center[2] += positions[3 * vertex + 2]!;
  }
  center[0] /= vertexCount;
  center[1] /= vertexCount;
  center[2] /= vertexCount;
  let boundingRadius = 0;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    boundingRadius = Math.max(
      boundingRadius,
      Math.hypot(
        positions[3 * vertex]! - center[0],
        positions[3 * vertex + 1]! - center[1],
        positions[3 * vertex + 2]! - center[2],
      ),
    );
  }
  for (let face = 0; face < faceCount; face += 1) {
    const triangle = [
      indices[3 * face]!,
      indices[3 * face + 1]!,
      indices[3 * face + 2]!,
    ];
    if (
      triangle.some((vertex) => vertex >= vertexCount) ||
      new Set(triangle).size !== 3
    ) {
      throw new Error("World triangle index is invalid");
    }
    const faceKey = [...triangle].sort((a, b) => a - b).join(":");
    if (duplicateFaces.has(faceKey)) {
      throw new Error("World geometry contains a duplicate face");
    }
    duplicateFaces.add(faceKey);
    const a = triangle[0]!;
    const b = triangle[1]!;
    const c = triangle[2]!;
    const ax = positions[3 * a]!;
    const ay = positions[3 * a + 1]!;
    const az = positions[3 * a + 2]!;
    const bx = positions[3 * b]!;
    const by = positions[3 * b + 1]!;
    const bz = positions[3 * b + 2]!;
    const cx = positions[3 * c]!;
    const cy = positions[3 * c + 1]!;
    const cz = positions[3 * c + 2]!;
    const crossX = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const crossY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const crossZ = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const doubledArea = Math.hypot(crossX, crossY, crossZ);
    if (doubledArea <= 1e-10) {
      throw new Error("World geometry contains a zero-area face");
    }
    const area = 0.5 * doubledArea;
    minimumFaceArea = Math.min(minimumFaceArea, area);
    const lengths = [
      Math.hypot(bx - cx, by - cy, bz - cz),
      Math.hypot(cx - ax, cy - ay, cz - az),
      Math.hypot(ax - bx, ay - by, az - bz),
    ];
    maximumAspectRatio = Math.max(
      maximumAspectRatio,
      Math.max(...lengths.map((length) => length * length)) / (2 * area),
    );
    for (let corner = 0; corner < 3; corner += 1) {
      const first = lengths[(corner + 1) % 3]!;
      const second = lengths[(corner + 2) % 3]!;
      const opposite = lengths[corner]!;
      const cosine = Math.max(
        -1,
        Math.min(
          1,
          (first * first + second * second - opposite * opposite) /
            (2 * first * second),
        ),
      );
      const angle = (Math.acos(cosine) * 180) / Math.PI;
      angles.push(angle);
      minimumAngleDegrees = Math.min(minimumAngleDegrees, angle);
    }
    signedVolume +=
      (ax * (by * cz - bz * cy) +
        ay * (bz * cx - bx * cz) +
        az * (bx * cy - by * cx)) /
      6;
    for (let local = 0; local < 3; local += 1) {
      const first = triangle[local]!;
      const second = triangle[(local + 1) % 3]!;
      neighborSets[first]!.add(second);
      neighborSets[second]!.add(first);
      const lower = Math.min(first, second);
      const upper = Math.max(first, second);
      const key = (BigInt(lower) << 32n) | BigInt(upper);
      const record = edges.get(key) ?? {
        count: 0,
        orientation: 0,
        incidents: [],
      };
      record.count += 1;
      record.orientation += first === lower ? 1 : -1;
      record.incidents.push({ face, oppositeLocal: (local + 2) % 3 });
      edges.set(key, record);
    }
    vertexFaces[a]!.push(face);
    vertexFaces[b]!.push(face);
    vertexFaces[c]!.push(face);
  }
  let boundaryEdges = 0;
  for (const record of edges.values()) {
    if (record.count === 1) boundaryEdges += 1;
    if (record.count > 2 || (record.count === 2 && record.orientation !== 0)) {
      throw new Error(
        "World geometry is nonmanifold or inconsistently oriented",
      );
    }
    if (record.count === 2) {
      const first = record.incidents[0]!;
      const second = record.incidents[1]!;
      derivedAdjacency[3 * first.face + first.oppositeLocal] = second.face;
      derivedAdjacency[3 * second.face + second.oppositeLocal] = first.face;
    }
  }
  for (let entry = 0; entry < faceAdjacency.length; entry += 1) {
    if (faceAdjacency[entry] !== derivedAdjacency[entry]) {
      throw new Error("World face adjacency disagrees with triangle topology");
    }
  }
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const incident = vertexFaces[vertex]!;
    if (incident.length === 0) {
      throw new Error("World geometry contains an isolated vertex");
    }
    const visitedFaces = new Set<number>();
    const stack = [incident[0]!];
    while (stack.length > 0) {
      const face = stack.pop()!;
      if (visitedFaces.has(face)) continue;
      visitedFaces.add(face);
      const triangle = [
        indices[3 * face]!,
        indices[3 * face + 1]!,
        indices[3 * face + 2]!,
      ];
      let linkDegree = 0;
      for (let local = 0; local < 3; local += 1) {
        if (
          triangle[local] === vertex ||
          triangle[(local + 1) % 3] === vertex
        ) {
          linkDegree += 1;
          const neighbor = derivedAdjacency[3 * face + ((local + 2) % 3)]!;
          if (neighbor >= 0) stack.push(neighbor);
        }
      }
      if (linkDegree !== 2) {
        throw new Error("World vertex link is not a closed manifold cycle");
      }
    }
    if (visitedFaces.size !== incident.length) {
      throw new Error("World vertex has disconnected incident triangle fans");
    }
  }
  const vertexNeighbors = neighborSets.map((neighbors) =>
    [...neighbors].sort((a, b) => a - b),
  );
  const visited = new Uint8Array(vertexCount);
  let connectedComponents = 0;
  for (let start = 0; start < vertexCount; start += 1) {
    if (visited[start]) continue;
    connectedComponents += 1;
    const queue = [start];
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const neighbor of vertexNeighbors[queue[cursor]!]!) {
        if (!visited[neighbor]) {
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
  }
  const eulerCharacteristic = vertexCount - edges.size + faceCount;
  const recoveredGenus = 1 - eulerCharacteristic / 2;
  angles.sort((first, second) => first - second);
  return {
    topology: {
      edges: edges.size,
      connectedComponents,
      boundaryEdges,
      eulerCharacteristic,
      recoveredGenus,
      signedVolume,
    },
    quality: {
      minimumAngleDegrees,
      onePercentileAngleDegrees:
        angles[Math.min(angles.length - 1, Math.floor(angles.length / 100))]!,
      maximumAspectRatio,
      minimumFaceArea,
    },
    bounds: { center, radius: boundingRadius },
    vertexNeighbors,
  };
}

export function parseWorldBinary(buffer: ArrayBuffer): WorldData {
  if (buffer.byteLength < 72) throw new Error("World binary is too short");
  const view = new DataView(buffer);
  let magic = "";
  for (let index = 0; index < 8; index += 1) {
    magic += String.fromCharCode(view.getUint8(index));
  }
  if (magic !== MAGIC) throw new Error(`Unexpected world magic: ${magic}`);
  let offset = 8;
  const readUint32 = (): number => {
    if (offset + 4 > buffer.byteLength)
      throw new Error("World binary header is truncated");
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  };
  const readFloat64 = (): number => {
    if (offset + 8 > buffer.byteLength)
      throw new Error("World binary header is truncated");
    const value = view.getFloat64(offset, true);
    offset += 8;
    return value;
  };
  const version = readUint32();
  const vertexCount = readUint32();
  const faceCount = readUint32();
  const heatFrameCount = readUint32();
  const gradientSampleCount = readUint32();
  const sourceVertex = readUint32();
  const routePointCount = readUint32();
  const routeCount = readUint32();
  if (
    version !== 3 ||
    vertexCount === 0 ||
    faceCount === 0 ||
    heatFrameCount === 0 ||
    routePointCount < 12 ||
    routeCount !== 3 ||
    vertexCount > 2_000_000 ||
    faceCount > 4_000_000 ||
    sourceVertex >= vertexCount
  ) {
    throw new Error("World binary header is invalid or unsupported");
  }
  const meanEdgeLength = readFloat64();
  const timeStep = readFloat64();
  const frameTimes = new Float64Array(heatFrameCount);
  const frameLogMin = new Float64Array(heatFrameCount);
  const frameLogMax = new Float64Array(heatFrameCount);
  for (let frame = 0; frame < heatFrameCount; frame += 1)
    frameTimes[frame] = readFloat64();
  for (let frame = 0; frame < heatFrameCount; frame += 1)
    frameLogMin[frame] = readFloat64();
  for (let frame = 0; frame < heatFrameCount; frame += 1)
    frameLogMax[frame] = readFloat64();
  for (let frame = 0; frame < heatFrameCount; frame += 1) {
    if (
      !Number.isFinite(frameTimes[frame]) ||
      frameTimes[frame]! <= 0 ||
      (frame > 0 && frameTimes[frame]! <= frameTimes[frame - 1]!) ||
      !Number.isFinite(frameLogMin[frame]) ||
      !Number.isFinite(frameLogMax[frame]) ||
      frameLogMax[frame]! < frameLogMin[frame]!
    ) {
      throw new Error("World heat frame metadata is invalid");
    }
  }
  if (
    !Number.isFinite(meanEdgeLength) ||
    meanEdgeLength <= 0 ||
    !Number.isFinite(timeStep) ||
    timeStep <= 0
  ) {
    throw new Error("World scale metadata is invalid");
  }

  const positionsResult = copyTypedArray(
    buffer,
    offset,
    vertexCount * 3,
    Float32Array,
  );
  const positions = positionsResult.values;
  offset = positionsResult.nextOffset;
  const normalsResult = copyTypedArray(
    buffer,
    offset,
    vertexCount * 3,
    Float32Array,
  );
  const normals = normalsResult.values;
  offset = normalsResult.nextOffset;
  const indicesResult = copyTypedArray(
    buffer,
    offset,
    faceCount * 3,
    Uint32Array,
  );
  const indices = indicesResult.values;
  offset = indicesResult.nextOffset;
  const adjacencyResult = copyTypedArray(
    buffer,
    offset,
    faceCount * 3,
    Int32Array,
  );
  const faceAdjacency = adjacencyResult.values;
  offset = adjacencyResult.nextOffset;
  const distanceResult = copyTypedArray(
    buffer,
    offset,
    vertexCount,
    Float32Array,
  );
  const distance = distanceResult.values;
  offset = distanceResult.nextOffset;
  const dijkstraResult = copyTypedArray(
    buffer,
    offset,
    vertexCount,
    Float32Array,
  );
  const dijkstraDistance = dijkstraResult.values;
  offset = dijkstraResult.nextOffset;
  const predecessorResult = copyTypedArray(
    buffer,
    offset,
    vertexCount,
    Uint32Array,
  );
  const dijkstraPredecessor = predecessorResult.values;
  offset = predecessorResult.nextOffset;
  const heatFrames: Uint16Array[] = [];
  for (let frame = 0; frame < heatFrameCount; frame += 1) {
    const result = copyTypedArray(buffer, offset, vertexCount, Uint16Array);
    heatFrames.push(result.values);
    offset = result.nextOffset;
  }
  const gradientSamples: GradientSample[] = [];
  for (let sample = 0; sample < gradientSampleCount; sample += 1) {
    if (offset + 28 > buffer.byteLength)
      throw new Error("World gradient samples are truncated");
    const face = view.getUint32(offset, true);
    offset += 4;
    const position: [number, number, number] = [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
    ];
    offset += 12;
    const direction: [number, number, number] = [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
    ];
    offset += 12;
    gradientSamples.push({ face, position, direction });
  }
  const routePointsResult = copyTypedArray(
    buffer,
    offset,
    routePointCount * 3,
    Float32Array,
  );
  const nativeRoutePoints = routePointsResult.values;
  offset = routePointsResult.nextOffset;
  if (offset !== buffer.byteLength) {
    throw new Error(
      `World binary length mismatch: parsed ${offset}, received ${buffer.byteLength}`,
    );
  }

  for (let component = 0; component < positions.length; component += 1) {
    if (
      !Number.isFinite(positions[component]) ||
      !Number.isFinite(normals[component])
    ) {
      throw new Error("World geometry contains a non-finite component");
    }
  }
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const normalLength = Math.hypot(
      normals[3 * vertex]!,
      normals[3 * vertex + 1]!,
      normals[3 * vertex + 2]!,
    );
    if (
      normalLength < 0.9 ||
      normalLength > 1.1 ||
      !Number.isFinite(distance[vertex]) ||
      distance[vertex]! < -1e-5 ||
      !Number.isFinite(dijkstraDistance[vertex]) ||
      dijkstraDistance[vertex]! < 0 ||
      (dijkstraPredecessor[vertex] !== 0xffffffff &&
        dijkstraPredecessor[vertex]! >= vertexCount)
    ) {
      throw new Error("World normal, distance, or predecessor data is invalid");
    }
  }
  if (Math.abs(distance[sourceVertex]!) > 1e-4) {
    throw new Error("World source distance is not zero");
  }
  for (const adjacent of faceAdjacency) {
    if (adjacent < 0 || adjacent >= faceCount) {
      throw new Error("Closed world face adjacency is invalid");
    }
  }
  for (const sample of gradientSamples) {
    if (
      sample.face >= faceCount ||
      !sample.position.every(Number.isFinite) ||
      !sample.direction.every(Number.isFinite)
    ) {
      throw new Error("World gradient sample is invalid");
    }
  }
  for (const component of nativeRoutePoints) {
    if (!Number.isFinite(component))
      throw new Error("Native route payload is not finite");
  }
  const { topology, quality, bounds, vertexNeighbors } = deriveTopology(
    positions,
    indices,
    faceAdjacency,
    vertexCount,
    faceCount,
  );
  if (
    topology.connectedComponents !== 1 ||
    topology.boundaryEdges !== 0 ||
    !Number.isInteger(topology.recoveredGenus) ||
    !isSupportedGenus(topology.recoveredGenus) ||
    topology.signedVolume <= 0
  ) {
    throw new Error("World binary fails closed orientable topology validation");
  }
  return {
    version: 3,
    vertexCount,
    faceCount,
    heatFrameCount,
    sourceVertex,
    routePointCount,
    routeCount,
    meanEdgeLength,
    timeStep,
    frameTimes,
    frameLogMin,
    frameLogMax,
    positions,
    normals,
    indices,
    faceAdjacency,
    distance,
    dijkstraDistance,
    dijkstraPredecessor,
    heatFrames,
    gradientSamples,
    nativeRoutePoints,
    vertexNeighbors,
    derivedTopology: topology,
    derivedQuality: quality,
    derivedBounds: bounds,
  };
}

export function parseWorldMetadata(
  value: unknown,
  data: WorldData,
): WorldMetadata {
  if (!isRecord(value)) throw new Error("World metadata is not an object");
  const mesh = value.mesh;
  const generator = value.generator;
  const bounds = value.bounds;
  const source = value.source;
  const topology = value.topology;
  const quality = value.quality;
  const heatDisplay = value.heatDisplay;
  const solver = value.solver;
  if (
    value.schema !== "geodesic-world-v4" ||
    typeof value.title !== "string" ||
    value.title.length === 0 ||
    typeof value.accessibleLabel !== "string" ||
    value.accessibleLabel.length === 0 ||
    !isRecord(mesh) ||
    mesh.kind !== "implicit-thickened-loop-graph" ||
    !isSupportedGenus(mesh.genus) ||
    !Number.isInteger(mesh.resolution) ||
    (mesh.resolution as number) < 28 ||
    !isFiniteNumber(mesh.tubeRadius) ||
    mesh.tubeRadius <= 0 ||
    !isFiniteNumber(mesh.relief) ||
    mesh.relief < 0 ||
    !Number.isInteger(mesh.seed) ||
    !isRecord(generator) ||
    generator.composition !== EXPECTED_COMPOSITIONS[mesh.genus] ||
    generator.junction !== "overlap-chain" ||
    generator.cycleRank !== mesh.genus ||
    !Number.isInteger(generator.centerlineSamples) ||
    generator.centerlineSamples !== 0 ||
    !isFiniteNumber(generator.ringRadius) ||
    generator.ringRadius <= 0 ||
    !isFiniteNumber(generator.loopWidth) ||
    generator.loopWidth < 0 ||
    !isFiniteNumber(generator.effectiveTubeRadius) ||
    generator.effectiveTubeRadius <= 0 ||
    !isFiniteNumber(generator.smoothMinimumRadius) ||
    generator.smoothMinimumRadius <= 0 ||
    !Number.isInteger(generator.smoothingPasses) ||
    (generator.smoothingPasses as number) <= 0 ||
    !Number.isInteger(generator.reprojectionPasses) ||
    (generator.reprojectionPasses as number) <= 0 ||
    value.vertices !== data.vertexCount ||
    value.edges !== data.derivedTopology.edges ||
    value.faces !== data.faceCount ||
    !isRecord(bounds) ||
    !isFiniteNumber(bounds.radius) ||
    bounds.radius <= 0 ||
    value.sourceVertex !== data.sourceVertex ||
    !isRecord(source) ||
    typeof source.label !== "string" ||
    source.label.length === 0 ||
    !isRecord(topology) ||
    topology.closed !== true ||
    topology.orientedManifold !== true ||
    topology.connectedComponents !== data.derivedTopology.connectedComponents ||
    topology.boundaryEdges !== data.derivedTopology.boundaryEdges ||
    topology.eulerCharacteristic !== data.derivedTopology.eulerCharacteristic ||
    topology.genus !== data.derivedTopology.recoveredGenus ||
    topology.genus !== mesh.genus ||
    topology.eulerCharacteristic !== 2 - 2 * topology.genus ||
    !isFiniteNumber(topology.signedVolume) ||
    Math.abs(topology.signedVolume - data.derivedTopology.signedVolume) >
      Math.max(2e-5, topology.signedVolume * 2e-5) ||
    !isRecord(quality) ||
    !isFiniteNumber(quality.minimumAngleDegrees) ||
    quality.minimumAngleDegrees < 10 ||
    !isFiniteNumber(quality.onePercentileAngleDegrees) ||
    quality.onePercentileAngleDegrees < 25 ||
    !isFiniteNumber(quality.maximumAspectRatio) ||
    quality.maximumAspectRatio <= 0 ||
    quality.maximumAspectRatio > 8 ||
    !isFiniteNumber(quality.minimumFaceArea) ||
    quality.minimumFaceArea <= 0 ||
    Math.abs(
      quality.minimumAngleDegrees - data.derivedQuality.minimumAngleDegrees,
    ) > Math.max(1e-4, quality.minimumAngleDegrees * 2e-4) ||
    Math.abs(
      quality.onePercentileAngleDegrees -
        data.derivedQuality.onePercentileAngleDegrees,
    ) > Math.max(1e-4, quality.onePercentileAngleDegrees * 2e-4) ||
    Math.abs(
      quality.maximumAspectRatio - data.derivedQuality.maximumAspectRatio,
    ) > Math.max(1e-4, quality.maximumAspectRatio * 2e-4) ||
    Math.abs(quality.minimumFaceArea - data.derivedQuality.minimumFaceArea) >
      Math.max(1e-8, quality.minimumFaceArea * 2e-4) ||
    !isFiniteNumber(value.meanEdgeLength) ||
    Math.abs(value.meanEdgeLength - data.meanEdgeLength) > 1e-9 ||
    !isFiniteNumber(value.heatMethodTimeStep) ||
    Math.abs(value.heatMethodTimeStep - data.timeStep) > 1e-9 ||
    typeof value.laplacianSign !== "string" ||
    typeof value.boundaryCondition !== "string" ||
    typeof value.heatEncoding !== "string" ||
    !isRecord(heatDisplay) ||
    heatDisplay.kind !== "visualization-diffusion-frames" ||
    heatDisplay.frameCount !== data.heatFrameCount ||
    data.heatFrameCount < 3 ||
    heatDisplay.pathSolveUsesDisplayFrames !== false ||
    !Array.isArray(heatDisplay.timeStepMultipliers) ||
    heatDisplay.timeStepMultipliers.length !== data.heatFrameCount ||
    !heatDisplay.timeStepMultipliers.every(
      (multiplier) => isFiniteNumber(multiplier) && multiplier > 0,
    ) ||
    !Array.isArray(heatDisplay.frameTimes) ||
    heatDisplay.frameTimes.length !== data.heatFrameCount ||
    !heatDisplay.frameTimes.every((time) => isFiniteNumber(time) && time > 0) ||
    heatDisplay.normalizationLogDynamicRangeDecades !== 14 ||
    !isFiniteNumber(heatDisplay.routeStartReachThreshold) ||
    heatDisplay.routeStartReachThreshold < 0.05 ||
    heatDisplay.routeStartReachThreshold > 1 ||
    !isFiniteNumber(heatDisplay.minimumFinalRouteStartNormalizedHeat) ||
    heatDisplay.minimumFinalRouteStartNormalizedHeat <
      heatDisplay.routeStartReachThreshold ||
    heatDisplay.minimumFinalRouteStartNormalizedHeat > 1 ||
    heatDisplay.allRouteStartsReached !== true ||
    !isFiniteNumber(value.heatResidual) ||
    value.heatResidual < 0 ||
    !isFiniteNumber(value.poissonResidual) ||
    value.poissonResidual < 0 ||
    !Number.isInteger(value.zeroGradientFaces) ||
    (value.zeroGradientFaces as number) < 0 ||
    !isRecord(solver) ||
    typeof solver.language !== "string" ||
    typeof solver.library !== "string" ||
    typeof solver.precision !== "string" ||
    typeof solver.direct !== "string" ||
    typeof solver.iterative !== "string" ||
    !Array.isArray(value.references) ||
    value.references.length < 2 ||
    !value.references.every(
      (reference) => typeof reference === "string" && reference.length > 0,
    )
  ) {
    throw new Error("World metadata does not match the binary payload");
  }
  const center = parseVector3(bounds.center, "World bounds center");
  const samplingMinimum = parseVector3(
    generator.samplingMinimum,
    "World sampling minimum",
  );
  const samplingMaximum = parseVector3(
    generator.samplingMaximum,
    "World sampling maximum",
  );
  const gridOffsetFractions = parseVector3(
    generator.gridOffsetFractions,
    "World grid offset fractions",
  );
  const anchor = parseVector3(source.anchor, "World source anchor");
  const sourceSurfacePoint = parseSurfacePoint(
    source.surfacePoint,
    data,
    "World source surface point",
  );
  if (
    gridOffsetFractions.some((fraction) => fraction < 0 || fraction >= 1) ||
    gridOffsetFractions.some((fraction) => fraction !== 0) ||
    samplingMinimum.some(
      (minimum, axis) => minimum >= samplingMaximum[axis]!,
    ) ||
    distance3(center, data.derivedBounds.center) >
      Math.max(1e-6, data.derivedBounds.radius * 2e-5) ||
    Math.abs(bounds.radius - data.derivedBounds.radius) >
      Math.max(1e-6, data.derivedBounds.radius * 2e-5) ||
    distance3(
      surfacePointPosition(data, sourceSurfacePoint),
      data.positions.subarray(3 * data.sourceVertex, 3 * data.sourceVertex + 3),
    ) >
      2 * data.meanEdgeLength
  ) {
    throw new Error(
      "World bounds or source landmark do not match the binary payload",
    );
  }
  for (let frame = 0; frame < data.heatFrameCount; frame += 1) {
    const multiplier = heatDisplay.timeStepMultipliers[frame] as number;
    const frameTime = heatDisplay.frameTimes[frame] as number;
    if (
      (frame > 0 &&
        multiplier <= (heatDisplay.timeStepMultipliers[frame - 1] as number)) ||
      Math.abs(frameTime - data.frameTimes[frame]!) >
        Math.max(1e-12, data.frameTimes[frame]! * 2e-9) ||
      Math.abs(frameTime - multiplier * data.timeStep) >
        Math.max(1e-12, frameTime * 2e-9)
    ) {
      throw new Error("World heat display metadata is inconsistent");
    }
  }
  if (
    !heatDisplay.timeStepMultipliers.some(
      (multiplier) => Math.abs((multiplier as number) - 1) < 1e-12,
    )
  ) {
    throw new Error("World heat display metadata omits the path time scale");
  }
  const routePresets = parseRoutePresets(value.routePresets, data);
  if (
    new Set(routePresets.map((route) => route.start.face)).size !==
      routePresets.length ||
    new Set(
      routePresets.map((route) => route.tracedHeatMethodRouteLength.toFixed(3)),
    ).size !== routePresets.length
  ) {
    throw new Error("World route presets are not geometrically distinct");
  }
  const finalHeatFrame = data.heatFrames[data.heatFrameCount - 1]!;
  const derivedMinimumFinalRouteStartHeat = Math.min(
    ...routePresets.map((route) => {
      let heat = 0;
      for (let local = 0; local < 3; local += 1) {
        const vertex = data.indices[3 * route.start.face + local]!;
        heat +=
          route.start.barycentric[local]! * (finalHeatFrame[vertex]! / 65_535);
      }
      return heat;
    }),
  );
  if (
    derivedMinimumFinalRouteStartHeat + 2 / 65_535 <
      heatDisplay.routeStartReachThreshold ||
    Math.abs(
      derivedMinimumFinalRouteStartHeat -
        heatDisplay.minimumFinalRouteStartNormalizedHeat,
    ) >
      3 / 65_535
  ) {
    throw new Error(
      "World final display heat does not reach every authored route start",
    );
  }
  return {
    ...(value as unknown as WorldMetadata),
    generator: {
      ...(generator as unknown as WorldMetadata["generator"]),
      gridOffsetFractions,
      samplingMinimum,
      samplingMaximum,
    },
    bounds: { center, radius: bounds.radius },
    source: { label: source.label, surfacePoint: sourceSurfacePoint, anchor },
    heatDisplay: {
      kind: "visualization-diffusion-frames",
      frameCount: data.heatFrameCount,
      pathSolveUsesDisplayFrames: false,
      timeStepMultipliers: heatDisplay.timeStepMultipliers as number[],
      frameTimes: heatDisplay.frameTimes as number[],
      normalizationLogDynamicRangeDecades: 14,
      routeStartReachThreshold: heatDisplay.routeStartReachThreshold,
      minimumFinalRouteStartNormalizedHeat:
        heatDisplay.minimumFinalRouteStartNormalizedHeat,
      allRouteStartsReached: true,
    },
    routePresets,
  };
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class WorldDataRepository {
  private manifestPromise?: Promise<WorldManifest>;
  private readonly worldPromises = new Map<
    SupportedGenus,
    Promise<WorldBundle>
  >();

  constructor(
    private readonly baseUrl = import.meta.env.BASE_URL,
    private readonly fetcher: FetchLike = (input, init) => fetch(input, init),
  ) {}

  loadManifest(): Promise<WorldManifest> {
    if (!this.manifestPromise) {
      const request = this.fetcher(`${this.baseUrl}data/worlds/manifest.json`)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(
              `World manifest request failed (${response.status})`,
            );
          }
          return parseWorldManifest(await response.json());
        })
        .catch((error) => {
          this.manifestPromise = undefined;
          throw error;
        });
      this.manifestPromise = request;
    }
    return this.manifestPromise;
  }

  loadWorld(genus: SupportedGenus): Promise<WorldBundle> {
    if (!isSupportedGenus(genus)) {
      return Promise.reject(new Error(`Unsupported world genus: ${genus}`));
    }
    const cached = this.worldPromises.get(genus);
    if (cached) return cached;
    const request = this.loadManifest()
      .then(async (manifest) => {
        const entry = manifest.worlds.find((world) => world.genus === genus);
        if (!entry)
          throw new Error(`Manifest does not describe genus ${genus}`);
        const root = `${this.baseUrl}data/worlds/`;
        const [binaryResponse, metadataResponse] = await Promise.all([
          this.fetcher(root + entry.binary),
          this.fetcher(root + entry.metadata),
        ]);
        if (!binaryResponse.ok || !metadataResponse.ok) {
          throw new Error(
            `Genus ${genus} data request failed (${binaryResponse.status}, ${metadataResponse.status})`,
          );
        }
        const [buffer, metadataValue] = await Promise.all([
          binaryResponse.arrayBuffer(),
          metadataResponse.json() as Promise<unknown>,
        ]);
        if (buffer.byteLength !== entry.binaryBytes) {
          throw new Error(
            `Genus ${genus} binary size does not match the manifest`,
          );
        }
        const data = parseWorldBinary(buffer);
        const metadata = parseWorldMetadata(metadataValue, data);
        if (
          metadata.mesh.genus !== genus ||
          data.vertexCount !== entry.vertices ||
          data.faceCount !== entry.faces
        ) {
          throw new Error(`Genus ${genus} payload does not match the manifest`);
        }
        return { data, metadata, manifestEntry: entry };
      })
      .catch((error) => {
        this.worldPromises.delete(genus);
        throw error;
      });
    this.worldPromises.set(genus, request);
    return request;
  }

  isCached(genus: SupportedGenus): boolean {
    return this.worldPromises.has(genus);
  }
}
