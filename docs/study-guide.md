# Heat Method: Study Guide

The [README](../README.md) owns the implementation, commands, benchmark results,
and project layout. [The data schema](../data/schema.md) owns export details.
This guide combines the mathematical study map and explanation prompts.

## Explaining the project

C++20 and Eigen compute approximate geodesic distance on validated triangle
meshes. The site shows native-generated genus 1, 2, and 3 surfaces. C++ constructs
the mesh, assembles operators, solves heat and Poisson systems, computes Dijkstra,
traces official paths, and exports the state. TypeScript independently checks the
payload; Three.js renders it. The displayed geometry and measurements come from
that same numerical mesh.

### The numerical argument

An ambient chord may leave the surface. Edge Dijkstra stays on triangle edges.
A Heat trace crosses face interiors while staying on the mesh. These have
different admissible domains, so their lengths are not a universal speed or
accuracy competition.

Using lumped mass `M` and positive stiffness `L` approximating `-Delta`, solve
`(M + tL)u = M delta` at `t = h^2`. Normalize face directions as
`X = -grad(u)/|grad(u)|`, then solve `L phi = b_X`, where
`(b_X)_i = sum_f A_f grad(b_i) dot X_f`. Poisson reconstruction finds a scalar
whose gradient best fits those directions. Pinning removes the constant
nullspace; a final shift puts zero at the source.

Explain these details without hiding behind the solver:

- Each face has constant barycentric basis gradients; their sum is zero.
- Local stiffness is `A_f grad(b_i) dot grad(b_j)`, equivalent to cotangent weights.
  An individual negative cotangent on an obtuse triangle is not silently clamped.
- Lumped mass gives each incident vertex `A_f/3`.
- Factors are reused for new sources on one fixed mesh and time scale. Changing
  genus changes the mesh and requires new preprocessing.
- Residuals use `||Ax-b|| / max(||b||,1e-30)` from the returned solution.
- Tracing converts descent to barycentric velocities, finds the first edge hit,
  and crosses its halfedge twin. Official routes must arrive without recovery.

### Topology and generated worlds

A thickened connected loop graph has boundary genus equal to its cycle rank.
The generator uses this construction with one, two, or three rounded loops,
extracts it by marching tetrahedra with shared grid-edge intersections, then
smooths and reprojects. This is project-specific geometry, not a claimed part
of Crane's course.

Acceptance depends on the finished mesh, not its silhouette: verify finite
positive-area faces, opposite incidence, cyclic vertex links, connectedness,
no boundary, outward signed volume, and `chi = V-E+F = 2-2g`. The browser
reconstructs topology independently and compares it with metadata. Discrete
checks do not constitute a general continuous collision proof.

### Computation versus presentation

The path solve always uses `t=h^2`. Nine native display-diffusion frames help show
heat reaching distant handles; they do not change the path field. Metadata and
the browser separately validate their coverage. The browser interpolates only
exported frames. Semantic world-space landmarks supply route starts, not a torus
parameterization.

C++ owns geometry, fields, routes, residuals, and deterministic exports.
TypeScript owns fetching, caching, payload validation, and accessible state.
Three.js owns rendering, camera interaction, and disposal. CPU computation is
a deliberate scope choice. Official paths remain approximations on finite
meshes; no exact smooth geodesic or globally best homotopy class is claimed.

Benchmarks separate generation, assembly, factorization, one query, reused
queries, and Dijkstra. Describe the recorded host and protocol rather than
claiming a universal performance race. Triangle quality and diffusion scale
influence numerical error; close route classes can be difficult to distinguish.

## Theory and code map

Use Keenan Crane's [Discrete Differential Geometry](https://www.cs.cmu.edu/~kmcrane/Projects/DDG/paper.pdf)
and Crane, Weischedel, and Wardetzky's [Heat Method paper](https://www.cs.cmu.edu/~kmcrane/Projects/HeatMethod/paperTOG.pdf).
Study the genus-independent mesh and numerical core before the procedural world
and presentation code.

### Direct map from concepts to code

| Implemented concept | Foundation | Question to answer | Exact implementation |
|---|---|---|---|
| Triangle mesh as a simplicial surface | DDG 2.1 to 2.3 | What do vertices, edges, faces, closure, and manifold neighborhoods mean? | TriangleMesh::build and TriangleMesh::validateManifold in native/src/mesh.cpp |
| Halfedge connectivity | DDG 2.5 | How do next and twin encode traversal, orientation, and boundaries? | Halfedge construction, faceHalfedges, adjacentFaceAcross, and twin validation in native/src/mesh.cpp |
| Manifold vertex links | Simplicial surfaces | Why are two incident triangle fans at one vertex invalid even if all edges look valid? | The link path/cycle test in TriangleMesh::validateManifold |
| Intrinsic and extrinsic geometry | DDG 3.1 to 3.2 | Why may a three-dimensional chord be shorter but inadmissible? | Native route measurements in buildCurvedWorldRoutePresets and the route-comparison chapter |
| Triangle area and orientation | DDG 4.8 and 5.1 | How do winding and cross products determine signed normals? | TriangleMesh::faceArea, faceNormal, implicit-gradient winding in native/src/procedural.cpp |
| Vertex normals | DDG 5.1 and 5.3 | Why use area-weighted incident face normals? | TriangleMesh::vertexNormal |
| Barycentric coordinates | Piecewise-linear finite elements | How is a point represented inside a triangle? | SurfacePoint in native/include/geodesic/path.hpp and barycentric route starts in native/src/io.cpp |
| Piecewise-linear gradients | DDG 6.2 | Why is a vertex scalar field's gradient constant within a face? | FaceGeometry::basisGradient and faceGradient in native/src/operators.cpp |
| Weak divergence | DDG 4.6 to 4.7 | How is a face vector field converted into a vertex load? | gradientLoad in native/src/operators.cpp |
| Finite-element weak form | DDG 4.7 and 6.2 | Why do area-weighted basis-gradient products assemble the operator? | assembleOperators in native/src/operators.cpp |
| Cotangent stiffness | DDG 6.1 to 6.2 | How do local triangle energies recover cotangent weights? | stiffness triplets in assembleOperators |
| Lumped mass | Finite-element discretization | Why does each vertex receive one third of each incident face area? | massDiagonal and mass in assembleOperators |
| Sparse indexing | DDG 6.4 | How do local face contributions become a sparse global matrix? | Eigen triplets and compressed matrices in native/src/operators.cpp |
| Poisson nullspace | DDG 6.5 | Why is distance determined only up to an additive constant? | HeatMethodSolver::pinnedPoissonMatrix in native/src/heat_method.cpp |
| Implicit diffusion | DDG 6.6 | Why does backward Euler give M + tL with this sign convention? | HeatMethodSolver construction and solveHeatAtTime |
| Natural boundary policy | DDG 6.7 | What would change on a mesh with boundary? | Weak assembly and boundary reporting; published worlds are closed |
| Vector-field integration | DDG 8.1 | Why does normalized heat direction need Poisson reconstruction? | HeatMethodSolver::compute and gradientLoad |
| Face-interior path tracing | Piecewise-flat surface integration | How does a path cross triangle edges without being restricted to mesh edges? | traceDistanceGradient in native/src/path.cpp |
| Graph baseline | Shortest paths on graphs | What does Dijkstra solve exactly, and why is it directionally biased on a mesh? | edgeDijkstra in native/src/dijkstra.cpp |

### Derivations to reproduce

#### Barycentric gradients

Derive the three basis gradients on one triangle. Verify that their sum is zero, then apply them to a constant field and a coordinate-linear field. Compare with the basisGradient values built by assembleOperators.

#### Cotangent stiffness

Starting from the face energy

    L^f_ij = A_f grad(b_i) dot grad(b_j),

recover the familiar half-sum of opposite cotangents on an interior edge. Explain why local energy assembly makes symmetry and zero row sums explicit.

#### Weak divergence load

Derive

    (b_X)_i = sum over incident faces of A_f grad(b_i) dot X_f.

Relate this weak load to gradientLoad and explain the sign used with a stiffness matrix approximating -Delta.

#### Poisson pinning

Show that L times the constant vector is zero. Explain why pinning one row and column selects a representative, and why subtracting the computed source value afterward restores the intended zero.

#### Backward Euler and units

Derive M + tL for the positive stiffness convention. Scale positions by s and show that mass and t scale by s squared while the weak stiffness is scale-independent.

#### Face crossing

For a barycentric start such as (0.2, 0.3, 0.5), convert an in-face descent direction to barycentric velocities. Find the first coordinate to reach zero and identify the neighboring face through adjacentFaceAcross.

#### Topology count

For each exported binary, reconstruct the undirected edge set from triangle indices and compute V - E + F. Do not read genus from metadata until after this calculation. Compare the result with validateBinaryTopology in web/src/world-data.ts.

#### Route domains

For one preset, state the admissible motion for the ambient chord, Dijkstra path, and Heat trace before comparing lengths. Explain why the chord must be shorter and why Dijkstra is only a graph baseline.

#### Factor reuse

Read native/benchmarks/benchmark_main.cpp and separate generation, assembly, factorization, preprocessing, one query, reused queries, and Dijkstra. Explain which costs change when the genus or mesh changes, and which are reused for another source on the same mesh.

### Reading order

Read `types`, `mesh`, `operators`, and `heat_method` under `native/include/geodesic`
and their implementations first. Then read `dijkstra`, `path`, `procedural`,
and `io`. Finish with `web/src/world-data.ts`, `world-scene.ts`, and
`orbit-controller.ts`. This order connects the mathematical objects to their
computed values before looking at how they are drawn.
