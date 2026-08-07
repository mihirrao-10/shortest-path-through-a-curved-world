# The Shortest Path Through a Curved World

A C++20 CPU implementation of the Heat Method on three native-generated closed orientable surfaces, paired with a static Three.js mathematical narrative.

- Live project: <https://mihirrao-10.github.io/shortest-path-through-a-curved-world/>
- Method: [Crane, Weischedel, and Wardetzky, *Geodesics in Heat*](https://www.cs.cmu.edu/~kmcrane/Projects/HeatMethod/paperTOG.pdf)
- Mathematical background: [Crane, *Discrete Differential Geometry: An Applied Introduction*](https://www.cs.cmu.edu/~kmcrane/Projects/DDG/paper.pdf)

The browser does not synthesize geometry or numerical results. C++ generates and validates every surface, builds the discrete operators, solves the heat and Poisson systems, computes Dijkstra, traces the official paths, measures all three route models, and exports the state. TypeScript validates and presents that state. Three.js renders it.

## What is implemented

- Deterministic implicit Genus 1, Genus 2, and Genus 3 curved worlds, with Genus 2 as the default
- The original Genus 3 composition of three adjacent rounded loops
- Smooth thickened-loop-graph geometry extracted by marching tetrahedra with shared edge intersections
- Restrained low-frequency radius variation and spatial warping without random vertex noise
- An oriented halfedge triangle mesh with edge and vertex manifold validation
- Exact exported topology checks, including one component, no boundary, outward signed volume, and chi = 2 - 2g
- Semantic world-space landmarks mapped natively to barycentric surface points
- Face areas and normals, area-weighted vertex normals, edge lengths, and mesh-quality checks
- Lumped barycentric mass and cotangent stiffness matrices
- Piecewise-linear face gradients and a weak divergence load
- Direct and iterative Eigen sparse solve paths on CPU
- Reusable preprocessing and factorizations for repeated source queries
- True relative residual reporting for heat and Poisson systems
- Edge-weighted Dijkstra with predecessor reconstruction
- Native path tracing across face interiors through barycentric edge crossings
- Three deterministic route presets per genus, all sharing one source and field
- Authoritative native route polylines and measurements in the binary export
- Nine native display-diffusion frames, with the final frame validated at every route start while the path solve remains at `t = h^2`
- A manifest-driven, lazy, cached browser loader
- TypeScript topology reconstruction and payload cross-validation
- Three.js rendering, custom orbit controls, accessible interactions, and KaTeX notation
- Native, Vitest, and Playwright coverage

The refined icosphere and planar grid remain numerical test fixtures. They are independent of the three published worlds.

## Topology and geometry

Genus counts handles. The three published worlds range from one through three handles. For each connected closed orientable triangulated world, the exporter derives

    chi = V - E + F
    g = 1 - chi / 2

and requires chi = 2 - 2g. The requested genus is never trusted as the topology result.

Each world begins as the smooth tubular neighborhood of one, two, or three adjacent rounded loops. Genus 1 preserves the irregular ring, Genus 2 preserves the folded double loop, and Genus 3 preserves the original three-circle chain. The embedded loop graph has cycle rank equal to the requested genus, and the boundary of its regular neighborhood has the same genus. A smooth implicit minimum joins neighboring tubes. Marching tetrahedra extracts the zero level set on a deterministic grid and reuses each grid-edge intersection so neighboring cells share vertices.

Triangle winding is chosen from the implicit gradient. Duplicate and degenerate faces are rejected. A few tangential smoothing and level-set reprojection passes improve the surface without changing connectivity. The final mesh must be connected, boundary-free, consistently oriented, two-manifold at every edge and vertex, and positively oriented by signed volume.

Low-frequency terms introduce unequal lobes, a broad ridge, a shallow basin and rim, a compressed neck, and gentle vertical displacement. Genus-specific ring radii, spacing, and tube radii are recorded in metadata. The seed controls phases deterministically. There is no per-vertex random noise.

## Build and test

Requirements are CMake 3.22 or newer, a C++20 compiler, and Eigen 3.4. CMake fetches the pinned Eigen 3.4.0 archive when Eigen is not installed.

~~~sh
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure
~~~

Build and check the static site:

~~~sh
cd web
npm ci
npm run check
npm run test:e2e
~~~

Vite uses the GitHub Pages base path /shortest-path-through-a-curved-world/.

## Command-line tools

Generate any published genus as OBJ:

~~~sh
./build/geodesic_cli generate \
  --genus 2 \
  --resolution 96 \
  --tube-radius 0.30 \
  --relief 0.16 \
  --seed 1592594996 \
  --output double-torus.obj
~~~

Only genus values 1, 2, and 3 are accepted.

Solve a field on any supported OBJ mesh:

~~~sh
./build/geodesic_cli solve \
  --mesh double-torus.obj \
  --source 9209 \
  --method heat \
  --output heat-distance.csv

./build/geodesic_cli solve \
  --mesh double-torus.obj \
  --source 9209 \
  --method dijkstra \
  --output graph-distance.csv
~~~

Trace a Heat Method path from a mesh vertex:

~~~sh
./build/geodesic_cli path \
  --mesh double-torus.obj \
  --source 9209 \
  --start 1669 \
  --output route.obj
~~~

Export one web bundle or all three:

~~~sh
./build/geodesic_cli export-web --genus 2 --resolution 64 --output web/public/data/worlds/genus-2
./build/geodesic_cli export-web --all --resolution 64 --output web/public/data/worlds
~~~

Regenerate the checked-in web data and CPU benchmark:

~~~sh
GEODESIC_BENCHMARK_HOST="Apple M4 (10-core) MacBook Pro, 16 GB, macOS 26.5" \
  ./scripts/export-web-data.sh
~~~

The script performs a Release build, runs native tests, creates all three exports and their manifest, validates each export through the native pipeline, benchmarks the default Genus 2 world, and copies benchmark JSON into the public data directory.

## Heat Method convention

Let M be the diagonal lumped mass matrix and L the symmetric positive-semidefinite stiffness matrix approximating -Delta. For a source impulse delta, the solver performs

    (M + tL)u = M delta
    X = -grad(u) / |grad(u)|
    L phi = b_X

The time step is t = h^2, where h is mean edge length. Backward Euler diffuses a brief impulse. The normalized negative heat gradient gives a facewise direction field. A weak Poisson solve reconstructs the scalar field whose gradient best agrees with those directions.

The stiffness matrix has a one-dimensional constant nullspace on each connected closed world. The implementation factors a copy with one reference degree of freedom pinned, solves it, then shifts the result so the source distance is zero.

The distance and official path always use the authoritative Heat Method time step `t = h^2`. The visible release is a separate sequence of nine C++-computed visualization diffusion frames at time-step multipliers `0.18, 0.45, 1, 2.5, 7, 22, 70, 260, 1200`. Later display-only frames make propagation across distant lobes readable; they are never fed back into the distance or path solve. A fixed fourteen-decade log range lets C++ require the final frame to reach every authored route start, and TypeScript independently checks that threshold from the quantized binary before interpolating adjacent native frames.

For an interior edge ij, the familiar weight is one half of the sum of the cotangents of the two opposite angles. The implementation assembles equivalent local triangle energy terms, preserving symmetry and zero row sums.

## Solver and path design

HeatMethodSolver separates mesh-dependent work from source-dependent work:

1. assemble M, L, face bases, and mean edge length;
2. factor M + tL;
3. factor the pinned Poisson matrix;
4. reuse both factors for later source right-hand sides.

The direct path uses Eigen::SimplicialLDLT. The iterative path uses conjugate gradient with incomplete Cholesky. Both report the true relative residual ||Ax - b|| / max(||b||, 1e-30).

Distance is piecewise linear, so its gradient is constant within each triangle. Starting from a barycentric surface point, the tracer follows decreasing distance, determines which barycentric coordinate reaches zero first, crosses the corresponding halfedge twin, and continues toward the source. It guards against critical points, repeated faces, invalid barycentric states, boundaries, and step limits. The general tracer can recover through a monotone one-ring step, but every published route is rejected if recovery is needed.

## Landmarks and route problems

The generator returns world-space anchors for the rescue beacon and three meaningful route starts: Outer ridge, Central neck, and Basin rim. C++ searches nearby faces and maps each anchor to a valid SurfacePoint. This replaces the former rectangular torus parameter grid and works for every genus.

Each preset reports three quantities with different admissible domains:

- Ambient chord: a straight segment may move anywhere in three-dimensional space.
- Edge Dijkstra: the route may move only along mesh edges.
- Heat trace: the route may cross triangle interiors while remaining on the mesh.

The exporter requires every route to reach the source without fallback, contain several points, remain distinct, have finite positive measurements, exceed its ambient chord, and stay within a conservative ratio of its edge-graph baseline.

The Heat trace shown by Three.js is the native polyline stored in the binary. The browser retains a face-wise tracer as a cross-check, not as the authoritative displayed answer.

## Web export and loading

The generated layout is:

    web/public/data/worlds/manifest.json
    web/public/data/worlds/genus-1/world.bin
    web/public/data/worlds/genus-1/world.meta.json
    web/public/data/worlds/genus-2/world.bin
    web/public/data/worlds/genus-2/world.meta.json
    web/public/data/worlds/genus-3/world.bin
    web/public/data/worlds/genus-3/world.meta.json

Binary schema version 3 and metadata schema version 4 are documented in [data/schema.md](data/schema.md). Binary v3 is unchanged because its packed structure already supports a dynamic frame count and arbitrary manifest entries. Metadata v4 includes explicit generator-layout and heat-display records. The initial page requests only the manifest and Genus 2. Genus 1 and Genus 3 load only on selection and are cached in memory. Switching replaces one WorldScene on the same canvas without reloading the page or moving its scroll position.

The parser reconstructs edges and components from the binary triangles, verifies adjacency and winding, derives Euler characteristic and genus, checks signed volume, validates route ranges and lengths, then cross-checks metadata. Three.js receives validated native arrays only.

## CPU benchmark methodology

geodesic_benchmark uses a Release build, std::chrono::steady_clock, double precision, one warm-up query, eight distributed reused sources, and seven measured Dijkstra runs. It benchmarks a resolution sequence on Genus 2 and separates mesh generation, operator assembly, factorization, total preprocessing, one Heat Method query, reused Heat Method queries, and Dijkstra.

The checked-in [data/benchmarks.cpu.json](data/benchmarks.cpu.json) is the canonical measured result. Dijkstra and the Heat Method solve different constrained problems, so the chart is an implementation profile rather than a universal algorithm race.

## Validation

Native tests cover all three genera: deterministic vertices and faces, finite positions and normals, positive face area, edge and vertex manifold structure, one component, no boundary, opposite shared-edge orientation, positive signed volume, exact Euler characteristic, recovered genus, triangle quality, operator invariants, Heat and Poisson convergence, source zero, native landmarks and routes, deterministic export, heat metadata, metadata agreement, and the complete manifest. Planar and sphere fixtures continue to test numerical machinery independently.

Vitest covers all three supported values, manifest and payload parsing, derived topology, dynamic heat-frame interpolation, native path ranges, malformed data, lazy caching, fetch recovery, journey-state gates, replay, and camera input mapping. Playwright covers the opening repository link, the complete guided journey, selection of all three worlds, route commitment, Genus 2 and Genus 3 heat release, request laziness and caching, explicit route comparison, direct camera inputs, keyboard-only and reduced-motion use, WebGL and corrupt-data fallbacks, recoverable loading, screenshots, accessibility checks, and the required `1440x900`, `1280x800`, `1024x768`, `820x1180`, `430x932`, and `390x844` viewports.

## Foundations and project-specific work

Crane's DDG text supplies the foundations for simplicial surfaces, halfedges, orientation, discrete differential operators, weak forms, cotangent stiffness, mass, Poisson problems, and implicit diffusion. The Heat Method paper supplies the heat-direction-Poisson algorithm, the t proportional to h squared heuristic, and the precomputation strategy.

This repository's implicit multi-handle generator, marching tetrahedra extractor, landmarks, export format, route validation, C++20/Eigen implementation, browser validator, and Three.js presentation are project-specific. They are not attributed to the DDG course.

## Limitations

- Every smooth world is represented by a finite triangle mesh.
- Heat Method distances and traced paths are approximations, not proofs of exact continuous geodesics.
- Accuracy depends on resolution, triangle quality, and diffusion time scale.
- A face tracer can encounter a critical region on an arbitrary field.
- Edge Dijkstra remains restricted to mesh-graph directions.
- Multi-handle surfaces can have several nearly equal routes in different homotopy classes.
- The implicit generator is validated discretely; it is not a general continuous collision prover.
- The implementation intentionally targets CPU execution.

## Repository map

- native/include/geodesic/: mesh, operators, solvers, paths, procedural geometry, and export interfaces
- native/src/: C++20 implementations and CLI
- native/tests/: deterministic geometry and numerical correctness tests
- native/benchmarks/: CPU benchmark executable
- scripts/export-web-data.sh: reproducible website data pipeline
- data/: schema and canonical benchmark JSON
- web/src/: parser, tracer, orbit controller, Three.js scene, and story logic
- web/e2e/: browser behavior and responsive tests
- docs/interview-guide.md: technical explanation prompts
- docs/course-map.md: study map from Crane's material to exact code

## References

1. Keenan Crane, Clarisse Weischedel, and Max Wardetzky, [*Geodesics in Heat: A New Approach to Computing Distance Based on Heat Flow*](https://www.cs.cmu.edu/~kmcrane/Projects/HeatMethod/paperTOG.pdf), ACM Transactions on Graphics 32(5), 2013.
2. Keenan Crane, [*Discrete Differential Geometry: An Applied Introduction*](https://www.cs.cmu.edu/~kmcrane/Projects/DDG/paper.pdf).
