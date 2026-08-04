import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { selectHeatInspectionFrames } from "../src/heat-inspection";
import { traceSurfacePath } from "../src/path-tracer";
import {
  buildPresetRouteComparison,
  buildRouteComparison,
} from "../src/route-comparison";
import { parseWorldBinary } from "../src/world-data";

function loadWorld() {
  const bytes = readFileSync(
    new URL("../public/data/world.bin", import.meta.url),
  );
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return parseWorldBinary(buffer);
}

function farSurfaceStart(world: ReturnType<typeof loadWorld>) {
  let farFace = 0;
  let farDistance = -1;
  for (let face = 0; face < world.faceCount; face += 1) {
    const average =
      (world.distance[world.indices[3 * face]!]! +
        world.distance[world.indices[3 * face + 1]!]! +
        world.distance[world.indices[3 * face + 2]!]!) /
      3;
    if (average > farDistance) {
      farDistance = average;
      farFace = face;
    }
  }
  const point = new THREE.Vector3();
  for (let local = 0; local < 3; local += 1) {
    point.add(
      new THREE.Vector3().fromArray(
        world.positions,
        3 * world.indices[3 * farFace + local]!,
      ),
    );
  }
  point.multiplyScalar(1 / 3);
  return { face: farFace, point };
}

describe("engine world export", () => {
  it("parses all binary sections deterministically", () => {
    const world = loadWorld();
    expect(world.version).toBe(2);
    expect(world.vertexCount).toBe(10_240);
    expect(world.faceCount).toBe(20_480);
    expect(world.heatFrames).toHaveLength(6);
    expect(world.positions).toHaveLength(world.vertexCount * 3);
    expect(world.faceAdjacency).toHaveLength(world.faceCount * 3);
    expect(world.gradientSamples.length).toBeGreaterThan(200);
    expect(Object.keys(world.targetPresets)).toEqual([
      "exterior",
      "tunnel",
      "farSide",
    ]);
    expect(world.distance[world.sourceVertex]).toBeCloseTo(0, 7);
    expect(Math.max(...world.distance)).toBeGreaterThan(2);
  });

  it("contains a closed genus-one mesh with finite exterior and tunnel normals", () => {
    const world = loadWorld();
    expect([...world.faceAdjacency].every((face) => face >= 0)).toBe(true);
    const edges = new Set<string>();
    for (let face = 0; face < world.faceCount; face += 1) {
      const triangle = [
        world.indices[3 * face]!,
        world.indices[3 * face + 1]!,
        world.indices[3 * face + 2]!,
      ];
      for (let local = 0; local < 3; local += 1) {
        const a = triangle[local]!;
        const b = triangle[(local + 1) % 3]!;
        edges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
      }
    }
    expect(world.vertexCount - edges.size + world.faceCount).toBe(0);
    for (let vertex = 0; vertex < world.vertexCount; vertex += 101) {
      const normal = new THREE.Vector3().fromArray(world.normals, 3 * vertex);
      expect(Number.isFinite(normal.length())).toBe(true);
      expect(normal.length()).toBeCloseTo(1, 4);
    }
    const exterior = new THREE.Vector3().fromArray(
      world.positions,
      3 * world.targetPresets.exterior.vertex,
    );
    const tunnel = new THREE.Vector3().fromArray(
      world.positions,
      3 * world.targetPresets.tunnel.vertex,
    );
    expect(Math.hypot(tunnel.x, tunnel.y)).toBeLessThan(
      Math.hypot(exterior.x, exterior.y),
    );
    const exteriorNormal = new THREE.Vector3().fromArray(
      world.normals,
      3 * world.targetPresets.exterior.vertex,
    );
    const tunnelNormal = new THREE.Vector3().fromArray(
      world.normals,
      3 * world.targetPresets.tunnel.vertex,
    );
    expect(
      exteriorNormal.dot(
        new THREE.Vector3(exterior.x, exterior.y, 0).normalize(),
      ),
    ).toBeGreaterThan(0.8);
    expect(
      tunnelNormal.dot(new THREE.Vector3(tunnel.x, tunnel.y, 0).normalize()),
    ).toBeLessThan(-0.8);
  });

  it("traces the exported field from a far face to the source", () => {
    const world = loadWorld();
    const start = farSurfaceStart(world);
    const path = traceSurfacePath(world, start);
    expect(path.reachedSource).toBe(true);
    expect(path.points.length).toBeGreaterThan(10);
    const source = new THREE.Vector3().fromArray(
      world.positions,
      3 * world.sourceVertex,
    );
    expect(path.points.at(-1)!.distanceTo(source)).toBeLessThan(1e-6);
  });

  it("selects three genuine exported heat states", () => {
    const world = loadWorld();
    const frames = selectHeatInspectionFrames(world);
    expect(frames.map((frame) => frame.frameIndex)).toEqual([0, 3, 5]);
    expect(new Set(frames.map((frame) => frame.frameIndex)).size).toBe(3);
    for (const frame of frames) {
      expect(world.heatFrames[frame.frameIndex]).toBeDefined();
      expect(frame.time).toBe(world.frameTimes[frame.frameIndex]);
    }
  });

  it("measures all three routes from one shared explorer start", () => {
    const world = loadWorld();
    const start = farSurfaceStart(world);
    const routes = buildRouteComparison(world, start);
    const source = new THREE.Vector3().fromArray(
      world.positions,
      3 * world.sourceVertex,
    );
    expect(routes.chord.points[0]!.distanceTo(start.point)).toBeLessThan(1e-9);
    expect(routes.edge.points[0]!.distanceTo(start.point)).toBeLessThan(1e-9);
    expect(routes.heat.points[0]!.distanceTo(start.point)).toBeLessThan(1e-9);
    expect(routes.edge.points.at(-1)!.distanceTo(source)).toBeLessThan(1e-6);
    expect(routes.heat.points.at(-1)!.distanceTo(source)).toBeLessThan(1e-6);
    expect(routes.edge.reachesDestination).toBe(true);
    expect(routes.heat.reachesDestination).toBe(true);
    expect(routes.chord.length).toBeGreaterThan(0);
    expect(routes.heat.length).toBeGreaterThan(routes.chord.length);
    expect(routes.edge.length).toBeGreaterThan(routes.chord.length);
  });

  it("loads native preset routes for the exterior, tunnel, and far side", () => {
    const world = loadWorld();
    const source = new THREE.Vector3().fromArray(
      world.positions,
      3 * world.sourceVertex,
    );
    for (const name of ["exterior", "tunnel", "farSide"] as const) {
      const preset = world.targetPresets[name];
      const routes = buildPresetRouteComparison(world, name);
      expect(preset.vertex).toBeLessThan(world.vertexCount);
      expect(routes.chord.length).toBe(preset.chordLength);
      expect(routes.edge.length).toBe(preset.edgeRouteLength);
      expect(routes.heat.length).toBe(preset.heatRouteLength);
      expect(routes.edge.reachesDestination).toBe(true);
      expect(routes.heat.reachesDestination).toBe(true);
      expect(routes.edge.points.at(-1)!.distanceTo(source)).toBe(0);
      expect(routes.heat.points.at(-1)!.distanceTo(source)).toBe(0);
      expect(routes.heat.length).toBeGreaterThan(routes.chord.length);
      expect(routes.edge.length).toBeGreaterThan(routes.chord.length);
    }
  });
});
