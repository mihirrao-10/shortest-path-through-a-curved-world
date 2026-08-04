import * as THREE from "three";
import { traceSurfacePath, type SurfaceStart } from "./path-tracer";
import type { TargetPresetName, WorldData } from "./world-data";

const INVALID_INDEX = 0xffffffff;

export type RouteComparisonMode = "chord" | "edge" | "heat" | "compare";

export interface RouteGeometry {
  points: THREE.Vector3[];
  length: number;
  reachesDestination: boolean;
}

export interface RouteComparisonGeometry {
  chord: RouteGeometry;
  edge: RouteGeometry;
  heat: RouteGeometry;
}

function vertexVector(
  data: WorldData,
  index: number,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  return target.fromArray(data.positions, 3 * index);
}

export function polylineLength(points: readonly THREE.Vector3[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += points[index - 1]!.distanceTo(points[index]!);
  }
  return length;
}

function closestFaceVertex(data: WorldData, start: SurfaceStart): number {
  const vertices = [
    data.indices[3 * start.face]!,
    data.indices[3 * start.face + 1]!,
    data.indices[3 * start.face + 2]!,
  ];
  return vertices.reduce((best, candidate) =>
    vertexVector(data, candidate).distanceToSquared(start.point) <
    vertexVector(data, best).distanceToSquared(start.point)
      ? candidate
      : best,
  );
}

function buildEdgePoints(
  data: WorldData,
  start: SurfaceStart,
): { points: THREE.Vector3[]; reachesDestination: boolean } {
  const points = [start.point.clone()];
  let current = closestFaceVertex(data, start);
  let reachesDestination = false;
  for (let step = 0; step <= data.vertexCount; step += 1) {
    points.push(vertexVector(data, current));
    if (current === data.sourceVertex) {
      reachesDestination = true;
      break;
    }
    const next = data.dijkstraPredecessor[current]!;
    if (next === INVALID_INDEX || next === current) break;
    current = next;
  }
  return { points, reachesDestination };
}

export function buildRouteComparison(
  data: WorldData,
  start: SurfaceStart,
): RouteComparisonGeometry {
  const destination = vertexVector(data, data.sourceVertex);
  const chordPoints = [start.point.clone(), destination];
  const edge = buildEdgePoints(data, start);
  const heat = traceSurfacePath(data, start);
  return {
    chord: {
      points: chordPoints,
      length: polylineLength(chordPoints),
      reachesDestination: true,
    },
    edge: {
      points: edge.points,
      length: polylineLength(edge.points),
      reachesDestination: edge.reachesDestination,
    },
    heat: {
      points: heat.points,
      length: polylineLength(heat.points),
      reachesDestination: heat.reachedSource,
    },
  };
}

export function buildPresetRouteComparison(
  data: WorldData,
  name: TargetPresetName,
): RouteComparisonGeometry {
  const preset = data.targetPresets[name];
  const target = vertexVector(data, preset.vertex);
  const source = vertexVector(data, data.sourceVertex);
  const heatPoints: THREE.Vector3[] = [];
  for (let offset = 0; offset < preset.heatPoints.length; offset += 3) {
    heatPoints.push(new THREE.Vector3().fromArray(preset.heatPoints, offset));
  }
  const edgePoints = [...preset.edgeVertices].map((vertex) =>
    vertexVector(data, vertex),
  );
  return {
    chord: {
      points: [target, source],
      length: preset.chordLength,
      reachesDestination: true,
    },
    edge: {
      points: edgePoints,
      length: preset.edgeRouteLength,
      reachesDestination: edgePoints.at(-1)?.distanceTo(source) === 0,
    },
    heat: {
      points: heatPoints,
      length: preset.heatRouteLength,
      reachesDestination: heatPoints.at(-1)?.distanceTo(source) === 0,
    },
  };
}
