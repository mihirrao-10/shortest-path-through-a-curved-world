export interface WorldMetadata {
  schema: string;
  title: string;
  deterministicSeed: number;
  mesh: {
    kind: "procedural-torus";
    majorSegments: number;
    minorSegments: number;
    majorRadius: number;
    minorRadius: number;
    relief: number;
  };
  vertices: number;
  faces: number;
  sourceVertex: number;
  source: { vertex: number; u: number; v: number; label: string };
  topology: {
    closed: true;
    orientedManifold: true;
    boundaryEdges: 0;
    eulerCharacteristic: 0;
    genus: 1;
  };
  quality: { minimumAngleDegrees: number; maximumAspectRatio: number };
  meanEdgeLength: number;
  heatMethodTimeStep: number;
  laplacianSign: string;
  boundaryCondition: string;
  heatEncoding: string;
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
  reference: string;
}

export type RoutePresetId =
  "ridge-crossing" | "inner-saddle-pass" | "basin-rim";

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

const MAGIC = "GEOWRLD2";
const ROUTE_IDS = ["ridge-crossing", "inner-saddle-pass", "basin-rim"] as const;

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
  const mesh = value.mesh;
  const source = value.source;
  const topology = value.topology;
  const quality = value.quality;
  const solver = value.solver;
  if (
    value.schema !== "geodesic-world-v2" ||
    typeof value.title !== "string" ||
    value.title.length === 0 ||
    !Number.isInteger(value.deterministicSeed) ||
    !isRecord(mesh) ||
    mesh.kind !== "procedural-torus" ||
    !Number.isInteger(mesh.majorSegments) ||
    (mesh.majorSegments as number) < 12 ||
    !Number.isInteger(mesh.minorSegments) ||
    (mesh.minorSegments as number) < 8 ||
    (mesh.majorSegments as number) * (mesh.minorSegments as number) !==
      data.vertexCount ||
    2 * (mesh.majorSegments as number) * (mesh.minorSegments as number) !==
      data.faceCount ||
    !isFiniteNumber(mesh.majorRadius) ||
    mesh.majorRadius <= 0 ||
    !isFiniteNumber(mesh.minorRadius) ||
    mesh.minorRadius <= 0 ||
    !isFiniteNumber(mesh.relief) ||
    mesh.relief < 0 ||
    value.vertices !== data.vertexCount ||
    value.faces !== data.faceCount ||
    value.sourceVertex !== data.sourceVertex ||
    !isRecord(source) ||
    source.vertex !== data.sourceVertex ||
    !isFiniteNumber(source.u) ||
    source.u < 0 ||
    source.u >= 2 * Math.PI ||
    !isFiniteNumber(source.v) ||
    source.v < 0 ||
    source.v >= 2 * Math.PI ||
    typeof source.label !== "string" ||
    source.label.length === 0 ||
    !isRecord(topology) ||
    topology.closed !== true ||
    topology.orientedManifold !== true ||
    topology.boundaryEdges !== 0 ||
    topology.eulerCharacteristic !== 0 ||
    topology.genus !== 1 ||
    !isRecord(quality) ||
    !isFiniteNumber(quality.minimumAngleDegrees) ||
    quality.minimumAngleDegrees <= 0 ||
    !isFiniteNumber(quality.maximumAspectRatio) ||
    quality.maximumAspectRatio <= 0 ||
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
    !isRecord(solver) ||
    typeof solver.language !== "string" ||
    typeof solver.library !== "string" ||
    typeof solver.precision !== "string" ||
    typeof solver.direct !== "string" ||
    typeof solver.iterative !== "string" ||
    typeof value.reference !== "string" ||
    value.reference.length === 0
  ) {
    throw new Error("World metadata does not match the binary payload");
  }
  const routePresets = parseRoutePresets(value.routePresets, data);
  if (
    new Set(routePresets.map((route) => route.startFace)).size !==
      routePresets.length ||
    new Set(
      routePresets.map((route) => route.tracedHeatMethodRouteLength.toFixed(3)),
    ).size !== routePresets.length
  ) {
    throw new Error("World route presets are not geometrically distinct");
  }
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
  const reserved = readUint32();
  if (
    version !== 2 ||
    vertexCount === 0 ||
    faceCount === 0 ||
    heatFrameCount === 0 ||
    vertexCount > 10_000_000 ||
    faceCount > 20_000_000 ||
    sourceVertex >= vertexCount ||
    reserved !== 0
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

  if (
    !Number.isFinite(meanEdgeLength) ||
    meanEdgeLength <= 0 ||
    !Number.isFinite(timeStep) ||
    timeStep <= 0
  ) {
    throw new Error("World scale metadata is invalid");
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
    if (
      !Number.isFinite(distance[vertex]) ||
      distance[vertex]! < -1e-5 ||
      !Number.isFinite(dijkstraDistance[vertex]) ||
      dijkstraDistance[vertex]! < 0 ||
      (dijkstraPredecessor[vertex] !== 0xffffffff &&
        dijkstraPredecessor[vertex]! >= vertexCount)
    ) {
      throw new Error("World distance or predecessor data is invalid");
    }
  }
  if (Math.abs(distance[sourceVertex]!) > 1e-4) {
    throw new Error("World source distance is not zero");
  }
  for (let corner = 0; corner < indices.length; corner += 1) {
    if (indices[corner]! >= vertexCount) {
      throw new Error("World triangle index is out of range");
    }
  }
  for (let corner = 0; corner < faceAdjacency.length; corner += 1) {
    const adjacent = faceAdjacency[corner]!;
    if (adjacent < -1 || adjacent >= faceCount) {
      throw new Error("World face adjacency is out of range");
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
