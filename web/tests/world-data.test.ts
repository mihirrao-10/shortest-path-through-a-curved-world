import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { traceSurfacePath } from "../src/path-tracer";
import {
  WorldDataRepository,
  parseWorldBinary,
  parseWorldManifest,
  parseWorldMetadata,
  type RoutePreset,
  type SupportedGenus,
  type WorldData,
} from "../src/world-data";

const DATA_ROOT = new URL("../public/data/worlds/", import.meta.url);

function readJson(url: URL): unknown {
  return JSON.parse(readFileSync(url, "utf8")) as unknown;
}

function readBuffer(url: URL): ArrayBuffer {
  const bytes = readFileSync(url);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function rawManifest(): unknown {
  return readJson(new URL("manifest.json", DATA_ROOT));
}

function loadWorld(genus: SupportedGenus) {
  const data = parseWorldBinary(
    readBuffer(new URL(`genus-${genus}/world.bin`, DATA_ROOT)),
  );
  const metadataValue = readJson(
    new URL(`genus-${genus}/world.meta.json`, DATA_ROOT),
  );
  const metadata = parseWorldMetadata(metadataValue, data);
  return { data, metadata, metadataValue };
}

function routeStart(data: WorldData, preset: RoutePreset) {
  const point = new THREE.Vector3();
  for (let local = 0; local < 3; local += 1) {
    point.addScaledVector(
      new THREE.Vector3().fromArray(
        data.positions,
        3 * data.indices[3 * preset.start.face + local]!,
      ),
      preset.start.barycentric[local]!,
    );
  }
  return { face: preset.start.face, point };
}

function polylineLength(points: readonly THREE.Vector3[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += points[index - 1]!.distanceTo(points[index]!);
  }
  return length;
}

function nativeRoutePoints(
  data: WorldData,
  route: RoutePreset,
): THREE.Vector3[] {
  return Array.from({ length: route.nativePathCount }, (_, index) =>
    new THREE.Vector3().fromArray(
      data.nativeRoutePoints,
      3 * (route.nativePathOffset + index),
    ),
  );
}

describe("multi-world native export", () => {
  it("parses the exact three-world manifest with Genus 2 as default", () => {
    const manifest = parseWorldManifest(rawManifest());
    expect(manifest.defaultGenus).toBe(2);
    expect(manifest.supportedGenera).toEqual([1, 2, 3]);
    expect(manifest.worlds.map((world) => world.genus)).toEqual([1, 2, 3]);
    expect(new Set(manifest.worlds.map((world) => world.vertices)).size).toBe(
      3,
    );
    expect(manifest.worlds.every((world) => world.binaryBytes > 100_000)).toBe(
      true,
    );

    const invalidDefault = structuredClone(rawManifest()) as {
      defaultGenus: number;
    };
    invalidDefault.defaultGenus = 1;
    expect(() => parseWorldManifest(invalidDefault)).toThrow(/default|schema/i);

    const unsupported = structuredClone(rawManifest()) as {
      supportedGenera: number[];
    };
    unsupported.supportedGenera = [1, 2, 4];
    expect(() => parseWorldManifest(unsupported)).toThrow(/supported genera/i);
  });

  it("derives and validates topology for every genus without grid assumptions", () => {
    for (const genus of [1, 2, 3] as const) {
      const { data, metadata } = loadWorld(genus);
      expect(data.version).toBe(3);
      expect(data.heatFrames).toHaveLength(6);
      expect(data.routeCount).toBe(3);
      expect(data.nativeRoutePoints).toHaveLength(data.routePointCount * 3);
      expect(data.gradientSamples.length).toBeGreaterThan(200);
      expect(data.distance[data.sourceVertex]).toBeCloseTo(0, 6);
      expect(data.derivedTopology).toMatchObject({
        connectedComponents: 1,
        boundaryEdges: 0,
        eulerCharacteristic: 2 - 2 * genus,
        recoveredGenus: genus,
      });
      expect(data.derivedTopology.signedVolume).toBeGreaterThan(0);
      expect(metadata.mesh.kind).toBe("implicit-thickened-loop-graph");
      expect(metadata.mesh.genus).toBe(genus);
      expect(metadata.mesh.resolution).toBeGreaterThanOrEqual(28);
      expect(metadata.topology.genus).toBe(genus);
      expect(metadata.quality.minimumAngleDegrees).toBeGreaterThan(10);
      expect(metadata.quality.onePercentileAngleDegrees).toBeGreaterThan(25);
      expect(metadata.quality.maximumAspectRatio).toBeLessThan(8);
    }
  });

  it("uses three authoritative native paths and plausible native measurements", () => {
    for (const genus of [1, 2, 3] as const) {
      const { data, metadata } = loadWorld(genus);
      expect(metadata.routePresets.map((route) => route.id)).toEqual([
        "outer-ridge",
        "central-neck",
        "basin-rim",
      ]);
      expect(
        new Set(metadata.routePresets.map((route) => route.start.face)).size,
      ).toBe(3);
      let expectedOffset = 0;
      for (const route of metadata.routePresets) {
        expect(route.nativePathOffset).toBe(expectedOffset);
        expectedOffset += route.nativePathCount;
        const nativePoints = nativeRoutePoints(data, route);
        expect(nativePoints.length).toBeGreaterThan(3);
        expect(polylineLength(nativePoints)).toBeCloseTo(
          route.tracedHeatMethodRouteLength,
          3,
        );
        expect(route.edgeDijkstraRouteLength).toBeGreaterThan(
          route.ambientChordLength,
        );
        expect(route.tracedHeatMethodRouteLength).toBeGreaterThan(
          route.ambientChordLength,
        );
        expect(route.tracedHeatMethodRouteLength).toBeLessThanOrEqual(
          1.25 * route.edgeDijkstraRouteLength,
        );
        expect(route.tracingReachedSource).toBe(true);
        expect(route.fallbackUsed).toBe(false);

        const browserTrace = traceSurfacePath(data, routeStart(data, route));
        expect(browserTrace.reachedSource).toBe(true);
        const browserLength = polylineLength(browserTrace.points);
        expect(
          Math.abs(browserLength - route.tracedHeatMethodRouteLength) /
            route.tracedHeatMethodRouteLength,
        ).toBeLessThan(0.12);
      }
      expect(expectedOffset).toBe(data.routePointCount);
    }
  });

  it("rejects malformed topology and malformed native path ranges", () => {
    const { data, metadataValue } = loadWorld(2);
    const wrongTopology = structuredClone(metadataValue) as {
      topology: { eulerCharacteristic: number; genus: number };
    };
    wrongTopology.topology.eulerCharacteristic = 0;
    wrongTopology.topology.genus = 1;
    expect(() => parseWorldMetadata(wrongTopology, data)).toThrow(
      /does not match/i,
    );

    const wrongQuality = structuredClone(metadataValue) as {
      quality: { minimumAngleDegrees: number };
    };
    wrongQuality.quality.minimumAngleDegrees += 1;
    expect(() => parseWorldMetadata(wrongQuality, data)).toThrow(
      /does not match/i,
    );

    const wrongRange = structuredClone(metadataValue) as {
      routePresets: Array<{
        nativePathOffset: number;
        nativePathCount: number;
      }>;
    };
    wrongRange.routePresets[1]!.nativePathOffset += 1;
    expect(() => parseWorldMetadata(wrongRange, data)).toThrow(/route preset/i);

    const wrongCount = structuredClone(metadataValue) as {
      routePresets: Array<{
        nativePathOffset: number;
        nativePathCount: number;
      }>;
    };
    wrongCount.routePresets[2]!.nativePathCount = data.routePointCount;
    expect(() => parseWorldMetadata(wrongCount, data)).toThrow(/route preset/i);

    const invalidBinary = readBuffer(new URL("genus-2/world.bin", DATA_ROOT));
    new DataView(invalidBinary).setUint32(36, 4, true);
    expect(() => parseWorldBinary(invalidBinary)).toThrow(/header/i);

    const invalidTopology = readBuffer(new URL("genus-2/world.bin", DATA_ROOT));
    const topologyView = new DataView(invalidTopology);
    const vertexCount = topologyView.getUint32(12, true);
    const faceCount = topologyView.getUint32(16, true);
    const heatFrameCount = topologyView.getUint32(20, true);
    const indexOffset = 56 + 24 * heatFrameCount + 24 * vertexCount;
    topologyView.setUint32(
      indexOffset,
      topologyView.getUint32(indexOffset + 4, true),
      true,
    );
    expect(() => parseWorldBinary(invalidTopology)).toThrow(/triangle|face/i);

    const invalidAdjacency = readBuffer(
      new URL("genus-2/world.bin", DATA_ROOT),
    );
    const adjacencyOffset = indexOffset + 12 * faceCount;
    new DataView(invalidAdjacency).setInt32(adjacencyOffset, 0, true);
    expect(() => parseWorldBinary(invalidAdjacency)).toThrow(/adjacency/i);
  });

  it("loads lazily, caches successful worlds, and retries failed fetches", async () => {
    const manifest = parseWorldManifest(rawManifest());
    const resources = new Map<string, BodyInit>();
    resources.set("/base/data/worlds/manifest.json", JSON.stringify(manifest));
    for (const entry of manifest.worlds) {
      resources.set(
        `/base/data/worlds/${entry.binary}`,
        readFileSync(new URL(entry.binary, DATA_ROOT)),
      );
      resources.set(
        `/base/data/worlds/${entry.metadata}`,
        JSON.stringify(readJson(new URL(entry.metadata, DATA_ROOT))),
      );
    }
    const requests: string[] = [];
    let failGenusOneOnce = true;
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("genus-1/world.bin") && failGenusOneOnce) {
        failGenusOneOnce = false;
        return new Response("temporary failure", { status: 503 });
      }
      const body = resources.get(url);
      return body === undefined
        ? new Response("missing", { status: 404 })
        : new Response(body, { status: 200 });
    };
    const repository = new WorldDataRepository("/base/", fetcher);
    await repository.loadManifest();
    const first = await repository.loadWorld(2);
    const second = await repository.loadWorld(2);
    expect(second).toBe(first);
    expect(first.metadata.mesh.genus).toBe(2);
    expect(
      requests.filter((url) => url.endsWith("manifest.json")),
    ).toHaveLength(1);
    expect(requests.filter((url) => url.includes("genus-2/"))).toHaveLength(2);
    expect(requests.some((url) => url.includes("genus-3/"))).toBe(false);

    await expect(repository.loadWorld(1)).rejects.toThrow(/503/);
    expect(repository.isCached(1)).toBe(false);
    await expect(repository.loadWorld(1)).resolves.toMatchObject({
      metadata: { mesh: { genus: 1 } },
    });
    expect(repository.isCached(1)).toBe(true);
  });
});
