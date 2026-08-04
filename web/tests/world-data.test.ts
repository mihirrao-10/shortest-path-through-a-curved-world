import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { traceSurfacePath } from "../src/path-tracer";
import {
  parseWorldBinary,
  parseWorldMetadata,
  type RoutePreset,
} from "../src/world-data";

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

function loadMetadata(world: ReturnType<typeof loadWorld>) {
  const value = loadRawMetadata();
  return parseWorldMetadata(value, world);
}

function loadRawMetadata(): unknown {
  return JSON.parse(
    readFileSync(
      new URL("../public/data/world.meta.json", import.meta.url),
      "utf8",
    ),
  ) as unknown;
}

function routeStart(world: ReturnType<typeof loadWorld>, preset: RoutePreset) {
  const point = new THREE.Vector3();
  for (let local = 0; local < 3; local += 1) {
    point.addScaledVector(
      new THREE.Vector3().fromArray(
        world.positions,
        3 * world.indices[3 * preset.startFace + local]!,
      ),
      preset.startBarycentric[local]!,
    );
  }
  return { face: preset.startFace, point };
}

function polylineLength(points: readonly THREE.Vector3[]) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += points[index - 1]!.distanceTo(points[index]!);
  }
  return length;
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
    expect(world.distance[world.sourceVertex]).toBeCloseTo(0, 7);
    expect(Math.max(...world.distance)).toBeGreaterThan(2);
  });

  it("rejects stale or semantically inconsistent schema data", () => {
    const world = loadWorld();
    const stale = structuredClone(loadRawMetadata()) as Record<string, unknown>;
    stale.schema = "geodesic-world-v1";
    expect(() => parseWorldMetadata(stale, world)).toThrow();

    const wrongTopology = structuredClone(loadRawMetadata()) as {
      topology: { genus: number };
    };
    wrongTopology.topology.genus = 0;
    expect(() => parseWorldMetadata(wrongTopology, world)).toThrow();

    const wrongCounts = structuredClone(loadRawMetadata()) as {
      mesh: { majorSegments: number };
    };
    wrongCounts.mesh.majorSegments -= 1;
    expect(() => parseWorldMetadata(wrongCounts, world)).toThrow();

    const bytes = readFileSync(
      new URL("../public/data/world.bin", import.meta.url),
    );
    const invalidHeader = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    new DataView(invalidHeader).setUint32(32, 1, true);
    expect(() => parseWorldBinary(invalidHeader)).toThrow();
  });

  it("contains the deterministic closed asymmetric torus", () => {
    const world = loadWorld();
    const metadata = loadMetadata(world);
    expect([...world.faceAdjacency].every((face) => face >= 0)).toBe(true);
    const radialDistances: number[] = [];
    const minimum = new THREE.Vector3(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    );
    const maximum = new THREE.Vector3(
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    );
    for (let vertex = 0; vertex < world.vertexCount; vertex += 1) {
      const point = new THREE.Vector3().fromArray(world.positions, 3 * vertex);
      radialDistances.push(Math.hypot(point.x, point.y));
      minimum.min(point);
      maximum.max(point);
    }
    expect(Math.min(...radialDistances)).toBeGreaterThan(0.7);
    expect(Math.max(...radialDistances)).toBeGreaterThan(1.7);
    const extents = maximum.sub(minimum).toArray();
    expect(extents[0]).toBeGreaterThan(3.3);
    expect(extents[1]).toBeGreaterThan(3.3);
    expect(extents[2]).toBeGreaterThan(0.9);
    expect(metadata.mesh.kind).toBe("procedural-torus");
    expect(metadata.mesh.majorSegments * metadata.mesh.minorSegments).toBe(
      world.vertexCount,
    );
    expect(metadata.topology).toMatchObject({
      closed: true,
      orientedManifold: true,
      boundaryEdges: 0,
      eulerCharacteristic: 0,
      genus: 1,
    });
    expect(metadata.quality.minimumAngleDegrees).toBeGreaterThan(20);
    expect(metadata.quality.maximumAspectRatio).toBeLessThan(3);
  });

  it("validates three real barycentric route presets against the shared fields", () => {
    const world = loadWorld();
    const metadata = loadMetadata(world);
    expect(metadata.routePresets.map((preset) => preset.id)).toEqual([
      "ridge-crossing",
      "inner-saddle-pass",
      "basin-rim",
    ]);
    expect(
      new Set(metadata.routePresets.map((preset) => preset.startFace)).size,
    ).toBe(3);
    const tracedLengths: number[] = [];
    const starts: THREE.Vector3[] = [];
    for (const preset of metadata.routePresets) {
      const start = routeStart(world, preset);
      starts.push(start.point);
      const traced = traceSurfacePath(world, start);
      const length = polylineLength(traced.points);
      tracedLengths.push(length);
      expect(traced.faces).toHaveLength(traced.points.length);
      expect(traced.reachedSource).toBe(true);
      expect(traced.usedFallback).toBe(false);
      expect(length).toBeCloseTo(preset.tracedHeatMethodRouteLength, 3);

      const source = new THREE.Vector3().fromArray(
        world.positions,
        3 * world.sourceVertex,
      );
      expect(start.point.distanceTo(source)).toBeCloseTo(
        preset.ambientChordLength,
        4,
      );
      let edgeLength = start.point.distanceTo(
        new THREE.Vector3().fromArray(
          world.positions,
          3 * preset.dijkstraStartVertex,
        ),
      );
      let current = preset.dijkstraStartVertex;
      for (let step = 0; step <= world.vertexCount; step += 1) {
        if (current === world.sourceVertex) break;
        const next = world.dijkstraPredecessor[current]!;
        expect(next).not.toBe(0xffffffff);
        edgeLength += new THREE.Vector3()
          .fromArray(world.positions, 3 * current)
          .distanceTo(new THREE.Vector3().fromArray(world.positions, 3 * next));
        current = next;
      }
      expect(current).toBe(world.sourceVertex);
      expect(edgeLength).toBeCloseTo(preset.edgeDijkstraRouteLength, 3);
      expect(preset.edgeDijkstraRouteLength).toBeGreaterThan(
        preset.ambientChordLength,
      );
      expect(preset.tracedHeatMethodRouteLength).toBeGreaterThan(
        preset.ambientChordLength,
      );
      expect(preset.tracedHeatMethodRouteLength).toBeLessThanOrEqual(
        1.25 * preset.edgeDijkstraRouteLength,
      );
      expect(preset.tracingReachedSource).toBe(true);
      expect(preset.fallbackUsed).toBe(false);
    }
    for (let first = 0; first < starts.length; first += 1) {
      for (let second = first + 1; second < starts.length; second += 1) {
        expect(starts[first]!.distanceTo(starts[second]!)).toBeGreaterThan(0.7);
        expect(
          Math.abs(tracedLengths[first]! - tracedLengths[second]!),
        ).toBeGreaterThan(0.04);
      }
    }
    expect(metadata.solver.language).toBe("C++20");
    expect(metadata.solver.library).toContain("Eigen");
  });

  it("traces the exported field from a far face to the source", () => {
    const world = loadWorld();
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
    const path = traceSurfacePath(world, { face: farFace, point });
    expect(path.reachedSource).toBe(true);
    expect(path.points.length).toBeGreaterThan(10);
    const source = new THREE.Vector3().fromArray(
      world.positions,
      3 * world.sourceVertex,
    );
    expect(path.points.at(-1)!.distanceTo(source)).toBeLessThan(1e-6);
  });
});
