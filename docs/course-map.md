# Course Map: Discrete Geometry Behind the Project

This map connects the numerical implementation to Keenan Crane's [*Discrete Differential Geometry: An Applied Introduction*](https://www.cs.cmu.edu/~kmcrane/Projects/DDG/paper.pdf) and Crane, Weischedel, and Wardetzky's [Heat Method paper](https://www.cs.cmu.edu/~kmcrane/Projects/HeatMethod/paperTOG.pdf). Section numbers are more stable than page numbers.

The multi-handle implicit generator is project-specific computational geometry. It provides demanding closed meshes for a solver whose discrete differential geometry foundations come from the sources above.

## Direct map from concepts to code

| Implemented concept | Foundation | Question to answer | Exact implementation |
|---|---|---|---|
| Triangle mesh as a simplicial surface | DDG 2.1 to 2.3 | What do vertices, edges, faces, closure, and manifold neighborhoods mean? | TriangleMesh::build and TriangleMesh::validateManifold in native/src/mesh.cpp |
| Halfedge connectivity | DDG 2.5 | How do next and twin encode traversal, orientation, and boundaries? | Halfedge construction, faceHalfedges, adjacentFaceAcross, and twin validation in native/src/mesh.cpp |
| Manifold vertex links | Simplicial surfaces | Why are two incident triangle fans at one vertex invalid even if all edges look valid? | The link path/cycle test in TriangleMesh::validateManifold |
| Intrinsic and extrinsic geometry | DDG 3.1 to 3.2 | Why may a three-dimensional chord be shorter but inadmissible? | Native route measurements in buildCurvedWorldRoutePresets and the route-comparison chapter |
| Triangle area and orientation | DDG 4.8 and 5.1 | How do winding and cross products determine signed normals? | TriangleMesh::faceArea, faceNormal, implicit-gradient winding in native/src/procedural.cpp |
| Vertex normals | DDG 5.2 | Why use area-weighted incident face normals? | TriangleMesh::vertexNormal |
| Barycentric coordinates | Piecewise-linear finite elements | How is a point represented inside a triangle? | SurfacePoint in native/include/geodesic/path.hpp and barycentric route starts in native/src/io.cpp |
| Piecewise-linear gradients | DDG 4.3 | Why is a vertex scalar field's gradient constant within a face? | FaceGeometry::basisGradient and faceGradient in native/src/operators.cpp |
| Weak divergence | DDG 4.6 to 4.7 | How is a face vector field converted into a vertex load? | gradientLoad in native/src/operators.cpp |
| Finite-element weak form | DDG 4.7 and 6.2 | Why do area-weighted basis-gradient products assemble the operator? | assembleOperators in native/src/operators.cpp |
| Cotangent stiffness | DDG 6.1 to 6.2 | How do local triangle energies recover cotangent weights? | stiffness triplets in assembleOperators |
| Lumped mass | Finite-element discretization | Why does each vertex receive one third of each incident face area? | massDiagonal and mass in assembleOperators |
| Sparse indexing | DDG 6.4 | How do local face contributions become a sparse global matrix? | Eigen triplets and compressed matrices in native/src/operators.cpp |
| Poisson nullspace | DDG 6.5 | Why is distance determined only up to an additive constant? | Pinned matrix construction in HeatMethodSolver::factorDirect |
| Implicit diffusion | DDG 6.6 | Why does backward Euler give M + tL with this sign convention? | HeatMethodSolver construction and solveHeatAtTime |
| Natural boundary policy | DDG 6.7 | What would change on a mesh with boundary? | Weak assembly and boundary reporting; published worlds are closed |
| Vector-field integration | DDG 8.1 | Why does normalized heat direction need Poisson reconstruction? | HeatMethodSolver::compute and gradientLoad |
| Face-interior path tracing | Piecewise-flat surface integration | How does a path cross triangle edges without being restricted to mesh edges? | traceDistancePath in native/src/path.cpp |
| Graph baseline | Shortest paths on graphs | What does Dijkstra solve exactly, and why is it directionally biased on a mesh? | edgeDijkstra in native/src/dijkstra.cpp |

## Topology of the three worlds

For a connected closed orientable triangulated surface,

    chi = V - E + F = 2 - 2g
    g = 1 - chi / 2

The native extractor requests a genus, but validation derives chi and g from the finished indexed mesh:

| World | Handles | Required chi |
|---|---:|---:|
| Genus 1 | 1 | 0 |
| Genus 2 | 2 | -2 |
| Genus 3 | 3 | -4 |

generateCurvedWorld in native/src/procedural.cpp also verifies one connected component, no boundary edges, outward signed volume, and the requested recovered genus. TriangleMesh::validateManifold separately verifies halfedge incidence and that every vertex link is one cycle on these closed worlds.

Changing genus changes global topology, not just appearance. A continuous deformation cannot turn one of these surfaces into another without cutting, gluing, or passing through a singularity. The Heat Method machinery itself is genus-independent because it consumes an oriented triangle mesh and its local operators.

## Project-specific surface generator

Read native/src/procedural.cpp as computational geometry built for this project:

1. ImplicitWorld defines rounded embedded loops, smooth union, low-frequency relief, and analytic finite-difference gradients.
2. The grid sampler evaluates the implicit field in a deterministic bounding box.
3. Marching tetrahedra splits each cube consistently and caches grid-edge intersections.
4. Triangle winding is aligned with the outward implicit gradient.
5. Duplicate and degenerate triangles are removed.
6. improveSurface applies tangential smoothing and level-set reprojection.
7. The final TriangleMesh is built and its Euler characteristic, genus, components, boundary, signed volume, bounds, and quality are checked.
8. World-space semantic anchors are mapped to nearby triangle SurfacePoints.

The thickened loop graph is useful because the boundary of a regular neighborhood of a connected graph has genus equal to the graph's first Betti number. This construction and its extractor are not claimed as course content from Crane.

## Heat Method reading sequence

After the mesh and Laplacian material:

1. Read the Heat Method paper's introduction and algorithm outline for the heat, direction, distance sequence.
2. Study short-time heat-kernel intuition while keeping the limiting statement separate from the finite-mesh algorithm.
3. Reconcile the paper's Laplacian convention with this repository's positive stiffness matrix L approximately equal to -Delta.
4. Connect t proportional to h squared to DiscreteOperators::suggestedTimeStep.
5. Connect precomputation to reusable heat and Poisson factors in HeatMethodSolver.
6. Compare the paper's error discussion with this project's resolution, triangle-quality, residual, and route checks.

## Recommended code-reading order

1. native/include/geodesic/types.hpp
2. native/include/geodesic/mesh.hpp and native/src/mesh.cpp
3. native/include/geodesic/operators.hpp and native/src/operators.cpp
4. native/include/geodesic/heat_method.hpp and native/src/heat_method.cpp
5. native/src/dijkstra.cpp
6. native/include/geodesic/path.hpp and native/src/path.cpp
7. native/include/geodesic/procedural.hpp and native/src/procedural.cpp
8. native/include/geodesic/io.hpp and native/src/io.cpp
9. web/src/world-data.ts
10. web/src/world-scene.ts and web/src/orbit-controller.ts

This ordering deliberately places the genus-independent numerical core before the project-specific world and presentation layers.

## Derivations to reproduce

### Barycentric gradients

Derive the three basis gradients on one triangle. Verify that their sum is zero, then apply them to a constant field and a coordinate-linear field. Compare with the basisGradient values built by assembleOperators.

### Cotangent stiffness

Starting from the face energy

    L^f_ij = A_f grad(b_i) dot grad(b_j),

recover the familiar half-sum of opposite cotangents on an interior edge. Explain why local energy assembly makes symmetry and zero row sums explicit.

### Weak divergence load

Derive

    (b_X)_i = sum over incident faces of A_f grad(b_i) dot X_f.

Relate this weak load to gradientLoad and explain the sign used with a stiffness matrix approximating -Delta.

### Poisson pinning

Show that L times the constant vector is zero. Explain why pinning one row and column selects a representative, and why subtracting the computed source value afterward restores the intended zero.

### Backward Euler and units

Derive M + tL for the positive stiffness convention. Scale positions by s and show that mass and t scale by s squared while the weak stiffness is scale-independent.

### Face crossing

For a barycentric start such as (0.2, 0.3, 0.5), convert an in-face descent direction to barycentric velocities. Find the first coordinate to reach zero and identify the neighboring face through adjacentFaceAcross.

### Topology count

For each exported binary, reconstruct the undirected edge set from triangle indices and compute V - E + F. Do not read genus from metadata until after this calculation. Compare the result with validateBinaryTopology in web/src/world-data.ts.

### Route domains

For one preset, state the admissible motion for the ambient chord, Dijkstra path, and Heat trace before comparing lengths. Explain why the chord must be shorter and why Dijkstra is only a graph baseline.

### Factor reuse

Read native/benchmarks/benchmark_main.cpp and separate generation, assembly, factorization, preprocessing, one query, reused queries, and Dijkstra. Explain which costs change when the genus or mesh changes, and which are reused for another source on the same mesh.

## What the implementation claims

- The discrete operators follow standard finite-element and DDG constructions described in Crane's material.
- The solve sequence and practical time-step strategy follow the Heat Method paper.
- C++20 and Eigen implement all official numerical work for this project.
- The procedural worlds and marching tetrahedra extractor are project-specific.
- The exported route is an approximate path on a discrete mesh, not proof of an exact smooth geodesic.

The project does not compute exact continuous geodesics, smooth Gaussian curvature, cut loci, intrinsic Delaunay remeshing, or globally optimal representatives in every homotopy class. Those are valuable extensions, not hidden claims.
