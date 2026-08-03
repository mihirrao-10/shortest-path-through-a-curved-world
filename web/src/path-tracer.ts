import * as THREE from "three";
import type { WorldData } from "./world-data";

export interface SurfaceStart {
  face: number;
  point: THREE.Vector3;
}

export interface TracedPath {
  points: THREE.Vector3[];
  reachedSource: boolean;
  usedFallback: boolean;
  termination: string;
}

function vertex(
  data: WorldData,
  index: number,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  return target.fromArray(data.positions, 3 * index);
}

function triangleVertices(
  data: WorldData,
  face: number,
): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  return [
    vertex(data, data.indices[3 * face]!),
    vertex(data, data.indices[3 * face + 1]!),
    vertex(data, data.indices[3 * face + 2]!),
  ];
}

export function barycentric(
  point: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
): [number, number, number] {
  const v0 = new THREE.Vector3().subVectors(b, a);
  const v1 = new THREE.Vector3().subVectors(c, a);
  const v2 = new THREE.Vector3().subVectors(point, a);
  const d00 = v0.dot(v0);
  const d01 = v0.dot(v1);
  const d11 = v1.dot(v1);
  const d20 = v2.dot(v0);
  const d21 = v2.dot(v1);
  const denominator = d00 * d11 - d01 * d01;
  if (Math.abs(denominator) < 1e-24)
    throw new Error("Degenerate triangle in path tracer");
  const v = (d11 * d20 - d01 * d21) / denominator;
  const w = (d00 * d21 - d01 * d20) / denominator;
  return [1 - v - w, v, w];
}

function inside(values: readonly number[], tolerance = 1e-5): boolean {
  return values.every(
    (value) =>
      Number.isFinite(value) && value >= -tolerance && value <= 1 + tolerance,
  );
}

function faceGeometry(
  data: WorldData,
  face: number,
): {
  vertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  barycentricGradients: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
} {
  const vertices = triangleVertices(data, face);
  const [a, b, c] = vertices;
  const cross = new THREE.Vector3().crossVectors(
    new THREE.Vector3().subVectors(b, a),
    new THREE.Vector3().subVectors(c, a),
  );
  const doubledArea = cross.length();
  if (doubledArea < 1e-20)
    throw new Error("Degenerate triangle in path tracer");
  const normal = cross.multiplyScalar(1 / doubledArea);
  const gradients: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
    new THREE.Vector3()
      .crossVectors(normal, new THREE.Vector3().subVectors(c, b))
      .multiplyScalar(1 / doubledArea),
    new THREE.Vector3()
      .crossVectors(normal, new THREE.Vector3().subVectors(a, c))
      .multiplyScalar(1 / doubledArea),
    new THREE.Vector3()
      .crossVectors(normal, new THREE.Vector3().subVectors(b, a))
      .multiplyScalar(1 / doubledArea),
  ];
  return { vertices, barycentricGradients: gradients };
}

function distanceGradient(data: WorldData, face: number): THREE.Vector3 {
  const geometry = faceGeometry(data, face);
  const gradient = new THREE.Vector3();
  for (let local = 0; local < 3; local += 1) {
    const index = data.indices[3 * face + local]!;
    gradient.addScaledVector(
      geometry.barycentricGradients[local]!,
      data.distance[index]!,
    );
  }
  return gradient;
}

function interpolate(
  vertices: readonly THREE.Vector3[],
  weights: readonly number[],
): THREE.Vector3 {
  const point = new THREE.Vector3();
  for (let local = 0; local < 3; local += 1)
    point.addScaledVector(vertices[local]!, weights[local]!);
  return point;
}

function vertexFallback(
  data: WorldData,
  initialVertex: number,
  source: number,
  points: THREE.Vector3[],
  maxSteps: number,
): boolean {
  const visited = new Set<number>();
  let current = initialVertex;
  for (let step = 0; step < maxSteps; step += 1) {
    if (visited.has(current)) return false;
    visited.add(current);
    const point = vertex(data, current);
    if ((points.at(-1)?.distanceToSquared(point) ?? 1) > 1e-18)
      points.push(point);
    if (current === source) return true;
    let best = current;
    let bestDistance = data.distance[current]!;
    for (const neighbor of data.vertexNeighbors[current]!) {
      const candidate = data.distance[neighbor]!;
      if (
        candidate < bestDistance - 1e-9 ||
        (neighbor === source && candidate <= bestDistance + 1e-9)
      ) {
        best = neighbor;
        bestDistance = candidate;
      }
    }
    if (best === current) return false;
    current = best;
  }
  return false;
}

export function traceSurfacePath(
  data: WorldData,
  start: SurfaceStart,
  maxSteps = 6000,
): TracedPath {
  if (start.face < 0 || start.face >= data.faceCount || maxSteps < 1) {
    throw new Error("Invalid path start");
  }
  const source = data.sourceVertex;
  const sourcePoint = vertex(data, source);
  const sourceRadius = 1.5 * data.meanEdgeLength;
  const nudge = 1e-7 * data.meanEdgeLength;
  let face = start.face;
  let point = start.point.clone();
  const points = [point.clone()];
  const visits = new Uint8Array(data.faceCount);

  const fallback = (reason: string): TracedPath => {
    const triangle = [
      data.indices[3 * face]!,
      data.indices[3 * face + 1]!,
      data.indices[3 * face + 2]!,
    ];
    const initial = triangle.reduce((best, candidate) =>
      data.distance[candidate]! < data.distance[best]! ? candidate : best,
    );
    const reached = vertexFallback(
      data,
      initial,
      source,
      points,
      maxSteps - points.length,
    );
    return {
      points,
      reachedSource: reached,
      usedFallback: true,
      termination: reached
        ? `${reason}; monotone vertex fallback reached source`
        : `${reason}; fallback stalled`,
    };
  };

  for (let step = 0; step < maxSteps; step += 1) {
    if (point.distanceTo(sourcePoint) <= sourceRadius) {
      points.push(sourcePoint);
      return {
        points,
        reachedSource: true,
        usedFallback: false,
        termination: "source neighborhood",
      };
    }
    visits[face]! += 1;
    if (visits[face]! > 3) return fallback("face cycle detected");

    const geometry = faceGeometry(data, face);
    const weights = barycentric(point, ...geometry.vertices);
    const interpolated = weights.reduce(
      (sum, weight, local) =>
        sum + weight * data.distance[data.indices[3 * face + local]!]!,
      0,
    );
    if (interpolated <= sourceRadius) {
      points.push(sourcePoint);
      return {
        points,
        reachedSource: true,
        usedFallback: false,
        termination: "distance neighborhood",
      };
    }

    const gradient = distanceGradient(data, face);
    if (gradient.lengthSq() < 1e-18) return fallback("critical face");
    const direction = gradient.normalize().negate();
    const velocity = geometry.barycentricGradients.map((basis) =>
      basis.dot(direction),
    );
    let crossingTime = Number.POSITIVE_INFINITY;
    for (let local = 0; local < 3; local += 1) {
      if (velocity[local]! < -1e-14) {
        const candidate = -weights[local]! / velocity[local]!;
        if (candidate > nudge * 0.01 && candidate < crossingTime)
          crossingTime = candidate;
      }
    }
    if (!Number.isFinite(crossingTime))
      return fallback("descent ray stayed inside one face");
    const crossing = point.clone().addScaledVector(direction, crossingTime);
    if (points.at(-1)!.distanceTo(crossing) > nudge * 0.01)
      points.push(crossing.clone());

    const crossedEdges: number[] = [];
    for (let local = 0; local < 3; local += 1) {
      if (velocity[local]! < -1e-14) {
        const candidate = -weights[local]! / velocity[local]!;
        if (
          Math.abs(candidate - crossingTime) <=
          Math.max(nudge, crossingTime * 1e-7)
        )
          crossedEdges.push(local);
      }
    }

    let nextFace = -1;
    let nextPoint = crossing;
    for (const local of crossedEdges) {
      const candidateFace = data.faceAdjacency[3 * face + local]!;
      if (candidateFace < 0) continue;
      const nextGradient = distanceGradient(data, candidateFace);
      if (nextGradient.lengthSq() < 1e-18) continue;
      const candidatePoint = crossing
        .clone()
        .addScaledVector(nextGradient.normalize(), -nudge);
      const candidateGeometry = faceGeometry(data, candidateFace);
      const candidateWeights = barycentric(
        candidatePoint,
        ...candidateGeometry.vertices,
      );
      nextFace = candidateFace;
      if (inside(candidateWeights)) {
        const clamped = candidateWeights.map((value) => Math.max(0, value));
        const sum = clamped.reduce((total, value) => total + value, 0);
        nextPoint = interpolate(
          candidateGeometry.vertices,
          clamped.map((value) => value / sum),
        );
        break;
      }
    }
    if (nextFace < 0) return fallback("mesh boundary reached");
    face = nextFace;
    point = nextPoint;
  }
  return fallback("maximum face crossings exceeded");
}
