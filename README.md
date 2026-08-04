# The Shortest Path Through a Curved World

**A C++ Heat Method Geodesic Solver on Triangle Meshes**

A C++20 implementation of the Heat Method that constructs discrete surface operators, reuses sparse factorizations, traces geodesics across triangle faces, and exports real numerical fields to an interactive Three.js explanation.

The numerical and geometry engine is a focused CPU implementation. TypeScript and Three.js form the presentation layer and consume data produced by the native exporter.

## What is implemented

- Oriented halfedge triangle meshes with twins, edges, face cycles, incidence, adjacency, and boundary queries
- Deterministic closed genus-one world generation with a broad visible tunnel
- Finite face and vertex normals on both the exterior and inner tunnel
- Lumped mass and cotangent stiffness matrices
- Heat Method diffusion, normalized face gradients, and pinned Poisson reconstruction
- Reusable Eigen sparse factorizations for repeated source queries
- Direct and iterative CPU solvers with true relative residuals
- Edge-weighted Dijkstra as a graph-distance baseline
- Face-by-face distance-gradient path tracing with guarded fallback behavior
- Versioned binary export of geometry, adjacency, fields, landmarks, predecessors, gradients, and native preset routes
- Interactive Three.js rendering with route, field, heat-frame, and target controls
- A concise opening followed by freely linkable Geometry, Heat Method, and C++ Engine branches
- Native correctness tests, browser unit tests, responsive end-to-end tests, link validation, and deterministic benchmarks

## Build and test

The native project requires a C++20 compiler, CMake 3.22 or newer, and Eigen 3.4. If Eigen is not installed, CMake fetches the pinned 3.4.0 release.

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure
```

The CMake project language is C++ only. The main targets are:

- `geodesic_core`: mesh, operators, solvers, paths, procedural geometry, and I/O
- `geodesic_cli`: generation, solving, path export, and web-data export
- `geodesic_tests`: native correctness coverage
- `geodesic_benchmark`: measured CPU benchmark generation

## CLI

```sh
# Generate the detail-5 handle-bearing world.
./build/geodesic_cli generate --detail 5 --output curved-world.obj

# Solve a loaded triangle mesh with the Heat Method.
./build/geodesic_cli solve \
  --mesh curved-world.obj \
  --source 0 \
  --method heat \
  --output distance.csv

# Run the edge-graph baseline.
./build/geodesic_cli solve \
  --mesh curved-world.obj \
  --source 0 \
  --method dijkstra \
  --output edge-distance.csv

# Trace a surface path and write an OBJ polyline.
./build/geodesic_cli path \
  --mesh curved-world.obj \
  --source 0 \
  --start 100 \
  --output path.obj

# Regenerate the browser payload.
./build/geodesic_cli export-web \
  --detail 5 \
  --output web/public/data
```

## Numerical method

The implementation uses a symmetric positive semidefinite stiffness matrix (L\approx-\Delta) and diagonal lumped mass matrix (M).

1. Diffuse a unit source impulse for (t=h^2):

   \[
   (M+tL)u=M\delta.
   \]

2. Normalize the negative piecewise linear heat gradient on each face:

   \[
   X=-\frac{\nabla u}{\lVert\nabla u\rVert}.
   \]

3. Reconstruct a scalar field using the weak divergence load:

   \[
   L\phi=b_X,
   \qquad
   (b_X)_i=\sum_f A_f\,\nabla b_i\cdot X_f.
   \]

The Poisson system has a constant nullspace. Vertex zero is pinned during factorization, then the solution is shifted so the selected source has distance zero.

The heat and pinned Poisson matrices depend on the mesh and time step, not the source. Their direct sparse factorizations are therefore reused across source queries.

## Genus-one curved world

`native/src/procedural.cpp` samples periodic major and minor parameters. Detail level 5 uses 160 major segments and 64 minor segments, yielding 10,240 vertices and 20,480 triangles. Smooth low-frequency radial, vertical, tube-scale, and tangential terms deform the torus while preserving a broad hole.

Triangles use one consistent periodic winding. The inner tunnel normals therefore point into the hole, as required for the exterior orientation of a torus. The generated mesh has:

- no boundary
- Euler characteristic (V-E+F=0)
- genus (g=1)
- positive triangle areas
- finite normals
- deterministic source, exterior, tunnel, and far-side landmarks selected by geometric criteria

Native tests solve on this exact topology and require exterior and tunnel paths to reach the source.

## Distance comparisons

The website compares three quantities for shared endpoints:

- The ambient chord is a Euclidean line through surrounding space and is not constrained to the surface.
- Edge Dijkstra is exact for the weighted mesh-edge graph.
- The Heat Method reconstructs an approximate intrinsic distance field and traces a route across triangle faces.

The displayed preset lengths are exported from the C++ engine. The Heat path is approximate, so its sampled polyline is not presented as an exact geodesic or guaranteed to be shorter than the graph route at every resolution.

## Deterministic benchmark

Generate both native data products with:

```sh
GEODESIC_BENCHMARK_HOST="descriptive host label" \
  bash scripts/export-web-data.sh
```

The script builds the native tools, regenerates `world.bin` and `world.meta.json`, measures the benchmark, writes `data/benchmarks.json`, and copies the benchmark into `web/public/data/benchmarks.json`.

Benchmark schema `geodesic-benchmark-v2` reports:

- procedural mesh construction time
- operator assembly time
- sparse factorization time
- total preprocessing time
- one complete Heat Method query
- mean time across eight different source vertices using one solver and the same factors
- edge Dijkstra query time
- heat and Poisson relative residuals

The generated file contains measured release-build results. No speedup is inferred from the repeated-query measurements.

## Web application

```sh
cd web
npm ci
npm run format
npm run lint
npm test
npm run build
npm run test:e2e
```

The page remains black from the opening through Under the Hood and the footer. Desktop uses a 51 to 52 percent fixed world stage. Mobile uses a 39 to 40 percent viewport-height stage with horizontally scrollable controls.

The short opening covers arrival, the invalid ambient line, diffusion, and distance reconstruction. The exploration map then offers three independent branches:

- Geometry: intrinsic distance, chord, edge route, Heat route, comparison, and topology
- Heat Method: diffusion, heat frames, gradients, directions, Poisson, path tracing, and limitations
- C++ Engine: halfedges, operators, factorization, reuse, solvers, benchmarks, and browser export

Each node has a meaningful hash, normal browser history behavior, a Back to map link, a suggested next action, and subtle visited state. All controls use native buttons and selected-state attributes.

## Export schemas

See [`data/schema.md`](data/schema.md) for the complete binary and JSON layouts. Schema version 2 adds genus-one topology, named landmarks, and native route records, and uses the neutral benchmark filename.

## Correctness coverage

Native tests cover:

- halfedge, manifold, adjacency, and boundary invariants
- areas, face normals, vertex normals, cotangent operators, symmetry, row sums, and positive mass
- deterministic direct solves and true residuals
- direct versus iterative CPU agreement
- planar distance behavior and curved-surface distance behavior
- edge Dijkstra predecessor termination
- face-by-face path termination
- malformed orientation and degenerate triangles
- genus-one Euler characteristic, no boundary, open tunnel radius, bounded triangle aspect, positive areas, finite normals, valid landmarks, converged solves, and exterior and tunnel paths

Browser tests cover binary parsing, topology, native preset routes, heat frames, responsive layout, low background luminance, text contrast, branch hashes and history, visited state, keyboard input, every route and field layer, target presets, reset, pointer placement, reduced motion, loading, and fallback states.

## Repository map

```text
CMakeLists.txt                 C++20 targets and warning configuration
native/include/geodesic/      Public mesh, operator, solver, path, and I/O interfaces
native/src/                   CPU geometry and numerical implementation
native/tests/                 Native correctness suite
native/benchmarks/            Deterministic measured benchmark
data/                         Benchmark JSON and schema documentation
scripts/                      Native export and validation utilities
web/src/                      Three.js presentation, controls, parsing, and path display
web/tests/                    Export and geometry unit tests
web/e2e/                      Responsive interaction and visual regressions
.github/workflows/            Native, web, link, and Pages validation
docs/                         Course map and interview guide
```

## Limitations

- The Heat Method converges under refinement but is not an exact polyhedral geodesic algorithm.
- Cotangent weights can be negative on obtuse triangles.
- Diffusion time (t=h^2) is a practical global choice, not an adaptive local scale.
- Path extraction inherits error from the reconstructed field and can encounter critical points or cut loci.
- The monotone vertex fallback favors termination over a perfectly smooth final segment.
- Edge Dijkstra measures graph distance, not continuous surface distance.
- The benchmark is one measured host and does not establish multicore scaling, vectorization, or parallel speedup.
- The browser supports interaction with an exported field. It does not rerun the C++ sparse solver.

## References

1. Keenan Crane, Clarisse Weischedel, and Max Wardetzky. [Geodesics in Heat: A New Approach to Computing Distance Based on Heat Flow](https://www.cs.cmu.edu/~kmcrane/Projects/HeatMethod/paperTOG.pdf). ACM Transactions on Graphics 32(5), 2013.
2. Keenan Crane. [Discrete Differential Geometry: An Applied Introduction](https://www.cs.cmu.edu/~kmcrane/Projects/DDG/).
3. Eigen project. [Sparse linear algebra documentation](https://eigen.tuxfamily.org/dox/group__Sparse__chapter.html).
