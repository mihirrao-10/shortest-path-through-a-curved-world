# Export schemas

The website consumes data written by the C++20 engine. Version 2 keeps the binary compact while adding genus-one topology metadata, named target landmarks, and native traced preset routes.

## `world.bin`

All numeric values are little endian. The file starts with the eight-byte ASCII magic `GEOWRLD2`.

### Header

| Field | Type | Count |
| --- | --- | ---: |
| schema version | `uint32` | 1 |
| vertex count | `uint32` | 1 |
| face count | `uint32` | 1 |
| heat-frame count | `uint32` | 1 |
| gradient-sample count | `uint32` | 1 |
| source vertex | `uint32` | 1 |
| target-preset count | `uint32` | 1 |
| mean edge length | `float64` | 1 |
| Heat Method time step | `float64` | 1 |
| target vertices | `uint32` | preset count |
| heat-frame times | `float64` | frame count |
| per-frame logarithmic minima | `float64` | frame count |
| per-frame logarithmic maxima | `float64` | frame count |

Target order is `exterior`, `tunnel`, then `farSide`.

### Mesh and fields

| Field | Type | Count |
| --- | --- | ---: |
| positions | `float32` | vertex count × 3 |
| normals | `float32` | vertex count × 3 |
| oriented triangle indices | `uint32` | face count × 3 |
| adjacent face across each opposite edge | `int32` | face count × 3 |
| Heat Method distance | `float32` | vertex count |
| edge-Dijkstra distance | `float32` | vertex count |
| Dijkstra predecessor | `uint32` | vertex count |
| logarithmic heat frames | `uint16` | frame count × vertex count |

Each heat frame stores `log(u)` linearly quantized between its exported minimum and maximum.

### Gradient samples

Each sample stores:

| Field | Type | Count |
| --- | --- | ---: |
| face index | `uint32` | 1 |
| lifted face-centroid position | `float32` | 3 |
| normalized direction | `float32` | 3 |

### Native preset routes

One route record follows for each target preset:

| Field | Type | Count |
| --- | --- | ---: |
| preset kind | `uint32` | 1 |
| target vertex | `uint32` | 1 |
| Heat-path point count | `uint32` | 1 |
| edge-path vertex count | `uint32` | 1 |
| ambient chord length | `float64` | 1 |
| Heat-path polyline length | `float64` | 1 |
| edge-path length | `float64` | 1 |
| Heat-path points | `float32` | point count × 3 |
| edge-path vertex indices | `uint32` | edge count |

These records are traced and measured by the native exporter. Pointer-selected targets in the browser use the same exported distance and predecessor fields for interactive presentation.

## `world.meta.json`

Schema `geodesic-world-v2` records:

- deterministic seed and detail level
- mesh counts and source vertex
- closed, oriented-manifold, Euler-characteristic, and genus assertions
- named target vertices and their three native route lengths
- mean edge length and Heat Method time step
- operator sign, boundary convention, and heat encoding
- heat and Poisson residuals
- zero-gradient face count
- operator assembly, factorization, preprocessing, solve, and Dijkstra timings
- C++ engine description and primary reference

There is no environment-availability object because the project has one intentional C++ CPU architecture.

## `benchmarks.json`

Schema `geodesic-benchmark-v2` records the clock, precision, host label, compiler, build type, one warmup query, eight reused source queries, Dijkstra repetitions, and a list of cases.

Each case contains:

- detail level, vertices, and faces
- procedural mesh-construction milliseconds
- operator-assembly milliseconds
- sparse-factorization milliseconds
- total preprocessing milliseconds
- one full Heat Method query in milliseconds
- mean milliseconds across eight different sources with one solver and reused factors
- mean edge-Dijkstra query milliseconds
- heat and Poisson relative residuals

The repeated-source field documents factor reuse. Consumers must not reinterpret it as a speedup without a supported comparison.
