# `geodesic-world-v2` data schema

The native C++ exporter writes `web/public/data/world.bin` and `world.meta.json`. Both files are deterministic for fixed torus options and a fixed seed. The browser validates the two files together before rendering.

## Binary byte order and primitives

`world.bin` is little-endian. Integer and floating-point values use IEEE-compatible fixed-width types named below. Arrays are tightly packed with no padding.

## Binary layout

The byte stream contains, in order:

1. Eight ASCII bytes containing `GEOWRLD2`.
2. Seven `uint32` values:
   1. schema version, exactly `2`;
   2. vertex count (V);
   3. face count (F);
   4. heat-frame count (H);
   5. gradient-sample count (G);
   6. source vertex index;
   7. reserved value, exactly zero.
3. Mean edge length and Heat Method time step as two `float64` values.
4. (H) frame times, (H) log minima, and (H) log maxima as `float64` arrays.
5. Vertex positions as `3V` `float32` values in xyz order.
6. Area-weighted unit vertex normals as `3V` `float32` values in xyz order.
7. Triangle indices as `3F` `uint32` values.
8. Face adjacency as `3F` `int32` values. Entry (3f+i) names the face across the edge opposite local corner (i). A boundary would use `-1`; the public torus contains none.
9. Heat Method distance as (V) `float32` values.
10. Edge-Dijkstra distance as (V) `float32` values.
11. Dijkstra predecessors as (V) `uint32` values. `0xffffffff` means no predecessor.
12. (H) heat frames, each containing (V) `uint16` values. The stored value linearly quantizes `log(u)` between that frame's log minimum and maximum.
13. (G) gradient samples. Each sample contains one face `uint32`, three position `float32` values, and three normalized direction `float32` values.

The browser rejects an unsupported magic or version, a nonzero reserved word, inconsistent lengths, out-of-range indices, invalid adjacency, non-finite geometry or fields, an invalid source, and a nonzero source distance outside tolerance.

## Metadata layout

`world.meta.json` has `schema: "geodesic-world-v2"` and contains:

- `title` and `deterministicSeed`;
- `mesh`, with kind `procedural-torus`, major and minor segment counts, radii, and relief;
- binary `vertices`, `faces`, and `sourceVertex` counts;
- `source`, with the native vertex and authored periodic coordinates (u,v);
- `topology`, requiring a closed oriented manifold, zero boundary edges, Euler characteristic zero, and genus one;
- `quality`, with measured minimum triangle angle and maximum aspect ratio;
- mean edge length, Heat Method time step, sign convention, boundary policy, and heat encoding;
- true relative residuals for the heat and Poisson systems plus the zero-gradient face count;
- three native-authored route presets;
- CPU solver language, library, precision, direct method, and iterative method;
- the primary algorithm reference.

Each route preset stores:

- stable ID, label, and factual description;
- start face and three barycentric weights;
- nearest Dijkstra start vertex;
- ambient chord, edge-Dijkstra route, and traced Heat Method route lengths;
- a successful native trace flag;
- a recovery flag that must be false for a published route.

The parser requires the segment counts to imply exactly (V=nm) and (F=2nm), the three route starts and rounded measurements to be distinct, every route length to be finite and positive, each surface length to exceed its ambient chord, and each Heat trace to remain within the exporter's conservative ratio to its edge baseline.

## Benchmark schema

`data/benchmarks.cpu.json` and its public copy use `geodesic-benchmark-v2`. The document records the steady clock, floating-point precision, host description, compiler, build type, warm-up count, reused-source count, and Dijkstra repetition count.

Each case stores torus resolution and counts, then measured times for:

- mesh generation;
- operator assembly;
- sparse factorization;
- total preprocessing;
- one Heat Method query;
- the mean Heat Method query after reusing factors for distributed sources;
- one repeated edge-Dijkstra query.

Each case also stores the heat and Poisson relative residuals. Timing is deliberately separate from `world.meta.json`, keeping the primary world export deterministic across machines.
