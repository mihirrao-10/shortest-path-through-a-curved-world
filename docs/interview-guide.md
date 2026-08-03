# Interview Guide: GPU-Accelerated Geodesic Solver on Triangle Meshes

This guide is for explaining the project accurately at different depths. The safest interview habit
is to separate three things: the mathematical method, the engineering implementation, and what was
actually measured.

## The 30-second version

> I implemented the Heat Method for approximate geodesic distance on triangle meshes in C++20 and
> built an optional CUDA sparse-solver backend. The key idea is to diffuse heat briefly from a source,
> normalize its gradient to recover directions, then solve a Poisson equation to reconstruct distance.
> I built the halfedge mesh and cotangent operators myself, validate residuals and analytic cases, and
> trace paths across triangle faces instead of just hopping between vertices. A Three.js story uses a
> compact binary export from that engine, so its heat and path are real numerical output. The CPU path
> is measured locally; CUDA is implemented and compile-tested, but I do not claim an unmeasured GPU
> speedup.

## The 2-minute version

Start with the user question: “What is the shortest route between two points if movement must remain
on a curved surface?” The ordinary 3D chord is shorter but leaves the surface. Dijkstra on mesh edges
stays on the surface, but it computes graph distance and inherits edge directions.

The Heat Method turns the problem into two elliptic solves. On an oriented triangle mesh I assemble a
lumped mass matrix \(M\) and a positive-semidefinite cotangent stiffness matrix \(L\approx-\Delta\).
For source \(\delta\), I solve

\[
(M+tL)u=M\delta,
\]

with \(t=h^2\). Then I compute a constant gradient per face and normalize

\[
X=-\nabla u/\|\nabla u\|.
\]

Finally I assemble the weak gradient load \(b_X\) and solve \(L\phi=b_X\). After removing the additive
constant, \(\phi\) approximates geodesic distance.

The CPU reference uses reusable Eigen `SimplicialLDLT` factors; there is also PCG with incomplete
Cholesky. The CUDA backend stores CSR matrices and work vectors on device, performs SpMV through
cuSPARSE, reductions through cuBLAS, and the Jacobi/vector/normalization work in custom kernels.
Every solve reports a true residual.

For the route, I follow \(-\nabla\phi\) inside a face, calculate which barycentric coordinate hits zero
first, cross the corresponding halfedge twin, and continue. The web exporter stores positions,
indices, adjacency, heat frames, distances, gradients, and Dijkstra parents. That supports one visitor
click with a fixed beacon and one genuine precomputed field.

## The 10-minute version

### 1. Problem and baselines

A geodesic is locally shortest under the surface metric. Extrinsic Euclidean distance measures a
straight chord in \(\mathbb{R}^3\); intrinsic distance depends only on lengths measured within the
surface. Bending a sheet without stretching changes the chord but not intrinsic distances.

The edge-Dijkstra baseline assigns Euclidean edge lengths to the mesh graph. It is exact for that
graph and useful for comparison, but it restricts routes to finitely many edge directions. Refinement
usually improves it, yet rotating the triangulation can still change the path.

### 2. Mesh foundation

Each triangular face owns three directed halfedges. A halfedge stores origin, next, twin, edge, and
face. An edge owns one representative halfedge; a boundary edge has no twin. A vertex points to one
outgoing halfedge and also has cached incident faces and one-ring neighbors.

Construction validates index ranges, repeated vertices, area, duplicate directed edges, no more than
two incident faces per edge, opposite shared-edge orientation, closed face cycles, symmetric twins,
and valid vertex incidence. Degenerate triangles are either rejected or explicitly skipped. They are
never allowed to produce `NaN` cotangents downstream.

Why halfedges? Face traversal is three `next` operations; crossing a route between faces is one
`twin`; boundary tests are local; and orientation is explicit rather than inferred repeatedly.

### 3. Geometry and finite elements

For triangle \((p_0,p_1,p_2)\),

\[
2A=\|(p_1-p_0)\times(p_2-p_0)\|,
\qquad
n=\frac{(p_1-p_0)\times(p_2-p_0)}{2A}.
\]

The piecewise-linear barycentric basis gradients are

\[
\nabla b_0=\frac{n\times(p_2-p_1)}{2A},
\quad
\nabla b_1=\frac{n\times(p_0-p_2)}{2A},
\quad
\nabla b_2=\frac{n\times(p_1-p_0)}{2A}.
\]

A vertex scalar field has face gradient \(\nabla u_f=\sum_i u_i\nabla b_i\). This formula is tested by
checking that a constant field has zero gradient.

The local stiffness contribution is

\[
L^f_{ij}=A_f\,\nabla b_i\cdot\nabla b_j.
\]

Expanding it gives the cotangent formula: an edge receives half the cotangent of its opposite angle
from each incident triangle. Assembly from local energy matrices makes symmetry and positive
semidefiniteness conceptually clear even when an obtuse triangle contributes a negative individual
edge weight. Row sums are zero because a constant function has no Dirichlet energy.

The lumped mass is \(M_{ii}=\sum_{f\ni i}A_f/3\). It approximates the \(L^2\) inner product, provides
the correct area scale, and is diagonal, which makes the heat system simple.

### 4. Heat Method intuition and stages

At short time, the heat kernel decays primarily with geodesic distance. The practical Heat Method
does not apply a noisy pointwise logarithm. It extracts only the direction of the heat gradient, then
integrates those directions globally.

1. **Heat:** backward Euler solves \((M+tL)u=M\delta\). With positive \(L\approx-\Delta\), the plus
   sign is required. Backward Euler is stable and SPD for \(t>0\).
2. **Direction:** heat is largest near the source, so \(-\nabla u\) points away from it, approximately
   along increasing distance. Normalize face by face. The implementation checks finite norms and
   uses a very small double-precision zero guard rather than discarding physically tiny far-field
   gradients.
3. **Poisson:** find \(\phi\) whose gradient best matches \(X\). The weak right-hand side is
   \((b_X)_i=\sum_f A_f\nabla b_i\cdot X_f\), then \(L\phi=b_X\). Pin one vertex to eliminate the
   constant nullspace, solve, and subtract the source value.

The timestep \(t=\alpha h^2\) is dimensionally correct and adapts to mesh scale. Too small a value can
make the heat field numerically difficult far from the source; too large a value smooths away local
distance structure. The benchmark exposes \(\alpha\); the public story does not.

### 5. Sparse linear algebra

`L` and `M+tL` have \(O(n)\) nonzeros on a bounded-degree manifold mesh. Direct factorization costs
more upfront and creates fill-in, but triangular solves are repeatable and robust for many sources.
PCG avoids a full factor but its performance depends on conditioning and preconditioning.

The implementation separates operator assembly, factorization, and query time. It verifies
\(\|Ax-b\|/\|b\|\), not only the solver library's status flag. This catches silent divergence,
breakdown, and tolerance misunderstandings.

Why pin Poisson? `L * 1 = 0`, so distance is determined only up to an additive constant. Replacing one
row and column with an identity constraint yields an SPD system. The factorization can remain reusable
because the same arbitrary pin is used for all queries; afterward, subtract \(\phi_s\).

### 6. Face-wise path extraction

Inside one triangle the distance gradient is constant. Write the current point as barycentric weights
\(\lambda_i\). For tangent direction \(d=-\nabla\phi/\|\nabla\phi\|\),

\[
\dot\lambda_i=\nabla b_i\cdot d.
\]

For each negative \(\dot\lambda_i\), the time to the opposite edge is
\(-\lambda_i/\dot\lambda_i\). The smallest positive time is the next crossing. At a vertex, two
coordinates may reach zero together, so the tracer tests candidate adjacent faces and chooses one in
which a small downhill nudge lies inside.

Termination guards are not optional engineering trivia. The code detects face revisits, zero
gradients, boundary exit, a source radius, and a maximum step count. The fallback chooses the
lowest-distance local vertex and descends monotonically through one-rings. That is less smooth but
prevents hangs near discrete critical points.

### 7. CUDA architecture

The CUDA class converts Eigen's matrix to row-major CSR once. It uploads row offsets, column indices,
values, and inverse diagonal; creates reusable cuSPARSE matrix/vector descriptors; allocates `x`, `b`,
`r`, `z`, `p`, and `Ap`; and queries one persistent SpMV workspace.

PCG iterations are:

1. `Ap = A p` through cuSPARSE;
2. `p·Ap`, `r·z`, and `||r||` through cuBLAS;
3. custom fused `x += alpha*p; r -= alpha*Ap`;
4. custom Jacobi `z = D^{-1}r`;
5. custom `p = z + beta*p`.

The matrix stays resident across queries. A batch API reuses all state for multiple right-hand sides.
Preprocessing, kernels, and transfers are timed separately, and the copied-back answer receives a CPU
residual check. Separate kernels compute face areas/normals and robust negative normalization.

Double precision was chosen to make residual and CPU/GPU comparison meaningful. A future mixed-
precision path could use float SpMV with double residual correction, but a float-only path would need
evidence before becoming the reference.

### 8. Website data and narrative

The source beacon is fixed. Therefore one native distance field supports arbitrary visitor starts. A
click raycasts to a face and barycentric point; browser tracing follows that exported field. Six
additional heat solves provide the diffusion animation. Log quantization preserves many orders of
magnitude while keeping the payload under 1 MB.

The narrative state machine exposes one action at a time. Advanced implementation details appear only
after the answer. Mobile keeps a 43–46% viewport scene above the text; reduced motion freezes approach,
pulse timing, and smooth scroll without removing content.

### 9. Validation and measured result

The most useful analytic tests are:

- planar Euclidean distance on a regular domain;
- great-circle distance \(\arccos(p\cdot q)\) on a refined unit sphere;
- constant-gradient, symmetry, row-sum, and positive-mass invariants;
- direct/iterative and conditional CPU/CUDA agreement;
- true residuals and deterministic repeated exports.

On the 10,242-vertex primary world, the exported local solve had a heat residual around
\(10^{-16}\) and a Poisson residual around \(10^{-13}\). CPU timings are measured. No NVIDIA device
was available, so the correct CUDA statement is “implemented and compile-covered, runtime timing
unavailable,” not “GPU-accelerated by X.”

## Concepts to be able to draw on a whiteboard

### Triangle mesh and halfedge

Draw two adjacent triangles. Put one arrow on each side of each triangle. Label `next` around a face,
`twin` across the shared edge, `origin`, `face`, and `edge`. Explain that a boundary arrow lacks a
twin.

### Intrinsic versus extrinsic

Draw two points on a bent sheet. Draw a 3D chord and a route on the sheet. Say: intrinsic quantities
depend only on the metric—edge lengths and angles—not how the surface is embedded.

### Cotangent Laplacian

Draw edge \(ij\) and opposite angles \(\alpha,\beta\). Write

\[
w_{ij}=\tfrac12(\cot\alpha+\cot\beta),
\quad L_{ij}=-w_{ij},
\quad L_{ii}=\sum_jw_{ij}.
\]

Then add: the code assembles triangle energy contributions, which is safer than treating this formula
as an arbitrary graph weight.

### Mass matrix

Shade a triangle into three equal area contributions. Explain why plain identity would ignore sampling
density, while mass weights integrate vertex functions over the surface.

### Heat Method

Write the three equations with the sign convention. Emphasize direction first, magnitude discarded,
distance reconstructed second.

### PCG

Draw the loop `SpMV → reductions → vector updates → precondition → repeat`. Explain memory bandwidth,
not peak FLOPS, as the dominant sparse concern.

## Likely interview questions and concise answers

### Why not just use Dijkstra?

Dijkstra solves the edge graph exactly, not the continuous surface problem. Its route is restricted to
edge directions and depends on triangulation. It is still a valuable baseline and was faster than the
Heat query at the largest measured local CPU sizes.

### Is the Heat Method exact?

No. It is a finite-element approximation that converges under refinement. The result depends on mesh
quality and timestep. Exact polyhedral geodesic algorithms are a different family with different cost
and robustness tradeoffs.

### Why does normalizing the heat gradient help?

The short-time heat field's magnitude decays rapidly and is not itself distance. Its gradient direction
is much more stable: it aligns with geodesics. Normalization retains that directional information and
removes the decay scale.

### Why is there a Poisson solve?

The normalized face vectors are local and may not be perfectly integrable. Poisson finds the global
scalar field whose gradient best matches them in the least-squares/weak sense.

### Why is the Laplacian singular?

Adding a constant does not change a gradient, so constants are in the nullspace. A single pin or a
mean-zero constraint fixes the gauge.

### Why lumped rather than consistent mass?

Lumped mass is positive, diagonal, cheap, and standard for this Heat Method discretization. A
consistent mass matrix can improve some FEM properties but increases coupling and changes cost.

### What happens with obtuse triangles?

Individual cotangent weights can be negative. The triangle stiffness energy remains the fundamental
assembly object, but poor elements harm conditioning and monotonicity. An intrinsic Delaunay
Laplacian is the clearest next robustness improvement.

### Why direct factorization and iterative solves?

Direct factors are robust and excellent when many right-hand sides reuse one mesh. Iterative methods
use less factor memory and expose parallel SpMV, but require good preconditioning and convergence
monitoring. The project implements both so comparisons are empirical.

### What makes the CUDA path nontrivial?

It accelerates the sparse linear solve itself, not vertex coloring. CSR matrices and work vectors remain
resident; cuSPARSE handles SpMV, PCG runs on device, custom kernels fuse updates and geometry work,
and transfer/warm-up/residual costs are accounted separately.

### Why isn't there a GPU speedup number?

The development machine has no NVIDIA device or CUDA toolchain. Publishing a number would be
fabrication. The CUDA source is guarded and compiled in CI; runtime comparison activates on a real
device.

### How do you know the browser path is genuine?

The C++ exporter writes the native distance field, triangle indices, and face adjacency. The click is
raycast to an actual face, and TypeScript repeats the barycentric face-crossing algorithm on that field.
There is no authored spline or radial distance shader.

### Where can numerical error enter?

Mesh approximation, element quality, timestep choice, FEM discretization, sparse solve tolerance,
normalization of tiny gradients, Poisson integration, and path integration/crossing tolerance. The tests
isolate several of these, but they cannot prove accuracy on every possible mesh.

### What would you improve next?

Intrinsic Delaunay edge flips, a stronger GPU preconditioner, mixed-precision iterative refinement,
more boundary-condition variants, exact-geodesic comparison on certified meshes, and runtime GPU
benchmarks on multiple architectures.

## Honest limitations and safe answers

- **Non-manifold data:** rejected. Say this is a deliberate contract, not hidden unsupported behavior.
- **Degenerate faces:** reject by default or skip explicitly before topology construction.
- **Bad conditioning:** residual checks detect failed solves, but do not repair bad meshes. Intrinsic
  triangulation or remeshing is future work.
- **Critical points:** face tracing may stall; the monotone vertex fallback prioritizes termination over
  smoothness.
- **Boundary:** natural Neumann is supported. General Dirichlet/mixed data is not a CLI feature.
- **Multiple sources:** source construction can support them; the public export intentionally uses one
  fixed beacon to avoid choice overload.
- **CUDA performance:** unmeasured locally. Never infer a speedup from CPU scaling or kernel design.
- **Million-face claim:** the data structures and benchmark generator allow larger subdivisions, but the
  largest recorded local case is 81,920 faces. Say “architecture targets,” not “measured at,” millions.

## Codebase map

| Concept | Implementation | Evidence |
|---|---|---|
| Halfedge construction and validation | `native/src/mesh.cpp` | `testHalfedgeInvariants`, malformed tests |
| One-ring and boundary traversal | `native/src/mesh.cpp` | `testAdjacencyAndBoundary` |
| Procedural icosphere/world | `native/src/procedural.cpp` | deterministic solve/export tests |
| Areas, normals, lengths | `native/src/mesh.cpp` | `testAreaAndNormals` |
| Cotangents, mass, Laplacian | `native/src/operators.cpp` | `testOperators` |
| Face gradient and weak load | `native/src/operators.cpp` | constant-gradient and solver tests |
| Heat/Poisson direct and iterative solves | `native/src/heat_method.cpp` | residual, determinism, agreement tests |
| Edge-Dijkstra baseline | `native/src/dijkstra.cpp` | `testDijkstraBaseline` |
| Barycentric face tracing | `native/src/path.cpp` | flat-domain path test |
| OBJ/CSV/path/binary I/O | `native/src/io.cpp` | CLI export plus web parser tests |
| CUDA PCG | `native/cuda/cuda_solver.cu` | conditional CPU/CUDA test and CUDA CI |
| CUDA geometry/normalization | `native/cuda/geometry_kernels.cu` | CUDA CI and device execution path |
| Native benchmark | `native/benchmarks/benchmark_main.cpp` | `data/benchmarks.cpu.json` |
| Binary parser | `web/src/world-data.ts` | `web/tests/world-data.test.ts` |
| Browser face trace | `web/src/path-tracer.ts` | far-face export test |
| Persistent visualization | `web/src/world-scene.ts` | five-viewport Playwright suite |
| Narrative state/accessibility | `web/src/main.ts`, `web/index.html`, `web/src/style.css` | E2E and screenshot QA |
| Binary schema | `data/schema.md` | parser length and metadata checks |

## Final pre-interview checklist

Be able to:

1. state the sign convention without hesitation;
2. derive one barycentric gradient and one cotangent entry;
3. explain why the mass matrix is present;
4. explain the nullspace and pin;
5. contrast preprocessing with per-query cost;
6. trace one face crossing with barycentric coordinates;
7. draw PCG's device-resident data flow;
8. quote measured CPU results without implying a GPU result;
9. name intrinsic Delaunay triangulation as the main robustness extension;
10. point to the exact files above rather than speaking only at a conceptual level.
