# The Shortest Path Through a Curved World

**Technical title:** GPU-Accelerated Geodesic Solver on Triangle Meshes

An end-to-end C++20/CUDA implementation of the Heat Method for geodesic distance on triangle
meshes, paired with a guided Three.js explanation of one central idea: **heat can reveal
distance**.

The public experience is designed as a continuous story rather than a solver dashboard. A visitor
places one explorer, sees why the ambient straight line fails, reveals the triangle mesh, releases
real precomputed heat, follows the reconstructed distance gradient, and arrives at the beacon.

- Project site: <https://mihirrao-10.github.io/shortest-path-through-a-curved-world/>
- Source repository: <https://github.com/mihirrao-10/shortest-path-through-a-curved-world>
- Primary method: [Crane, Weischedel, and Wardetzky, *Geodesics in Heat*](https://www.cs.cmu.edu/~kmcrane/Projects/HeatMethod/paperTOG.pdf)
- Mathematical background: [Crane, *Discrete Differential Geometry: An Applied Introduction*](https://www.cs.cmu.edu/~kmcrane/Projects/DDG/paper.pdf)

## What is implemented

The native engine does the geometry and numerical work itself. It does not call libigl, Geometry
Central, CGAL, or a black-box geodesic routine.

- Oriented halfedge triangle mesh with vertex, edge, face, twin, next, and incidence records
- Manifold/orientation validation, boundary detection, cached one-rings, and face traversal
- Face and area-weighted vertex normals, areas, edge lengths, and degeneracy policies
- Lumped barycentric mass and cotangent Laplace–Beltrami/stiffness matrices
- Piecewise-linear face gradients and a weak vertex gradient/divergence load
- Heat Method with direct and iterative Eigen sparse solves, residual checks, and reusable factors
- Face-wise path tracing with barycentric edge crossings and guarded fallback behavior
- Edge-weighted Dijkstra baseline with predecessor reconstruction
- Deterministic procedural curved-world and icosphere generators
- OBJ import/export, scalar CSV export, path OBJ export, benchmark CLI, and compact web exporter
- Optional CUDA double-precision PCG using cuSPARSE SpMV, cuBLAS reductions, Jacobi
  preconditioning, resident matrix/work buffers, geometry kernels, and vector kernels
- TypeScript binary parser and the same face-wise distance-gradient trace in the browser
- Vitest and Playwright coverage plus GitHub Pages deployment through GitHub Actions

## Quick start

### CPU-only native build

Requirements are CMake 3.22+, a C++20 compiler, and Eigen 3.4. CMake uses a pinned Eigen 3.4.0
fallback when a system package is unavailable.

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DGEODESIC_ENABLE_CUDA=OFF
cmake --build build --parallel
ctest --test-dir build --output-on-failure
```

### Website

```sh
cd web
npm ci
npm run check
npm run test:e2e
npm run preview
```

Vite is configured with the GitHub project-site base path
`/shortest-path-through-a-curved-world/`.

### Optional CUDA build

CUDA is opt-in so the same project builds on macOS and CPU-only Linux hosts.

```sh
cmake -S . -B build-cuda \
  -DCMAKE_BUILD_TYPE=Release \
  -DGEODESIC_ENABLE_CUDA=ON
cmake --build build-cuda --parallel
ctest --test-dir build-cuda --output-on-failure
```

`GEODESIC_ENABLE_CUDA=ON` fails configuration explicitly when no CUDA compiler is present. A
CPU-only build never includes or links CUDA headers or libraries.

## Command-line tools

Generate the deterministic curved world:

```sh
./build/geodesic_cli generate --subdivisions 5 --output curved-world.obj
```

Solve Heat Method or edge-Dijkstra distance on an OBJ mesh:

```sh
./build/geodesic_cli solve \
  --mesh curved-world.obj --source 7959 --method heat --output heat-distance.csv

./build/geodesic_cli solve \
  --mesh curved-world.obj --source 7959 --method dijkstra --output graph-distance.csv
```

Trace a route and write a polyline OBJ:

```sh
./build/geodesic_cli path \
  --mesh curved-world.obj --source 7959 --start 12 --output route.obj
```

Regenerate the data used by the website:

```sh
./build/geodesic_cli export-web --subdivisions 5 --output web/public/data
./build/geodesic_benchmark \
  --min-subdiv 2 --max-subdiv 6 --repetitions 7 \
  --host "your reproducible host description" \
  --json data/benchmarks.cpu.json
```

`scripts/export-web-data.sh` wraps the full release build, export, benchmark, and copy sequence.

## Mathematical convention

Let the mesh have \(n\) vertices and \(m\) triangular faces.

- \(M\in\mathbb{R}^{n\times n}\) is diagonal. `M(i,i)` is one third of the total area of faces
  incident on vertex \(i\), so it has units of length squared.
- \(L\in\mathbb{R}^{n\times n}\) is the symmetric positive-semidefinite stiffness matrix that
  approximates \(-\Delta\). It is dimensionless in this weak form.
- Off-diagonal entries are the negative sum of half cotangents opposite an edge; each diagonal is
  assembled from the matching local element contributions. Negative individual cotangents from
  obtuse triangles are valid and are not silently clamped.
- Scalar values use vertex indices. Face vector fields use oriented face indices. Each face stores
  barycentric gradients in the local order of its three vertex indices.
- Natural Neumann behavior follows from the weak assembly on a boundary. The primary world is a
  closed manifold, so it has no boundary terms.

For a source impulse \(\delta\), the three stages are

\[
(M+tL)u=M\delta,
\qquad
X=-\frac{\nabla u}{\|\nabla u\|},
\qquad
L\phi=b_X.
\]

The source vector has value \(1/M_{ss}\) at source \(s\), so `M * delta` is a unit load. The time
step is

\[
t = \alpha h^2,
\]

where \(h\) is mean edge length and \(\alpha=1\) by default. This has the required length-squared
units and follows the scale recommendation in the original Heat Method paper. Benchmarks can
change \(\alpha\); it is intentionally not a prominent public-site control.

For a face field \(X_f\), the implementation assembles

\[
(b_X)_i=\sum_{f\ni i}A_f\,\nabla b_i\cdot X_f.
\]

With the positive \(L\approx-\Delta\) convention, this is the negative integrated continuum
divergence. If \(X=\nabla\phi\), the finite-element identity is exactly \(L\phi=b_X\). One fixed
vertex removes the constant nullspace; subtracting the source value restores source distance zero.

## Sparse solver design

`HeatMethodSolver` separates preprocessing from queries:

1. assemble `M`, `L`, face bases, and mean edge length;
2. build and factor `M + tL`;
3. build and factor one pinned copy of `L`;
4. reuse both factors for every source right-hand side.

The direct reference path uses `Eigen::SimplicialLDLT`. The iterative CPU path uses conjugate
gradient with incomplete Cholesky. Both compute the true relative residual
\(\|Ax-b\|_2/\max(\|b\|_2,10^{-30})\), record iterations and wall time, and reject solutions that
miss tolerance.

## Path extraction

Distance is piecewise linear, so its gradient is constant within each triangle. Starting from an
arbitrary barycentric surface point, the tracer:

1. computes the negative face gradient;
2. converts that direction into three barycentric velocities;
3. finds the first coordinate to reach zero—the next crossed edge;
4. moves through the halfedge twin to the adjacent face;
5. nudges into that face and repeats until entering the source neighborhood.

It detects repeated faces, vanishing gradients, boundary exits, invalid barycentric states, and a
maximum step count. At a critical point it can switch to a monotone one-ring descent. The browser
receives face adjacency and vertex distances and performs the same procedure after raycasting the
visitor's one click onto the exported mesh.

## CUDA backend

The CUDA backend is substantial but optional:

- the sparse matrix is converted once to CSR and retained on device;
- cuSPARSE performs every sparse matrix-vector product;
- cuBLAS performs dot products and norms;
- custom kernels apply the Jacobi preconditioner, update \(x/r/p\), normalize negative face
  gradients, and compute per-face area/normals;
- repeated and batched right-hand sides reuse descriptors, matrix memory, inverse diagonal, and
  work vectors;
- preprocessing, kernel, and host/device transfer times are reported separately;
- solutions are copied back for an independent CPU residual check;
- double precision is intentional: distance reconstruction and ill-conditioned mesh operators need
  tighter CPU/GPU agreement than a visualization-only float path would provide.

The current local validation host has no NVIDIA device or CUDA toolkit. CPU behavior is fully
measured; CUDA is compile-covered in the dedicated containerized CI job, and runtime agreement is
tested automatically whenever a CUDA device is actually present. No GPU timing is fabricated.

## Website data integrity

`web/public/data/world.bin` is produced by `geodesic_cli export-web`. It contains:

- indexed positions and area-weighted normals;
- face adjacency across each opposite edge;
- six real diffusion solutions at increasing times, stored as per-frame log values quantized to
  `uint16`;
- the final Heat Method distance field;
- edge-Dijkstra distance and predecessor arrays;
- adaptively sampled normalized face gradients;
- source, scale, time-step, and layout metadata.

`world.meta.json` records the seed, counts, sign convention, boundary policy, residuals, timings,
and GPU availability. The complete byte layout is documented in [`data/schema.md`](data/schema.md).
The binary is currently about 968 KB rather than several megabytes of uncompressed JSON.

## Measured CPU benchmark

Release build, Apple Clang 17, Eigen 3.4, double precision, one warm-up plus seven measured runs on
an Apple M4 (10-core) MacBook Pro with 16 GB memory. Times below are arithmetic means; GPU data was
unavailable on this host.

| Faces | Vertices | Preprocess once | Heat query | Edge-Dijkstra query |
|---:|---:|---:|---:|---:|
| 320 | 162 | 0.23 ms | 0.008 ms | 0.012 ms |
| 1,280 | 642 | 0.81 ms | 0.040 ms | 0.042 ms |
| 5,120 | 2,562 | 4.97 ms | 0.226 ms | 0.213 ms |
| 20,480 | 10,242 | 37.09 ms | 1.16 ms | 0.82 ms |
| 81,920 | 40,962 | 287.14 ms | 5.84 ms | 3.85 ms |

These results are deliberately not presented as a CPU speedup: edge Dijkstra is faster at the two
largest measured cases. It solves a different problem—the shortest route on the edge graph—while
the Heat Method reconstructs a scalar field over the surface. The factorization becomes useful when
many field queries share one mesh; the optional CUDA path targets the linear-algebra work but has no
published timing until it is measured on real hardware.

## Validation

Native coverage includes:

- halfedge/twin/next/incidence invariants and one-ring adjacency;
- boundary detection, face area, face normals, and vertex normals;
- Laplacian symmetry and row sums, positive mass, and the gradient of a constant;
- heat and pinned-Poisson residuals and deterministic repeated solves;
- flat-grid distance behavior and path termination;
- approximate great-circle distance on a refined unit sphere;
- iterative/direct agreement and conditional CPU/CUDA agreement;
- edge-Dijkstra predecessor paths;
- malformed indices, inconsistent orientation, and reject/skip degeneracy behavior.

Run the complete local checks:

```sh
xcrun clang-format --dry-run --Werror $(find native -type f \( -name '*.cpp' -o -name '*.hpp' -o -name '*.cu' \))
cmake --build build --parallel
ctest --test-dir build --output-on-failure
cd web
npm run check
npm run test:e2e
cd ..
node scripts/validate-links.mjs web/dist
git diff --check
```

Playwright runs the story at 1440×900, 1280×800, 1024×768, 390×844, and 375×667. It checks
WebGL startup, the release action, story progression, keyboard placement, reduced motion, and
horizontal overflow. `web/scripts/capture-visuals.mjs` captures representative desktop and mobile
frames for human inspection.

## Repository map

```text
native/include/geodesic/   public mesh, operator, solver, path, I/O, and CUDA interfaces
native/src/                C++20 implementation and command-line program
native/cuda/               cuSPARSE PCG and geometry/vector CUDA kernels
native/tests/              topology, numerical, integration, and malformed-input tests
native/benchmarks/         reproducible scaling benchmark
web/src/                   persistent Three.js scene, binary parser, tracer, narrative state
web/e2e/                   five-viewport Playwright suite
web/public/data/           deterministic engine output consumed by the story
data/                      binary schema and canonical CPU benchmark result
docs/interview-guide.md    explanations, questions, honest answers, and codebase map
docs/course-map.md         exact DDG reading map for every implemented concept
scripts/                   export and link-validation helpers
.github/workflows/         CPU/web validation, CUDA compilation, and Pages deployment
```

## Limitations and next steps

- This is an approximation to continuous geodesic distance, not an exact polyhedral-geodesic
  algorithm.
- The implemented cotangent operator uses the input triangulation. The Heat Method authors now
  recommend an intrinsic Delaunay Laplacian for especially poor meshes; adding intrinsic edge flips
  is the most valuable robustness extension.
- The mesh layer intentionally accepts oriented manifold triangle meshes only. It rejects
  non-manifold edges and inconsistent winding.
- Natural Neumann boundaries are implemented and tested, but mixed boundary conditions and
  boundary-source experiments are not exposed in the public story.
- The browser path can use a monotone vertex fallback near a critical face; that fallback is robust
  but less smooth than face tracing.
- CUDA has compile and conditional agreement coverage, but local runtime and performance numbers
  remain unavailable until tested on an NVIDIA GPU.

## References

1. Keenan Crane, Clarisse Weischedel, and Max Wardetzky. [*Geodesics in Heat: A New Approach to Computing Distance Based on Heat Flow*](https://www.cs.cmu.edu/~kmcrane/Projects/HeatMethod/paperTOG.pdf). ACM Transactions on Graphics 32(5), 2013.
2. Keenan Crane. [*Discrete Differential Geometry: An Applied Introduction*](https://www.cs.cmu.edu/~kmcrane/Projects/DDG/paper.pdf), updated 2025.
3. Keenan Crane, Marco Livesu, Enrico Puppo, and Yipeng Qin. [*A Survey of Algorithms for Geodesic Paths and Distances*](https://www.cs.cmu.edu/~kmcrane/Projects/GeodesicSurvey/GeodesicSurvey.pdf). 2020.
4. Eigen project. [Eigen 3 documentation](https://eigen.tuxfamily.org/).
5. NVIDIA. [cuSPARSE documentation](https://docs.nvidia.com/cuda/cusparse/) and [cuBLAS documentation](https://docs.nvidia.com/cuda/cublas/).

The procedural curved world is generated from code with a fixed seed and has no external asset
license. Source is released under the [MIT License](LICENSE).
