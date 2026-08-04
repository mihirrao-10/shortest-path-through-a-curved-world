# The Shortest Path Through a Curved World

A C++20 CPU implementation of the Heat Method for geodesic distance on triangle meshes, paired with a static Three.js explanation on a genuine toroidal surface.

- Live project: <https://mihirrao-10.github.io/shortest-path-through-a-curved-world/>
- Method: [Crane, Weischedel, and Wardetzky, *Geodesics in Heat*](https://www.cs.cmu.edu/~kmcrane/Projects/HeatMethod/paperTOG.pdf)
- Mathematical background: [Crane, *Discrete Differential Geometry: An Applied Introduction*](https://www.cs.cmu.edu/~kmcrane/Projects/DDG/paper.pdf)

The browser does not invent the world or its measurements. The native engine generates the mesh, validates its topology, solves the sparse systems, traces the routes, and exports the numerical state consumed by the site.

## What is implemented

- A periodic torus generator with wrapped indexing in both parameter directions
- Smooth asymmetric relief, including an outer ridge, a basin and rim, unequal tube thickness, and a saddle-like inner throat
- An oriented halfedge triangle mesh with manifold, incidence, and boundary validation
- Face areas and normals, area-weighted vertex normals, edge lengths, and degeneracy checks
- Lumped barycentric mass and cotangent stiffness matrices
- Piecewise-linear face gradients and a weak divergence load
- Direct and iterative Eigen sparse solve paths on CPU
- Reusable preprocessing and factorizations for repeated source queries
- True relative residual reporting for the heat and Poisson systems
- Edge-weighted Dijkstra with predecessor reconstruction
- Native path tracing across face interiors through barycentric edge crossings
- Three deterministic, native-authored route presets sharing one source and one Heat Method field
- A deterministic binary and JSON export for the static website
- TypeScript validation, browser path reconstruction, Three.js rendering, and accessible KaTeX notation
- Native, Vitest, and Playwright test suites

The refined icosphere generator remains available only as a numerical test fixture. The published curved world is the periodic genus-one torus.

## Build and test

Requirements are CMake 3.22 or newer, a C++20 compiler, and Eigen 3.4. If Eigen is not installed, CMake fetches the pinned Eigen 3.4.0 archive.

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure
```

Build and check the static site:

```sh
cd web
npm ci
npm run check
npm run test:e2e
```

Vite uses the GitHub Pages base path `/shortest-path-through-a-curved-world/`.

## Command-line tools

Generate the default torus as OBJ:

```sh
./build/geodesic_cli generate \
  --major-segments 160 \
  --minor-segments 64 \
  --major-radius 1.28 \
  --minor-radius 0.46 \
  --relief 0.18 \
  --seed 1592594996 \
  --output curved-torus.obj
```

Solve a field on any supported OBJ mesh:

```sh
./build/geodesic_cli solve \
  --mesh curved-torus.obj \
  --source 9209 \
  --method heat \
  --output heat-distance.csv

./build/geodesic_cli solve \
  --mesh curved-torus.obj \
  --source 9209 \
  --method dijkstra \
  --output graph-distance.csv
```

Trace a Heat Method path from a mesh vertex:

```sh
./build/geodesic_cli path \
  --mesh curved-torus.obj \
  --source 9209 \
  --start 1669 \
  --output route.obj
```

Regenerate the exact checked-in web data and CPU benchmark:

```sh
GEODESIC_BENCHMARK_HOST="Apple M4 (10-core) MacBook Pro, 16 GB, macOS 26.5" \
  ./scripts/export-web-data.sh
```

The script performs a Release build, runs the native exporter with explicit torus parameters, benchmarks a fixed resolution sequence, and copies the benchmark JSON into the public data directory.

## Toroidal mesh

For periodic angles (u,v\in[0,2\pi)), the undeformed reference surface is

\[
p(u,v)=\big((R+r\cos v)\cos u,\ (R+r\cos v)\sin u,\ r\sin v\big).
\]

The implementation stores one vertex for every pair of periodic grid indices. It never duplicates either seam. Every wrapped quad is split with the same analytic orientation, so winding does not depend on a face normal dotted with a vector from the origin. That origin-based rule would fail on the inner side of a torus.

The default (160\times64) grid has 10,240 vertices and 20,480 triangular faces. Native validation confirms:

- every undirected edge belongs to exactly two faces;
- shared edges have opposite directed orientation;
- there are no boundary edges or degenerate faces;
- (V-E+F=0), hence the closed orientable mesh has genus one;
- normals and areas are finite;
- the minimum triangle angle and maximum aspect ratio remain within conservative limits;
- the central hole retains a positive clearance;
- a fixed seed produces byte-identical geometry and metadata.

All relief terms use periodic functions or wrapped angular distances. Their scale is deliberately broad relative to the triangles, which avoids corrugation and unstable cotangent weights.

## Heat Method convention

Let (M\) be the diagonal lumped mass matrix and (L\) the symmetric positive-semidefinite stiffness matrix that approximates (-\Delta). For a source impulse \(\delta\), the native solver performs

\[
(M+tL)u=M\delta,
\qquad
X=-\frac{\nabla u}{\lVert\nabla u\rVert},
\qquad
L\phi=b_X.
\]

The time step is (t=h^2), where (h) is mean edge length. The first system diffuses a brief impulse. The normalized negative heat gradient points approximately in the direction of increasing distance. The weak Poisson solve reconstructs the scalar field whose gradient best agrees with those facewise directions.

The stiffness matrix has a one-dimensional constant nullspace on this connected closed mesh. The implementation factors a copy with one reference degree of freedom pinned, solves it, then shifts the result so the source distance is zero.

For an interior edge (ij), the familiar weight is

\[
w_{ij}=\tfrac12(\cot\alpha_{ij}+\cot\beta_{ij}),
\]

where the two angles are opposite the edge. The code assembles equivalent local triangle energy contributions, preserving symmetry and zero row sums.

## Solver and path design

`HeatMethodSolver` separates mesh-dependent work from source-dependent work:

1. assemble (M), (L), face bases, and mean edge length;
2. factor (M+tL);
3. factor the pinned Poisson matrix;
4. reuse both factors for later source right-hand sides.

The direct path uses `Eigen::SimplicialLDLT`. The iterative path uses conjugate gradient with incomplete Cholesky. Both calculate the true relative residual

\[
\frac{\lVert Ax-b\rVert_2}{\max(\lVert b\rVert_2,10^{-30})}.
\]

Distance is piecewise linear, so its gradient is constant within a face. Starting from a barycentric surface point, the tracer follows decreasing distance, computes which barycentric coordinate reaches zero first, crosses the corresponding halfedge twin, and continues toward the source. It detects critical points, repeated faces, invalid barycentric states, boundaries, and step limits. The general tracer retains a guarded monotone one-ring recovery, but every published route is rejected if that recovery is needed.

## Authored routes and three distance problems

The public export contains `ridge-crossing`, `inner-saddle-pass`, and `basin-rim`. Each start is a native-authored face and barycentric coordinate tied to toroidal parameter space. The source is also selected by a fixed toroidal coordinate rather than by direction from the origin.

Each preset reports three measured quantities with different admissible domains:

- Ambient chord: the straight segment may move anywhere in 3D.
- Edge Dijkstra: the route may move only along mesh edges.
- Heat trace: the route crosses triangle interiors on the triangulated surface.

The exporter requires every route to reach the source without recovery, remain distinct from the other presets, have finite measurements, exceed its ambient chord, and stay within a conservative ratio of its edge-graph baseline.

## Web export

`web/public/data/world.bin` contains indexed geometry, normals, face adjacency, six real heat states, Heat Method distance, Dijkstra distance and predecessors, normalized gradient samples, and the shared source index. `world.meta.json` records torus parameters, topology, quality statistics, solver conventions, residuals, and route measurements.

Schema version 2 is documented in [`data/schema.md`](data/schema.md). Export metadata omits machine-dependent solve timing so a fixed configuration stays deterministic. Benchmark timing lives in a separate measured file.

The browser validates counts and invariants before constructing the scene. It traces the exported distance field independently for display, requires every browser trace to reach the source, and presents the native-authored measurements. Three.js only renders the supplied geometry. It does not replace it with a built-in torus primitive.

## CPU benchmark methodology

`geodesic_benchmark` uses a Release build, `std::chrono::steady_clock`, double precision, one warm-up query, eight distributed reusable sources, and seven measured Dijkstra runs. It reports mesh generation, operator assembly, factorization, total preprocessing, one Heat Method query, the mean of reused Heat Method queries, Dijkstra query time, and both solve residuals.

The checked-in [`data/benchmarks.cpu.json`](data/benchmarks.cpu.json) is the canonical result. Its host, compiler, build type, repetitions, and mesh sizes are stored beside the measurements. These values are not presented as a universal speed comparison. Dijkstra solves an edge-graph problem, while the Heat Method reconstructs a scalar field across the surface. Factorization is most useful when many sources share one mesh.

## Validation

Native tests cover:

- periodic seam closure and expected torus counts;
- valid indices, finite geometry, nondegenerate faces, and triangle quality;
- closed manifold incidence, orientation, no boundary, Euler characteristic zero, and genus one;
- deterministic generation, source selection, route authoring, and web export;
- positive mass, Laplacian symmetry, and near-zero row sums;
- heat and Poisson residuals, finite distance, and source distance near zero;
- Dijkstra predecessor reconstruction;
- three distinct native route starts, successful traces, and no published recovery.

Vitest checks the binary parser, metadata contract, topology, route measurements, and field consistency. Playwright checks WebGL startup, every route branch, release and replay, comparison mode, orbit and zoom inputs, trackpad-style Explore behavior, focus and reset controls, reduced motion, accessibility state, fallback behavior, dark surfaces, responsive stacking, and horizontal overflow.

## Limitations

- The smooth torus is represented by a finite triangle mesh.
- Heat Method distances and traced paths are approximations.
- Accuracy depends on resolution, triangle quality, and the diffusion time scale.
- A face tracer can encounter a critical region on an arbitrary field.
- Edge Dijkstra remains restricted to the mesh graph.
- A torus can have several nearly equal routes around different sides.
- The primary procedural surface is validated conservatively, not by a general-purpose continuous collision proof.
- The implementation intentionally targets CPU execution only.

## Repository map

- `native/include/geodesic/`: mesh, operators, solvers, paths, procedural geometry, and export interfaces
- `native/src/`: C++20 implementations and CLI
- `native/tests/`: deterministic geometry and numerical correctness tests
- `native/benchmarks/`: CPU benchmark executable
- `scripts/export-web-data.sh`: reproducible website data pipeline
- `data/`: schema and canonical benchmark JSON
- `web/src/`: parser, tracer, interaction controller, Three.js scene, and story logic
- `web/e2e/`: browser behavior and responsive tests
- `docs/interview-guide.md`: concise technical explanation prompts
- `docs/course-map.md`: study map from discrete geometry topics to this codebase

## References

1. Keenan Crane, Clarisse Weischedel, and Max Wardetzky, [*Geodesics in Heat: A New Approach to Computing Distance Based on Heat Flow*](https://www.cs.cmu.edu/~kmcrane/Projects/HeatMethod/paperTOG.pdf), ACM Transactions on Graphics 32(5), 2013.
2. Keenan Crane, [*Discrete Differential Geometry: An Applied Introduction*](https://www.cs.cmu.edu/~kmcrane/Projects/DDG/paper.pdf).
