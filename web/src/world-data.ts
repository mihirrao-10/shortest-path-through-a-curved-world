export interface WorldMetadata {
  schema: string;
  title: string;
  deterministicSeed: number;
  detailLevel: number;
  vertices: number;
  faces: number;
  sourceVertex: number;
  topology: {
    closed: boolean;
    orientedManifold: boolean;
    eulerCharacteristic: number;
    genus: number;
  };
  targetPresets: Record<TargetPresetName, TargetPresetMetadata>;
  meanEdgeLength: number;
  heatMethodTimeStep: number;
  laplacianSign: string;
  boundaryCondition: string;
  heatEncoding: string;
  heatResidual: number;
  poissonResidual: number;
  zeroGradientFaces: number;
  operatorAssemblyMilliseconds: number;
  factorizationMilliseconds: number;
  preprocessingMilliseconds: number;
  heatSolveMilliseconds: number;
  poissonSolveMilliseconds: number;
  dijkstraMilliseconds: number;
  engine: string;
  reference: string;
}

export type TargetPresetName = "exterior" | "tunnel" | "farSide";

export interface TargetPresetMetadata {
  vertex: number;
  chordLength: number;
  heatRouteLength: number;
  edgeRouteLength: number;
}

export interface TargetPresetRoute extends TargetPresetMetadata {
  name: TargetPresetName;
  heatPoints: Float32Array;
  edgeVertices: Uint32Array;
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
  targetPresets: Record<TargetPresetName, TargetPresetRoute>;
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
const TARGET_PRESET_NAMES = ["exterior", "tunnel", "farSide"] as const;

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
  const targetPresetCount = readUint32();
  if (
    version !== 2 ||
    vertexCount === 0 ||
    faceCount === 0 ||
    heatFrameCount === 0 ||
    targetPresetCount !== TARGET_PRESET_NAMES.length
  ) {
    throw new Error("World binary header is invalid or unsupported");
  }
  const meanEdgeLength = readFloat64();
  const timeStep = readFloat64();
  const targetPresetVertices = new Uint32Array(targetPresetCount);
  for (let preset = 0; preset < targetPresetCount; preset += 1)
    targetPresetVertices[preset] = readUint32();
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

  const targetPresets = {} as Record<TargetPresetName, TargetPresetRoute>;
  for (let preset = 0; preset < targetPresetCount; preset += 1) {
    const kind = readUint32();
    const targetVertex = readUint32();
    const heatPointCount = readUint32();
    const edgeVertexCount = readUint32();
    const chordLength = readFloat64();
    const heatRouteLength = readFloat64();
    const edgeRouteLength = readFloat64();
    const name = TARGET_PRESET_NAMES[kind];
    if (
      name === undefined ||
      kind !== preset ||
      targetVertex !== targetPresetVertices[preset] ||
      targetVertex >= vertexCount ||
      heatPointCount < 2 ||
      edgeVertexCount < 2
    ) {
      throw new Error("World target preset record is invalid");
    }
    const heatPointsResult = copyTypedArray(
      buffer,
      offset,
      heatPointCount * 3,
      Float32Array,
    );
    offset = heatPointsResult.nextOffset;
    const edgeVerticesResult = copyTypedArray(
      buffer,
      offset,
      edgeVertexCount,
      Uint32Array,
    );
    offset = edgeVerticesResult.nextOffset;
    targetPresets[name] = {
      name,
      vertex: targetVertex,
      chordLength,
      heatRouteLength,
      edgeRouteLength,
      heatPoints: heatPointsResult.values,
      edgeVertices: edgeVerticesResult.values,
    };
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
    targetPresets,
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
  const [buffer, metadata] = await Promise.all([
    binaryResponse.arrayBuffer(),
    metadataResponse.json() as Promise<WorldMetadata>,
  ]);
  const data = parseWorldBinary(buffer);
  if (
    metadata.schema !== "geodesic-world-v2" ||
    metadata.vertices !== data.vertexCount ||
    metadata.faces !== data.faceCount ||
    metadata.sourceVertex !== data.sourceVertex ||
    metadata.topology.genus !== 1 ||
    metadata.topology.eulerCharacteristic !== 0 ||
    TARGET_PRESET_NAMES.some(
      (name) =>
        metadata.targetPresets[name].vertex !== data.targetPresets[name].vertex,
    )
  ) {
    throw new Error("World metadata does not match the binary payload");
  }
  return { data, metadata };
}
