export interface WorldMetadata {
  schema: string;
  title: string;
  deterministicSeed: number;
  subdivisions: number;
  vertices: number;
  faces: number;
  sourceVertex: number;
  meanEdgeLength: number;
  heatMethodTimeStep: number;
  laplacianSign: string;
  boundaryCondition: string;
  heatEncoding: string;
  heatResidual: number;
  poissonResidual: number;
  zeroGradientFaces: number;
  routePresets: RoutePreset[];
  exportDiagnostics: {
    scope: string;
    host: string;
    preprocessingMilliseconds: number;
    heatSolveMilliseconds: number;
    poissonSolveMilliseconds: number;
    dijkstraMilliseconds: number;
  };
  gpu: { available: boolean; reason: string };
  reference: string;
}

export type RoutePresetId = "ridge-crossing" | "saddle-pass" | "basin-rim";

export interface RoutePreset {
  id: RoutePresetId;
  label: string;
  description: string;
  startFace: number;
  startBarycentric: readonly [number, number, number];
  dijkstraStartVertex: number;
  ambientChordLength: number;
  edgeDijkstraRouteLength: number;
  tracedHeatMethodRouteLength: number;
  tracingReachedSource: boolean;
  fallbackUsed: boolean;
}

export interface GradientSample {
  face: number;
  position: readonly [number, number, number];
  direction: readonly [number, number, number];
}

export interface WorldData {
  version: number;
  vertexCount: number;
  faceCount: number;
  heatFrameCount: number;
  sourceVertex: number;
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
  vertexNeighbors: number[][];
}

const MAGIC = "GEOWRLD1";
const ROUTE_IDS = ["ridge-crossing", "saddle-pass", "basin-rim"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseRoutePresets(value: unknown, data: WorldData): RoutePreset[] {
  if (!Array.isArray(value) || value.length !== ROUTE_IDS.length) {
    throw new Error("World metadata must contain three route presets");
  }
  return value.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error("World route preset is invalid");
    const barycentric = candidate.startBarycentric;
    if (
      candidate.id !== ROUTE_IDS[index] ||
      typeof candidate.label !== "string" ||
      candidate.label.length === 0 ||
      typeof candidate.description !== "string" ||
      candidate.description.length === 0 ||
      !Number.isInteger(candidate.startFace) ||
      (candidate.startFace as number) < 0 ||
      (candidate.startFace as number) >= data.faceCount ||
      !Array.isArray(barycentric) ||
      barycentric.length !== 3 ||
      !barycentric.every(isFiniteNumber) ||
      barycentric.some((weight) => weight < 0 || weight > 1) ||
      Math.abs(barycentric.reduce((sum, weight) => sum + weight, 0) - 1) >
        1e-8 ||
      !Number.isInteger(candidate.dijkstraStartVertex) ||
      (candidate.dijkstraStartVertex as number) < 0 ||
      (candidate.dijkstraStartVertex as number) >= data.vertexCount ||
      !isFiniteNumber(candidate.ambientChordLength) ||
      !isFiniteNumber(candidate.edgeDijkstraRouteLength) ||
      !isFiniteNumber(candidate.tracedHeatMethodRouteLength) ||
      candidate.ambientChordLength <= 0 ||
      candidate.edgeDijkstraRouteLength <= 0 ||
      candidate.tracedHeatMethodRouteLength <= 0 ||
      candidate.edgeDijkstraRouteLength <= candidate.ambientChordLength ||
      candidate.tracedHeatMethodRouteLength <= candidate.ambientChordLength ||
      candidate.tracedHeatMethodRouteLength >
        1.25 * candidate.edgeDijkstraRouteLength ||
      candidate.tracingReachedSource !== true ||
      candidate.fallbackUsed !== false
    ) {
      throw new Error(`World route preset ${ROUTE_IDS[index]} is invalid`);
    }
    const id = ROUTE_IDS[index]!;
    return {
      id,
      label: candidate.label,
      description: candidate.description,
      startFace: candidate.startFace as number,
      startBarycentric: barycentric as [number, number, number],
      dijkstraStartVertex: candidate.dijkstraStartVertex as number,
      ambientChordLength: candidate.ambientChordLength,
      edgeDijkstraRouteLength: candidate.edgeDijkstraRouteLength,
      tracedHeatMethodRouteLength: candidate.tracedHeatMethodRouteLength,
      tracingReachedSource: candidate.tracingReachedSource,
      fallbackUsed: candidate.fallbackUsed,
    };
  });
}

export function parseWorldMetadata(
  value: unknown,
  data: WorldData,
): WorldMetadata {
  if (!isRecord(value)) throw new Error("World metadata is not an object");
  const diagnostics = value.exportDiagnostics;
  const gpu = value.gpu;
  if (
    value.schema !== "geodesic-world-v1" ||
    typeof value.title !== "string" ||
    value.title.length === 0 ||
    !Number.isInteger(value.deterministicSeed) ||
    !Number.isInteger(value.subdivisions) ||
    (value.subdivisions as number) < 1 ||
    value.vertices !== data.vertexCount ||
    value.faces !== data.faceCount ||
    value.sourceVertex !== data.sourceVertex ||
    !isFiniteNumber(value.meanEdgeLength) ||
    value.meanEdgeLength <= 0 ||
    Math.abs(value.meanEdgeLength - data.meanEdgeLength) > 1e-9 ||
    !isFiniteNumber(value.heatMethodTimeStep) ||
    value.heatMethodTimeStep <= 0 ||
    Math.abs(value.heatMethodTimeStep - data.timeStep) > 1e-9 ||
    typeof value.laplacianSign !== "string" ||
    typeof value.boundaryCondition !== "string" ||
    typeof value.heatEncoding !== "string" ||
    !isFiniteNumber(value.heatResidual) ||
    value.heatResidual < 0 ||
    !isFiniteNumber(value.poissonResidual) ||
    value.poissonResidual < 0 ||
    !Number.isInteger(value.zeroGradientFaces) ||
    (value.zeroGradientFaces as number) < 0 ||
    !isRecord(diagnostics) ||
    typeof diagnostics.scope !== "string" ||
    diagnostics.scope.length === 0 ||
    typeof diagnostics.host !== "string" ||
    diagnostics.host.length === 0 ||
    !isFiniteNumber(diagnostics.preprocessingMilliseconds) ||
    diagnostics.preprocessingMilliseconds < 0 ||
    !isFiniteNumber(diagnostics.heatSolveMilliseconds) ||
    diagnostics.heatSolveMilliseconds < 0 ||
    !isFiniteNumber(diagnostics.poissonSolveMilliseconds) ||
    diagnostics.poissonSolveMilliseconds < 0 ||
    !isFiniteNumber(diagnostics.dijkstraMilliseconds) ||
    diagnostics.dijkstraMilliseconds < 0 ||
    !isRecord(gpu) ||
    typeof gpu.available !== "boolean" ||
    typeof gpu.reason !== "string" ||
    gpu.reason.length === 0 ||
    typeof value.reference !== "string" ||
    value.reference.length === 0
  ) {
    throw new Error("World metadata does not match the binary payload");
  }
  const routePresets = parseRoutePresets(value.routePresets, data);
  return { ...(value as unknown as WorldMetadata), routePresets };
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
  const view = new constructor(buffer, byteOffset, count);
  const values = new constructor(
    new ArrayBuffer(count * constructor.BYTES_PER_ELEMENT),
    0,
    count,
  );
  values.set(view);
  return {
    values,
    nextOffset: byteOffset + count * constructor.BYTES_PER_ELEMENT,
  };
}

export function parseWorldBinary(buffer: ArrayBuffer): WorldData {
  const data = new DataView(buffer);
  if (buffer.byteLength < 64) {
    throw new Error("World binary is too short");
  }
  let magic = "";
  for (let index = 0; index < 8; index += 1) {
    magic += String.fromCharCode(data.getUint8(index));
  }
  if (magic !== MAGIC) {
    throw new Error(`Unexpected world magic: ${magic}`);
  }

  let offset = 8;
  const readUint32 = (): number => {
    const value = data.getUint32(offset, true);
    offset += 4;
    return value;
  };
  const readFloat64 = (): number => {
    const value = data.getFloat64(offset, true);
    offset += 8;
    return value;
  };

  const version = readUint32();
  const vertexCount = readUint32();
  const faceCount = readUint32();
  const heatFrameCount = readUint32();
  const gradientSampleCount = readUint32();
  const sourceVertex = readUint32();
  readUint32(); // Reserved.
  if (
    version !== 1 ||
    vertexCount === 0 ||
    faceCount === 0 ||
    heatFrameCount === 0
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
    const face = data.getUint32(offset, true);
    offset += 4;
    const position: [number, number, number] = [
      data.getFloat32(offset, true),
      data.getFloat32(offset + 4, true),
      data.getFloat32(offset + 8, true),
    ];
    offset += 12;
    const direction: [number, number, number] = [
      data.getFloat32(offset, true),
      data.getFloat32(offset + 4, true),
      data.getFloat32(offset + 8, true),
    ];
    offset += 12;
    gradientSamples.push({ face, position, direction });
  }
  if (offset !== buffer.byteLength) {
    throw new Error(
      `World binary length mismatch: parsed ${offset}, received ${buffer.byteLength}`,
    );
  }

  const neighborSets = Array.from(
    { length: vertexCount },
    () => new Set<number>(),
  );
  for (let face = 0; face < faceCount; face += 1) {
    const a = indices[3 * face]!;
    const b = indices[3 * face + 1]!;
    const c = indices[3 * face + 2]!;
    neighborSets[a]!.add(b).add(c);
    neighborSets[b]!.add(a).add(c);
    neighborSets[c]!.add(a).add(b);
  }
  const vertexNeighbors = neighborSets.map((neighbors) =>
    [...neighbors].sort((a, b) => a - b),
  );

  return {
    version,
    vertexCount,
    faceCount,
    heatFrameCount,
    sourceVertex,
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
    vertexNeighbors,
  };
}

export async function loadWorldData(): Promise<{
  data: WorldData;
  metadata: WorldMetadata;
}> {
  const base = import.meta.env.BASE_URL;
  const [binaryResponse, metadataResponse] = await Promise.all([
    fetch(`${base}data/world.bin`),
    fetch(`${base}data/world.meta.json`),
  ]);
  if (!binaryResponse.ok || !metadataResponse.ok) {
    throw new Error(
      `World data request failed (${binaryResponse.status}, ${metadataResponse.status})`,
    );
  }
  const [buffer, metadataValue] = await Promise.all([
    binaryResponse.arrayBuffer(),
    metadataResponse.json() as Promise<unknown>,
  ]);
  const data = parseWorldBinary(buffer);
  const metadata = parseWorldMetadata(metadataValue, data);
  return { data, metadata };
}
