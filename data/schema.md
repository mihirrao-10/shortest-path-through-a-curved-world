# Multi-world data schemas

The C++ exporter writes a manifest and one deterministic native bundle for each supported genus:

    web/public/data/worlds/manifest.json
    web/public/data/worlds/genus-1/world.bin
    web/public/data/worlds/genus-1/world.meta.json
    web/public/data/worlds/genus-2/world.bin
    web/public/data/worlds/genus-2/world.meta.json
    web/public/data/worlds/genus-3/world.bin
    web/public/data/worlds/genus-3/world.meta.json

Fixed CurvedWorldOptions and seed produce byte-identical geometry, fields, route payloads, metadata, and manifest. Machine-dependent timing is kept in a separate benchmark document.

## Manifest v1

manifest.json has schema geodesic-world-manifest-v1 and contains:

- binarySchemaVersion, exactly 3;
- defaultGenus, exactly 2;
- supportedGenera, exactly [1, 2, 3];
- three ordered world entries.

Each entry records genus, concise and accessible labels, relative binary and metadata paths, binary byte size, vertex count, and face count. Paths are relative to the manifest directory and are safe under Vite's GitHub Pages base path.

The browser loads this manifest first, then only the default Genus 2 bundle. Other bundles are fetched on selection and cached after successful validation.

## Binary v3

world.bin is little-endian. Fixed-width integers and IEEE-compatible floating-point arrays are tightly packed with no padding.

### Header

The stream begins with:

1. Eight ASCII bytes containing GEOWRLD3.
2. Eight uint32 values:
   1. schema version, exactly 3;
   2. vertex count V;
   3. face count F;
   4. heat-frame count H;
   5. gradient-sample count G;
   6. source vertex index;
   7. total native route-point count P;
   8. route count R, exactly 3 for public worlds.
3. Mean edge length and Heat Method time step as two float64 values.

### Arrays

The rest of the stream is:

1. H frame times as float64.
2. H heat-frame log minima as float64.
3. H heat-frame log maxima as float64.
4. Vertex positions as 3V float32 values in xyz order.
5. Area-weighted unit vertex normals as 3V float32 values.
6. Triangle indices as 3F uint32 values.
7. Face adjacency as 3F int32 values. Entry 3f+i is the face across the edge opposite local corner i. A boundary would use -1; published worlds contain none.
8. Heat Method distance as V float32 values.
9. Edge-Dijkstra distance as V float32 values.
10. Dijkstra predecessors as V uint32 values. 0xffffffff means no predecessor.
11. H heat frames, each containing V uint16 values. A value linearly quantizes log(u) between that frame's stored minimum and maximum.
12. G gradient samples. Each sample stores one face uint32, three position float32 values, and three normalized direction float32 values.
13. P official native route positions as 3P float32 values. Metadata divides this concatenated array into route ranges.

The binary is authoritative for rendered geometry, topology, fields, heat frames, vector samples, Dijkstra predecessors, and official Heat Method polylines.

## Metadata v3

world.meta.json has schema geodesic-world-v3 and contains:

- title and accessibleLabel;
- mesh generator kind implicit-thickened-loop-graph;
- requested genus, extraction resolution, tube radius, relief, and deterministic seed;
- vertex, edge, and face counts;
- measured center and bounding radius;
- source vertex;
- source label, barycentric SurfacePoint, and approximate world-space anchor;
- topology;
- mesh-quality statistics;
- mean edge length, Heat Method time step, sign convention, boundary policy, and heat encoding;
- heat and Poisson relative residuals and zero-gradient face count;
- three dynamic route presets;
- native solver language, library, precision, and factorization descriptions;
- algorithm and DDG references.

Topology records:

- closed and orientedManifold;
- connectedComponents, exactly 1;
- boundaryEdges, exactly 0;
- derived Euler characteristic;
- recovered genus;
- positive signed volume.

For a connected closed orientable mesh, the parser requires

    chi = V - E + F = 2 - 2g.

It derives V, E, F, components, boundary incidence, orientation, signed volume, and genus from the binary triangle payload before comparing metadata. It does not accept genus as an unverified label.

Quality records minimum triangle angle, one-percentile angle, maximum aspect ratio, and minimum face area. All must be finite and remain inside conservative native and browser thresholds.

### Surface points

A SurfacePoint stores:

- face, a valid triangle index;
- barycentric, three finite weights in [0, 1] whose sum is one.

The source landmark and all route starts use this genus-independent representation. No toroidal parameter coordinates or rectangular grid indices are part of schema v3.

### Route presets

Each route preset contains:

- dynamic stable ID, label, and concise description;
- start SurfacePoint;
- nearest Dijkstra start vertex;
- ambient chord length;
- edge-Dijkstra route length;
- traced Heat Method route length;
- tracingReachedSource, required true;
- fallbackUsed, required false;
- nativePathOffset and nativePathCount into the binary route array.

Offsets must be contiguous, begin at zero, and exactly cover all P route points. Every count is at least four. The browser verifies that the first native point matches the barycentric start, the last reaches the source, and the measured polyline length agrees with metadata within storage tolerance.

All measurements must be finite and positive. Both legal surface routes must exceed the ambient chord. The native Heat trace must remain within the exporter's conservative ratio to the Dijkstra baseline.

## Browser validation

web/src/world-data.ts rejects:

- unsupported manifest, magic, or schema versions;
- missing, reordered, duplicated, or unsupported genera;
- unsafe paths and inconsistent manifest counts or byte sizes;
- truncated or trailing binary data;
- invalid indices, adjacency, predecessors, normals, fields, or source;
- duplicate or zero-area faces;
- edge incidence other than exactly two;
- inconsistent shared-edge orientation;
- more than one face component or any boundary;
- Euler characteristic or genus disagreement;
- non-positive signed volume;
- invalid SurfacePoints;
- malformed, overlapping, gapped, or incomplete native-path ranges;
- native path endpoints or lengths that disagree with metadata;
- metadata counts, topology, quality, residuals, or mesh kind that disagree with the binary contract.

The browser face tracer is retained as a numerical cross-check. Three.js displays the native route payload.

## Benchmark v3

data/benchmarks.cpu.json and its public copy use geodesic-benchmark-v3. The document records:

- worldGenus, exactly 2;
- steady clock and float64 precision;
- host, compiler, and Release build type;
- one warm-up query;
- reused-source count;
- Dijkstra repetition count;
- a resolution sequence.

Each case stores resolution, vertex and face counts, heat and Poisson residuals, and measured milliseconds for:

- mesh generation;
- operator assembly;
- sparse factorization;
- total preprocessing;
- one Heat Method query;
- the mean query after reusing factors for distributed sources;
- repeated edge Dijkstra.

Benchmark timing is deliberately separate from deterministic world metadata. It profiles this implementation on the stated machine and does not imply that Dijkstra and the Heat Method solve identical problems.

## Version policy

Schema v3 deliberately replaces the obsolete single-torus v2 layout. There is no compatibility parser because the checked-in site and generated assets advance together, and retaining it would preserve incorrect fixed-grid and genus-one assumptions.
