# Discrete differential geometry course map

This guide connects the project to Keenan Crane's *Discrete Differential Geometry: An Applied Introduction* and the accompanying CMU course materials. Section numbering can vary by edition, so topic names are the reliable anchors.

## Project-to-course map

| Project concept | Course topic | What to review | Project location |
| --- | --- | --- | --- |
| Intrinsic versus ambient distance | Smooth surfaces and Riemannian geometry | A metric measures allowed tangent motion, not ambient chords | website Geometry branch |
| Oriented triangle mesh | Simplicial surfaces | Vertices, edges, faces, orientation, incidence | `native/src/mesh.cpp` |
| Halfedge connectivity | Mesh data structures | Twins, face cycles, one rings, boundaries | `TriangleMesh::build` |
| Genus-one topology | Discrete topology | Euler characteristic, orientability, boundary, genus | `native/src/procedural.cpp` |
| Triangle area and normal | Discrete geometry | Cross products, signed orientation, finite areas | `TriangleMesh::faceArea`, `faceNormal` |
| Barycentric basis | Finite elements on triangles | Piecewise linear basis functions and constant gradients | `assembleOperators` |
| Lumped mass | Discrete integration | Voronoi or barycentric areas and diagonal mass | `DiscreteOperators::lumpedMass` |
| Cotangent stiffness | Discrete Laplace operator | Cotangent weights, symmetry, energy, obtuse triangles | `DiscreteOperators::laplacian` |
| Heat equation | Diffusion on surfaces | Backward Euler and short-time behavior | `HeatMethodSolver::compute` |
| Varadhan relation | Heat kernel and geodesic distance | Why early heat contains metric information | website Diffusion node |
| Normalized heat gradient | Discrete differential operators | Face gradients and unit direction fields | `faceGradient` |
| Weak divergence | Adjoint operators | Integrated divergence load from face vectors | `gradientLoad` |
| Poisson reconstruction | Elliptic equations | Nullspace, gauge fixing, scalar potential | pinned Poisson system |
| Sparse factorization | Numerical linear algebra | Symmetric sparse matrices and reusable factors | `HeatMethodSolver` constructor |
| Iterative solve | Krylov methods | Tolerance, preconditioning, residual checks | `CpuSolverKind::Iterative` |
| Graph distance | Shortest paths on meshes | Dijkstra on weighted edges versus surface geodesics | `native/src/dijkstra.cpp` |
| Face path tracing | Piecewise linear geometry | Barycentric edge crossings and adjacent faces | `native/src/path.cpp` |
| Cut locus | Geodesic nonsmoothness | Ambiguous gradients and critical points | tracer safeguards |
| Convergence | Approximation theory | Refinement, mesh quality, diffusion time | native planar and curved tests |

## Suggested study sequence

### 1. Topology and mesh representation

Start with simplicial surfaces, orientation, boundary, and Euler characteristic. Then inspect `TriangleMesh::build` and answer:

- Why must twins reverse edge direction?
- Why is a repeated directed edge an orientation error?
- How does a boundary edge differ from a nonmanifold edge?
- Why does (V-E+F=0) imply genus one for a connected closed orientable mesh?

Use the procedural world to verify that the inner tunnel is not a clipping effect. It is part of the same connected, oriented manifold.

### 2. Local triangle calculus

Derive barycentric gradients on one triangle. Confirm that:

\[
\nabla b_0+\nabla b_1+\nabla b_2=0.
\]

Then verify that a constant vertex scalar has zero face gradient. This is the local fact behind the global Laplacian row-sum test.

### 3. Mass and cotangent stiffness

Assemble one triangle by hand. Track where its area enters the lumped mass and where each cotangent enters the stiffness matrix.

Important distinctions:

- a positive semidefinite global energy does not require every individual cotangent contribution to be positive
- symmetry follows from shared undirected edge contributions
- natural boundary conditions arise from the weak form when boundary values are not prescribed

### 4. Heat Method

Work through the three systems in order:

\[
(M+tL)u=M\delta,
\]

\[
X=-\nabla u/\lVert\nabla u\rVert,
\]

\[
L\phi=b_X.
\]

Pay close attention to sign convention. This project defines (L\approx-\Delta), so the heat matrix is (M+tL).

### 5. Nullspaces and gauge fixing

Show that constants lie in the stiffness nullspace. Explain why one pinned degree of freedom makes the Poisson solve unique, and why subtracting the source value afterward preserves gradients.

The fixed pin is what allows the same factorization to serve every source.

### 6. Graph and surface distance

Compare three routes with the same endpoints:

- Euclidean ambient chord
- weighted edge-graph shortest path
- Heat Method face-crossing path

The graph algorithm is exact for its discrete domain. The Heat Method is approximate but represents more directions across the surface.

### 7. Path extraction and cut loci

Derive how a ray inside one face changes barycentric coordinates. The first coordinate to reach zero identifies an edge crossing. Then study why the method becomes difficult near a cut locus, where distance is not differentiable.

Inspect the cycle, critical-gradient, boundary, and maximum-step guards in `native/src/path.cpp`.

### 8. Sparse numerical reuse

Separate these costs:

1. procedural geometry
2. operator assembly
3. matrix construction and factorization
4. a source query
5. repeated source queries with reused factors

Read `data/benchmarks.json` and compare one Heat query with the mean across eight different sources. Do not infer a speedup merely because setup is reused. Instead, explain exactly which work is and is not repeated.

## Exercises tied to the repository

1. Prove the face winding in `makeCurvedWorld` gives outward normals on both the exterior and inner tunnel.
2. Compute the Euler characteristic from the exported triangle list in another language and confirm zero.
3. Change the global diffusion multiplier and graph distance error on the planar test.
4. Construct an obtuse triangle and inspect its cotangent contributions.
5. Compare direct and iterative residuals as the mesh is refined.
6. Trace the tunnel landmark and log whether the continuous face path or guarded fallback completes it.
7. Rotate the triangulation of a planar grid and compare edge Dijkstra with Euclidean distance.
8. Explain why the browser may trace a pointer-selected route but must not recompute the sparse field.

## What belongs outside the core course

Some engineering topics support the project but are not central DDG material:

- CMake target organization
- binary schema design and little-endian encoding
- deterministic benchmarking with a steady clock
- TypeScript binary parsing
- Three.js rendering and raycasting
- responsive and accessible interaction testing

Study those as systems and presentation concerns after the mathematical pipeline is clear.

## Final comprehension checklist

You should be able to explain:

- why the ambient chord is invalid
- why edge Dijkstra and intrinsic geodesic distance differ
- why a torus has Euler characteristic zero
- how triangle winding controls inner-tunnel normals
- how mass and cotangent stiffness are assembled
- why short-time diffusion encodes distance
- why normalization discards heat magnitude
- how the weak divergence load leads to Poisson reconstruction
- why a gauge must be fixed
- which sparse work is reused across sources
- how a face-crossing path is advanced
- where mesh quality, cut loci, and numerical tolerances enter the error
