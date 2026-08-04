# Interview Guide: Heat Method Geodesics on a Toroidal Mesh

This guide separates the mathematical problem, the numerical implementation, the browser presentation, and the claims supported by measurements.

## The 30-second explanation

> I implemented the Heat Method for approximate geodesic distance on triangle meshes in C++20. The public example is a genuine closed genus-one torus generated with periodic indexing, not a browser primitive. The solver assembles cotangent and lumped-mass operators with Eigen, diffuses a brief source impulse, normalizes its facewise gradient, and solves a pinned Poisson system for distance. A native tracer follows that field across triangle interiors, while edge Dijkstra supplies a graph-restricted baseline. The static Three.js page visualizes deterministic exported geometry, fields, measurements, and three validated routes. Everything runs on CPU.

## The two-minute explanation

Start with the constraint. The straight segment between two points is shortest in surrounding three-dimensional space, but it can leave the torus or cut through its tube. A legal route must stay on the surface. Edge Dijkstra respects that broad constraint, but it may only step along mesh edges, so its exact graph solution is not the continuous surface solution.

The native pipeline represents the surface with an oriented halfedge mesh. It assembles a diagonal lumped mass matrix (M) and a positive-semidefinite cotangent stiffness matrix (L\approx-\Delta). For a source impulse (\delta), it solves

\[
(M+tL)u=M\delta,
\qquad t=h^2.
\]

The short-time temperature field contains directional distance information. The code computes

\[
X=-\nabla u/\lVert\nabla u\rVert
\]

per face, then finds a scalar field (\phi) whose gradient best agrees with (X):

\[
L\phi=b_X.
\]

One matrix row and column are pinned to remove the arbitrary additive constant. The final field is shifted so the source value is zero. Both solves report true relative residuals.

To reconstruct a route, the tracer starts from a face and barycentric point, follows decreasing (\phi), determines which barycentric coordinate reaches zero first, crosses the matching halfedge twin, and repeats. Three torus-aware starts share one source, one Heat Method field, and one Dijkstra tree. The exporter rejects any public route that misses the source or needs recovery.

The browser validates schema version 2 and renders the native geometry. Its camera orbits a stationary world with elapsed-time damping. Mouse, touch, keyboard, and an explicit trackpad Explore mode all reach the same controller state. Reduced-motion mode removes idle orbit and inertial transitions.

## Detailed technical walkthrough

### 1. The three distance problems

The three displayed lengths have different admissible domains:

1. The ambient chord may move anywhere in (\mathbb{R}^3).
2. Edge Dijkstra may move only along graph edges.
3. The Heat trace may cross triangle interiors but must remain on the triangulated surface.

A smaller chord does not invalidate the surface result. It answers a less constrained problem. Dijkstra is exact on its graph, but the graph introduces directional bias. The Heat trace approximates intrinsic distance on the discretized surface.

### 2. Why the torus topology matters

The primary mesh samples periodic angles (u) and (v). Indices wrap in both directions, so no seam vertex is duplicated. Every periodic quad contributes two triangles with analytic parameter-space winding.

For the default mesh:

- (V=160\cdot64=10{,}240);
- (F=2V=20{,}480);
- every undirected edge has two incident faces;
- there is no boundary;
- (V-E+F=0);
- for a connected closed orientable surface, (\chi=2-2g), so (g=1).

The origin is not a valid global orientation reference for a torus. A normal on the inner tube can legitimately point partly toward the origin. The generator therefore fixes triangle order analytically and tests normals against the local outward tube direction from the centerline.

The smooth deformation uses periodic low-frequency terms. It adds an outer ridge, a localized basin and rim, a saddle-like inner throat, unequal thickness, and a broad warp without changing connectivity.

### 3. Halfedge representation

Each triangular face owns three directed halfedges. A halfedge stores its origin, next halfedge, twin, edge, and face. This makes the operations used by the tracer local:

- three `next` steps traverse a face;
- `twin` crosses a shared edge;
- a missing twin identifies a boundary;
- directed shared edges make orientation explicit.

Construction rejects invalid indices, repeated triangle vertices, degenerate area, duplicate directed edges, nonmanifold edge incidence, inconsistent shared-edge orientation, broken face cycles, and invalid vertex incidence.

### 4. Discrete geometry and operators

For a triangle ((p_0,p_1,p_2)),

\[
2A=\lVert(p_1-p_0)\times(p_2-p_0)\rVert,
\qquad
n=\frac{(p_1-p_0)\times(p_2-p_0)}{2A}.
\]

The gradients of its piecewise-linear barycentric basis functions are

\[
\nabla b_0=\frac{n\times(p_2-p_1)}{2A},\quad
\nabla b_1=\frac{n\times(p_0-p_2)}{2A},\quad
\nabla b_2=\frac{n\times(p_1-p_0)}{2A}.
\]

A vertex field has constant face gradient (\nabla u_f=\sum_i u_i\nabla b_i). The local stiffness matrix is

\[
L^f_{ij}=A_f\,\nabla b_i\cdot\nabla b_j.
\]

This is equivalent to cotangent weights. For an interior edge,

\[
w_{ij}=\tfrac12(\cot\alpha_{ij}+\cot\beta_{ij}).
\]

Local energy assembly makes symmetry and constant row sums explicit. Obtuse triangles may contribute a negative individual cotangent; the implementation does not silently clamp it. The lumped mass is (M_{ii}=\sum_{f\ni i}A_f/3), so every valid vertex has positive mass.

### 5. Heat solve

Backward Euler gives ((M+tL)u=M\delta). With the positive stiffness convention, the plus sign is required. The source vector is scaled so (M\delta) represents a unit impulse. Choosing (t=h^2) ties diffusion distance to mesh resolution.

Heat is largest near the source, so (\nabla u) points toward hotter values. Its negative points approximately in the direction of increasing distance. Normalization discards magnitude decay while preserving direction. Faces with genuinely vanishing gradients are counted and reported.

### 6. Poisson reconstruction

The independently normalized face vectors do not generally integrate to one exact scalar function. The weak load is

\[
(b_X)_i=\sum_{f\ni i}A_f\,\nabla b_i\cdot X_f.
\]

Solving (L\phi=b_X) finds the finite-element scalar field whose gradient best matches the directions. Constants lie in the nullspace because gradients cannot detect a global offset. A pinned reference removes that degree of freedom, after which subtracting the source value establishes distance zero.

### 7. Reusable sparse solves

`HeatMethodSolver` separates four costs:

1. mesh operator assembly;
2. heat and pinned-Poisson factorization;
3. a source-dependent heat solve and direction assembly;
4. a source-dependent Poisson solve.

The direct path uses `Eigen::SimplicialLDLT`. The iterative path uses conjugate gradient with incomplete Cholesky. The direct factors are reused across source queries on the same mesh. Both paths calculate (\lVert Ax-b\rVert_2/\max(\lVert b\rVert_2,10^{-30})) from the returned solution.

### 8. Face-interior path tracing

Within a face, (\phi) is linear and (\nabla\phi) is constant. The tracer converts (-\nabla\phi) into barycentric coordinate velocities, finds the first positive time at which one barycentric coordinate reaches zero, advances to that edge, and enters the neighboring face.

The implementation guards against repeated faces, vanishing gradients, invalid barycentric values, boundary exits, and excessive steps. A general recovery path can descend through a one-ring at a critical region, but a public route is invalid if recovery is used. That distinction prevents a visually plausible polyline from being presented as a successful face trace.

### 9. Native route authoring

Direction from the origin is ambiguous on a torus, especially around the inner ring. The source and route candidates are defined in toroidal parameter space. Candidate faces near each target receive deterministic barycentric starts, then native validation checks:

- the trace reaches the shared source;
- no recovery is used;
- all measurements are finite;
- the surface trace is longer than the ambient chord;
- the trace remains within a conservative ratio of edge Dijkstra;
- starts and route lengths are distinct.

The published routes are Ridge crossing, Inner saddle pass, and Basin rim.

### 10. Deterministic export

The exporter writes compact indexed geometry, adjacency, heat states, distances, Dijkstra predecessors, gradient samples, source data, route measurements, topology, quality, and residuals. Heat values are stored as per-frame `log(u)` quantized to `uint16`; the per-frame logarithmic range is stored as `float64`.

Machine-specific timing is not stored in the world metadata. A separate benchmark document records the host and methodology. Native tests export twice and compare the complete files byte for byte.

### 11. Browser interaction

The Three.js world remains stationary. `OrbitController` owns target, azimuth, elevation, distance, desired state, and current state. It uses exponential damping based on elapsed time, so the same motion model behaves similarly at 60 Hz and 120 Hz.

- Primary drag and one-finger drag orbit with pointer capture.
- Two touch pointers combine centroid orbit and pinch distance.
- Explore mode maps trackpad horizontal and vertical wheel deltas to orbit.
- Control-wheel pinch and Safari gesture events map to smooth zoom.
- Outside Explore mode, vertical wheel input keeps ordinary page scrolling.
- Arrow keys orbit, plus and minus zoom, and R resets.
- Escape and window blur release Explore mode.
- Buttons reset, focus the beacon, and focus the route start.

Idle orbit stops on input and during focus transitions. Authored chapter poses are ignored briefly after manual input. Reduced-motion mode disables idle orbit and snaps or greatly shortens transitions.

## Benchmark claims

The checked-in CPU benchmark records a Release build, compiler, hardware label, `steady_clock`, double precision, one warm-up, eight distributed reused sources, seven Dijkstra repetitions, and residuals. It reports assembly and factorization separately from source queries.

Do not describe the benchmark as a universal comparison between algorithms. Dijkstra and the Heat Method solve different constrained problems. Also do not combine preprocessing and query time without saying whether factors are reused.

## Limitations to state plainly

- The torus is a finite mesh approximation to a smooth surface.
- The Heat Method result is approximate.
- Cotangent operators depend on triangle quality.
- The diffusion scale influences error.
- The face tracer can encounter critical regions on arbitrary data.
- Dijkstra is restricted to edge directions.
- A genus-one surface can offer multiple nearly equal routes.
- The browser trace is not claimed to be an exact continuous geodesic.
- The project intentionally uses CPU computation only.

## Useful code-reading order

1. `native/include/geodesic/types.hpp`
2. `native/src/mesh.cpp`
3. `native/src/operators.cpp`
4. `native/src/heat_method.cpp`
5. `native/src/dijkstra.cpp`
6. `native/src/path.cpp`
7. `native/src/procedural.cpp`
8. `native/src/io.cpp`
9. `web/src/world-data.ts`
10. `web/src/orbit-controller.ts`
11. `web/src/world-scene.ts`

## Common questions

### Why not use built-in torus geometry in Three.js?

That would disconnect the picture from the numerical mesh. The browser must render the same vertices, triangles, source, field, and routes produced by C++.

### Why is Dijkstra useful if it is not the target answer?

It is deterministic, exact on the edge graph, easy to reconstruct from predecessors, and exposes directional bias caused by restricting movement to edges.

### Why pin the Poisson system?

Adding a constant to every distance leaves its gradient unchanged. Pinning one value gives the linear system a unique representative. Shifting afterward places zero at the source.

### Why use (t=h^2)?

Diffusion time has units of length squared. Scaling by mean edge length squared makes the pulse duration track mesh scale, following the practical recommendation in the Heat Method.

### How do you know the primary mesh is a torus?

Its construction is periodic in two independent directions, it is connected, closed, orientable, and has Euler characteristic zero. Those invariants imply genus one.

### What result should not be overstated?

The traced polyline approximates a geodesic on a discrete surface. It is not proof of the exact smooth shortest path, especially when several homotopy classes have similar lengths.
