import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { traceSurfacePath } from "../src/path-tracer";
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

describe("engine world export", () => {
  it("parses all binary sections deterministically", () => {
    const world = loadWorld();
    expect(world.version).toBe(1);
    expect(world.vertexCount).toBe(10_242);
    expect(world.faceCount).toBe(20_480);
    expect(world.heatFrames).toHaveLength(6);
    expect(world.positions).toHaveLength(world.vertexCount * 3);
    expect(world.faceAdjacency).toHaveLength(world.faceCount * 3);
    expect(world.gradientSamples.length).toBeGreaterThan(200);
    expect(world.distance[world.sourceVertex]).toBeCloseTo(0, 7);
    expect(Math.max(...world.distance)).toBeGreaterThan(2);
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
