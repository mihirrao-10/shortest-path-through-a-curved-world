# Course Map: What to Study in Keenan Crane's DDG Material

This map ties the implemented code to the current edition of Keenan Crane's
[*Discrete Differential Geometry: An Applied Introduction*](https://www.cs.cmu.edu/~kmcrane/Projects/DDG/paper.pdf)
and the CMU DDG course structure. Page numbers refer to the edition updated January 29, 2025; section
numbers are more stable than pages.

The shortest useful route is Chapters 2, 3, selected parts of 4 and 5, all core sections of Chapter 6,
then the original [Heat Method paper](https://www.cs.cmu.edu/~kmcrane/Projects/HeatMethod/paperTOG.pdf).

## Direct mapping

| Implemented concept | DDG material | What to learn | Code to read afterward |
|---|---|---|---|
| Triangle mesh as a simplicial complex | §2.1 “Abstract Simplicial Complex” (p. 8), §2.3 “Simplicial Surfaces” (p. 14) | Vertices/edges/faces, closure, manifold neighborhoods, oriented triangles | `native/include/geodesic/mesh.hpp`, `native/src/mesh.cpp` |
| Local neighborhoods | §2.2 “Star, Closure, and Link” (p. 10) | Why a one-ring is a discrete neighborhood; vertex and edge manifold tests | `TriangleMesh::oneRing`, `incidentFaces`, `validateManifold` |
| Sparse topology | §2.4 “Adjacency Matrices” (p. 16) | Connectivity as sparse structure; relation between topology and matrix nonzeros | cached adjacency in `mesh.cpp`; Dijkstra in `dijkstra.cpp` |
| Halfedge structure | §2.5 “Halfedge Mesh” (p. 18), §2.7 coding exercises (p. 27) | `next`, `twin`, boundary loops, vertex/face traversal, orientation | all halfedge records and construction in `mesh.cpp` |
| Intrinsic vs. extrinsic geometry | §3.1 “The Geometry of Surfaces” (p. 29), §3.2 “Derivatives and Tangent Vectors” (p. 32) | The metric, tangent planes, quantities unchanged by bending, why a 3D chord is wrong | opening acts; geometry in `operators.cpp` |
| Gradient intuition | §4.3 “Vectors and 1-Forms” (p. 55), §4.6 “Differential Operators” (p. 68) | Differential of a scalar, gradient via inner product, divergence, Laplacian | `faceGradient`, `gradientLoad` |
| Integration and weak form | §4.7 “Integration and Stokes' Theorem” (p. 74) | Moving derivatives from a trial function to basis/test functions; boundary terms | `assembleOperators`, `gradientLoad` |
| Orientation and discrete fields | §4.8 “Discrete Exterior Calculus” (p. 78), especially orientation discussion around pp. 79–80 | Oriented simplices, vertex 0-forms, edge differences, primal/dual quantities | halfedge orientation and face-local basis order |
| Triangle area and normals | §5.1 “Vector Area” (p. 85), §5.2 “Area Gradient” (p. 88) | Cross products, area gradients, area-weighted normals | `faceArea`, `faceNormal`, `vertexNormal` |
| Cotangent formula intuition | §5.2.1 “Mean Curvature Vector” (p. 89) | Why the cotan expression recurs and how it connects to Laplace–Beltrami | cotangent contributions in `operators.cpp` |
| Numerical convergence mindset | §5.6 “Numerical Tests and Convergence” (p. 96) | Compare refinement sequences and analytic geometry rather than trusting one mesh | flat and great-circle tests |
| Laplacian properties | §6.1 “Basic Properties” (p. 101) | Symmetry, positive semidefiniteness, constants in the nullspace, Dirichlet energy | Laplacian row-sum/symmetry tests |
| FEM derivation | §6.2 “Discretization via FEM” (p. 104), especially Exercises 6.6–6.8 (pp. 107–108) | Piecewise-linear hat gradients, local stiffness, cotangent entries | `FaceGeometry::barycentricGradients`, sparse triplets |
| DEC derivation | §6.3 “Discretization via DEC” (p. 108) | A second derivation of the same operator using exterior derivative and Hodge star | conceptual cross-check for `L`; not a separate code path |
| Sparse matrices and mesh indexing | §6.4 “Meshes and Matrices” (p. 111) | Assembly, index maps, sparsity pattern, matrix/vector dimensions | `SparseMatrix`, triplet assembly, CUDA CSR conversion |
| Poisson and nullspace | §6.5 “The Poisson Equation” (p. 113) | Weak Poisson solve, compatibility, fixing the additive constant | `pinnedPoissonMatrix`, `gradientLoad` |
| Implicit diffusion | §6.6 “Implicit Mean Curvature Flow” (p. 114) | Backward Euler systems, stability, mass plus stiffness structure | `makeHeatMatrix`, `solveHeatAtTime` |
| Boundary conditions | §6.7 “Boundary Conditions” (p. 116) | Natural Neumann terms vs. Dirichlet constraints | boundary assembly behavior and tests |
| Vector-field integration | §8.1 “Hodge Decomposition” (p. 139) | Exact/coexact/harmonic components; why an arbitrary face field may need global projection | intuition for the Poisson reconstruction |
| Path transport across faces | §8.3 “Connections and Parallel Transport” (p. 151) as enrichment | How tangent directions relate across a piecewise-flat surface | edge crossing in `path.cpp`; implementation uses reprojection, not full transport machinery |
| Geometry derivatives | Appendix A, especially the area derivatives (p. 165 onward) | Verify signs and derivatives used in local operators | geometry calculations and future optimization work |

## The Heat Method paper

After Chapter 6, read the [TOG paper](https://www.cs.cmu.edu/~kmcrane/Projects/HeatMethod/paperTOG.pdf)
in this order:

1. **Introduction and algorithm outline:** internalize “direction first, distance second.”
2. **Heat kernel/Varadhan intuition:** understand why short-time heat contains geodesic information,
   but do not confuse the theoretical limit formula with the practical normalized-gradient algorithm.
3. **Algorithm 1 / discretization:** align the paper's Laplacian sign with this repository's positive
   stiffness convention.
4. **Choice of time:** connect \(t=mh^2\) to `DiscreteOperators::suggestedTimeStep`.
5. **Precomputation:** connect reusable factors to `HeatMethodSolver` and the benchmark split.
6. **Robustness and convergence experiments:** compare with the planar and sphere tests here.

Then read the project's current [Heat Method page](https://www.cs.cmu.edu/~kmcrane/Projects/HeatMethod/)
“Additional Notes.” It recommends an intrinsic Laplacian on triangle meshes and explicitly points to
parallel sparse solvers and parallel matrix construction as performance opportunities. Those notes
explain both the project's main limitation and the motivation for its CUDA architecture.

## Suggested study sequence

### Pass 1: enough to explain the project (6–8 hours)

1. §2.1–2.5: combinatorial surfaces and halfedges.
2. §3.1–3.2: surface metric and tangent vectors.
3. §5.1–5.2: triangle area, normals, cotan preview.
4. §6.1–6.2: Laplacian properties and FEM cotan derivation.
5. §6.4–6.7: matrices, Poisson, implicit flow, boundaries.
6. Heat Method paper introduction and algorithm.
7. Read `mesh.cpp`, `operators.cpp`, and `heat_method.cpp` in that order.

### Pass 2: enough to derive it (8–12 additional hours)

1. §4.3, §4.6–4.8: gradient/divergence, Stokes, and DEC.
2. Work Exercises 6.6–6.8 by hand; these reproduce the face basis and cotangent entries.
3. Derive `gradientLoad` from the weak inner product.
4. Explain the Poisson pin as a gauge choice.
5. Reproduce the planar-grid and great-circle expected values.
6. Read `path.cpp` and derive the barycentric crossing time.

### Pass 3: enough to discuss extensions (6–10 additional hours)

1. §5.6 on convergence and mesh dependence.
2. §8.1 on Hodge decomposition as a broader view of vector-field integration.
3. §8.3 for tangent vectors across faces.
4. The Heat Method paper's evaluation and limitations.
5. The authors' notes on intrinsic Laplacians.
6. Review sparse Cholesky, PCG, Jacobi/incomplete-Cholesky preconditioning, and GPU memory bandwidth.

## Exercises tied to this repository

### Exercise A: prove the row sum

Starting from local stiffness entries \(A_f\nabla b_i\cdot\nabla b_j\), use
\(\sum_j b_j=1\) to show \(L\mathbf{1}=0\). Then inspect `testOperators`.

### Exercise B: derive one face gradient

For a triangle in the \(xy\)-plane, derive
\(\nabla b_0=n\times(p_2-p_1)/(2A)\). Evaluate it on the unit right triangle and compare with
`assembleOperators`.

### Exercise C: reconcile signs

Start from a continuum convention \(\Delta=\operatorname{div}\nabla\) with nonpositive spectrum.
Show why this repository's positive \(L\approx-\Delta\) gives `(M + tL)` and why the weak load is
\(\sum A\nabla b_i\cdot X\).

### Exercise D: analyze timestep units

Scale every position by \(s\). Show that mass scales by \(s^2\), stiffness is dimensionless, and
\(t=h^2\) scales by \(s^2\), leaving the heat system consistent.

### Exercise E: trace one path crossing

Choose barycentric coordinates \((0.2,0.3,0.5)\) and arbitrary negative-gradient direction. Compute
all \(\dot\lambda_i\), find the first zero coordinate, and identify `adjacentFaceAcross`.

### Exercise F: compare solvers

Run direct and iterative modes on increasingly refined icospheres. Record residual, iterations,
factor/precondition time, and query time. Explain when repeated right-hand sides change the decision.

### Exercise G: design the intrinsic extension

Sketch how intrinsic Delaunay flips would change topology used for operator assembly while preserving
values on original vertices. Identify which mesh and path assumptions would need revision.

## What is outside the minimum study path

Chapters 7 and most of 8 are excellent DDG but not required to defend this implementation. Surface
parameterization, homology generators, and vector-field singularity design are not covertly claimed by
the code. Study them after the sequence above unless an interviewer specifically steers toward
conformal geometry or topology.

Likewise, CUDA details are numerical linear algebra and systems material rather than core DDG. Study
CSR, SpMV, PCG, preconditioning, synchronization, transfer accounting, and floating-point reduction
separately from the geometry derivation.
