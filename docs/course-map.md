# Course Map: Discrete Geometry Behind the Project

This map connects the implementation to Keenan Crane's [*Discrete Differential Geometry: An Applied Introduction*](https://www.cs.cmu.edu/~kmcrane/Projects/DDG/paper.pdf) and the original [Heat Method paper](https://www.cs.cmu.edu/~kmcrane/Projects/HeatMethod/paperTOG.pdf). Section numbers are more stable than page numbers.

## Direct mapping

| Implemented concept | Material | Question to answer | Code to read |
|---|---|---|---|
| Triangle mesh as a simplicial surface | DDG §2.1 to §2.3 | What do vertices, edges, faces, closure, and manifold neighborhoods mean? | `mesh.hpp`, `mesh.cpp` |
| Halfedge connectivity | DDG §2.5 | How do `next` and `twin` encode face traversal, orientation, and boundaries? | halfedge construction and validation in `mesh.cpp` |
| Intrinsic and extrinsic geometry | DDG §3.1 to §3.2 | Why can a 3D chord be shorter yet inadmissible? | public story, geometry utilities |
| Gradients and divergence | DDG §4.3 and §4.6 | How does a scalar field produce tangent directions, and how are directions integrated? | `faceGradient`, `gradientLoad` |
| Integration and weak form | DDG §4.7 | Why does the Poisson right-hand side use area-weighted basis gradients? | `operators.cpp` |
| Orientation | DDG §4.8 | Why does triangle order matter for normals and face-local operators? | torus winding in `procedural.cpp`, mesh validation |
| Triangle area and normals | DDG §5.1 to §5.2 | How do cross products supply area, oriented normals, and basis gradients? | `operators.cpp`, `mesh.cpp` |
| Numerical convergence | DDG §5.6 | How do resolution and triangle quality affect approximation error? | geometry and residual tests |
| Laplacian properties | DDG §6.1 | Why should the stiffness matrix be symmetric with zero row sums? | `assembleOperators`, operator tests |
| Finite-element cotangent operator | DDG §6.2 | How do local hat-function energies produce cotangent weights? | face geometry and sparse triplets |
| Sparse indexing | DDG §6.4 | How does local mesh incidence become a sparse global matrix? | `operators.cpp`, Eigen matrix types |
| Poisson nullspace | DDG §6.5 | Why is distance defined only up to a constant before pinning? | pinned Poisson matrix in `heat_method.cpp` |
| Implicit diffusion | DDG §6.6 | Why does backward Euler produce (M+tL)? | heat matrix assembly and solve |
| Boundary behavior | DDG §6.7 | What changes between a closed torus and a mesh with boundary? | boundary validation and natural weak assembly |
| Vector-field integration | DDG §8.1 | Why might normalized face directions fail to be one exact gradient? | Poisson reconstruction |
| Face-to-face path movement | DDG §8.3 as enrichment | How are tangent directions interpreted across a piecewise-flat surface? | barycentric crossings in `path.cpp` |

## Heat Method reading sequence

After the core mesh and Laplacian sections, read the Heat Method paper in this order:

1. Read the introduction and algorithm outline for the sequence: heat, direction, distance.
2. Study the short-time heat-kernel intuition. Keep the limiting theory separate from the practical normalized-gradient algorithm.
3. Reconcile the paper's Laplacian convention with this repository's positive stiffness matrix (L\approx-\Delta).
4. Connect the recommended time (t\propto h^2) to `DiscreteOperators::suggestedTimeStep`.
5. Connect precomputation to reusable heat and Poisson factors in `HeatMethodSolver`.
6. Compare the paper's error discussion with this project's resolution, quality, residual, and route tests.

## Study path 1: explain the project

1. Study simplicial surfaces and halfedges in DDG §2.1 to §2.5.
2. Study surface metrics and tangent vectors in §3.1 to §3.2.
3. Study triangle area and normals in §5.1 to §5.2.
4. Study Laplacian properties and the finite-element derivation in §6.1 to §6.2.
5. Study sparse matrices, Poisson, implicit diffusion, and boundaries in §6.4 to §6.7.
6. Read the Heat Method paper's introduction and algorithm.
7. Read `mesh.cpp`, `operators.cpp`, `heat_method.cpp`, and `path.cpp` in that order.

## Study path 2: derive the implementation

1. Derive the three barycentric basis gradients on one triangle.
2. Show that (\sum_i\nabla b_i=0), hence a constant field has zero gradient.
3. Assemble (A_f\nabla b_i\cdot\nabla b_j) and recover the cotangent formula.
4. Derive the weak load (\sum_f A_f\nabla b_i\cdot X_f).
5. Explain why the Poisson matrix has a constant nullspace.
6. Derive barycentric coordinate velocities for one path-crossing step.
7. Read the operator, solve, and tracer tests beside each derivation.

## Study path 3: understand the torus

1. Parameterize a reference torus with periodic (u) and (v).
2. Differentiate the parameterization and use (\partial_u p\times\partial_v p) to establish winding.
3. Enumerate wrapped grid edges and verify that every edge has two incident triangles.
4. Count (V), (E), and (F), then use (\chi=2-2g) to recover genus one.
5. Explain why a normal dotted with position relative to the origin is not a valid winding rule on the inner tube.
6. Inspect the periodic relief terms and identify the ridge, basin, rim, broad thickness change, and saddle-like throat.
7. Read the torus geometry tests and the parameter-space route authoring in `io.cpp`.

## Exercises tied to this repository

### Exercise A: prove the row sum

Starting from (L^f_{ij}=A_f\nabla b_i\cdot\nabla b_j), use (\sum_jb_j=1) to show (L\mathbf{1}=0). Compare the result with the symmetry and row-sum test.

### Exercise B: derive one face gradient

For the unit right triangle in the xy-plane, derive every (\nabla b_i). Apply them to a constant field and a linear x-coordinate field, then compare with `faceGradient`.

### Exercise C: reconcile signs

Begin with a continuum Laplacian (\Delta=\operatorname{div}\nabla) with nonpositive spectrum. Show why a positive (L\approx-\Delta) gives (M+tL) in the heat step and the implemented sign in the weak Poisson load.

### Exercise D: check units

Scale every mesh position by (s). Show that mass scales by (s^2), stiffness remains dimensionless in the weak form, and (t=h^2) scales by (s^2).

### Exercise E: count the torus

For (n\) major and (m\) minor segments, show that the wrapped grid has (V=nm), (F=2nm), and (E=3nm). Verify (V-E+F=0).

### Exercise F: validate orientation

For the undeformed parameterization, calculate (\partial_u p\times\partial_v p). Check its direction against the vector from the centerline to the tube point. Relate that order to the two triangle patterns in each periodic quad.

### Exercise G: trace one crossing

Start with barycentric coordinates ((0.2,0.3,0.5)) and an arbitrary in-face descent direction. Compute (\dot\lambda_i), find the first coordinate to reach zero, and identify the adjacent face through `adjacentFaceAcross`.

### Exercise H: compare the three distances

For one exported preset, inspect its chord, Dijkstra polyline, and Heat trace. State the legal movement domain for each before comparing the numbers.

### Exercise I: analyze factor reuse

Run the benchmark across its default torus resolutions. Separate assembly, factorization, one query, reused queries, and Dijkstra. Explain why total preprocessing should not be attributed to every later source.

## Topics outside the core claim

The implementation does not compute smooth Gaussian curvature, exact continuous geodesics, cut loci, intrinsic Delaunay remeshing, or globally optimal representatives for every torus homotopy class. These are valuable extensions, but they are not prerequisites for understanding the code that is present.
