# Interview Guide: Heat Method Geodesics on Multi-Handle Worlds

This guide separates the mathematical problem, the numerical implementation, the procedural geometry, and the browser presentation.

## The 30-second explanation

> I implemented the Heat Method for approximate geodesic distance on triangle meshes in C++20 and Eigen. The public site offers native-generated closed surfaces from genus one through five, with a sculptural two-handled world as the default. Genus 3 is embedded as a rounded triangle, Genus 4 as a diamond, and Genus 5 as a five-point rosette. C++ extracts and validates each manifold mesh, assembles cotangent and lumped-mass operators, factors the sparse systems, solves heat and Poisson equations, computes edge Dijkstra, traces three official paths across triangle interiors, and exports the complete state. TypeScript independently validates topology and payload consistency, then Three.js renders those native results. Genus changes the world's global topology; the solver remains the same mesh-based numerical method.

## The two-minute explanation

The straight segment between two surface points is shortest in surrounding three-dimensional space, but it can cut through a handle or leave the surface. A legal intrinsic route must stay on the surface. Edge Dijkstra respects that broad constraint, but it can move only along triangle edges, so it is exact for the edge graph and directionally biased as an approximation to surface distance.

The native pipeline stores an oriented halfedge mesh and assembles a diagonal lumped mass matrix M and a positive-semidefinite cotangent stiffness matrix L approximating -Delta. For source impulse delta it solves

    (M + tL)u = M delta, with t = h^2.

The short-time heat field contains directional distance information. C++ computes the normalized face field

    X = -grad(u) / |grad(u)|

and reconstructs a scalar distance field through a pinned Poisson solve

    L phi = b_X.

Pinning removes the constant nullspace. The result is shifted so the source distance is zero. Both solves report true relative residuals, and both sparse factorizations are reusable for later sources on the same mesh.

A native tracer starts at a barycentric point, follows decreasing phi inside a triangle, determines which barycentric coordinate reaches zero first, crosses the corresponding halfedge twin, and repeats. Three semantic starts share one source, one field, and one Dijkstra tree. The exporter rejects any official route that misses the source, needs fallback, loops, or has implausible measurements.

For geometry, C++ forms a smooth implicit neighborhood of a deterministic embedded loop graph whose cycle rank is the requested genus. Genus 1 preserves an irregular ring, Genus 2 preserves a folded double loop, and Genus 3 through Genus 5 use petal loops meeting at one shared central junction. Marching tetrahedra extracts the boundary. Shared grid-edge intersections produce indexed connectivity. Face adjacency enforces consistent orientation, mild smoothing and reprojection improve quality, and validation derives Euler characteristic and genus from the final mesh.

The browser first loads only a small manifest and Genus 2. It lazily fetches Genus 1, Genus 3, Genus 4, and Genus 5 on selection, caches them, validates their triangles and metadata, and replaces one scene on the same canvas. It never constructs a fake handle or fake field.

## Why multi-handle surfaces are a strong demonstration

A sphere has simple topology and no handles. A multi-handle world makes the distinction between ambient and intrinsic distance immediately visible and creates competing route classes around different holes. It also shows that the Heat Method is a mesh algorithm rather than a formula specialized to a torus parameterization.

The five selectable genera test several layers at once:

- global topology changes while local triangle operators keep the same definition;
- source and route authoring cannot rely on one rectangular parameter grid;
- camera framing must adapt to actual geometry;
- data loading must be metadata-driven;
- the same solver and tracer must remain robust as the mesh and homotopy structure change.

The stronger demonstration is not that higher genus makes the linear algebra different. It is that the same genus-independent machinery works on five topologically distinct, validated surfaces.

## Topology versus shape language

Genus is the number of handles for these connected closed orientable worlds. Triangle, diamond, and star describe how the loop graph is embedded and how the resulting surface reads from the authored camera; those silhouettes do not determine topology by themselves. A triangular-looking surface could have the wrong number of handles, and a star outline is not permission to use a self-intersecting star polygon.

The embedded graph's cycle rank is `E_graph - V_graph + 1` because the graph is connected. Thickening that graph produces a regular neighborhood whose boundary has the same genus as the cycle rank. Genus 3, Genus 4, and Genus 5 therefore use three, four, and five petal cycles joined at one central vertex without adding a cycle between petals. The exporter still does not trust this design argument: it recovers genus from the final marching-tetrahedra mesh.

## How topology is validated

For a connected closed orientable triangulation,

    chi = V - E + F = 2 - 2g
    g = 1 - chi / 2.

C++ builds the mesh and verifies:

- finite vertices and positive-area faces;
- no duplicate directed edges or duplicate faces;
- exactly two oppositely oriented faces per edge;
- one connected component and no boundary;
- one cyclic incident triangle fan at every vertex;
- positive signed volume for outward global orientation;
- exact chi and recovered genus matching the request.

The browser does not trust metadata blindly. It rebuilds the undirected edge map and face components from the binary triangles, checks adjacency and winding, recomputes chi, genus, boundary count, and signed volume, then compares those values with metadata.

## What changes when genus changes

These items are regenerated and refactored:

- implicit geometry and extracted topology;
- bounds, center, normals, and quality metrics;
- semantic landmark SurfacePoints;
- source vertex and all field samples;
- mass and stiffness matrices;
- heat and Poisson factorizations;
- Heat Method and Dijkstra fields;
- official path polylines and route measurements;
- camera framing and route controls.

These concepts remain independent of genus:

- halfedge semantics;
- face basis gradients;
- mass and cotangent stiffness assembly;
- backward Euler heat diffusion;
- normalized gradient direction;
- weak Poisson reconstruction;
- sparse factor reuse within one mesh;
- edge Dijkstra as a baseline;
- barycentric face-interior tracing;
- the binary parser's invariant checks.

## Detailed numerical walkthrough

### The three distance problems

1. The ambient chord may move anywhere in R3.
2. Edge Dijkstra may move only along graph edges.
3. The Heat trace may cross triangle interiors but must stay on the triangulated surface.

A smaller chord answers a less constrained problem. Dijkstra is exact in a more restricted domain. The Heat route approximates intrinsic distance on the discrete surface and is not proof of the exact continuous geodesic.

### Halfedge representation

Each triangular face owns three directed halfedges. A halfedge stores origin, next, twin, edge, and face:

- three next steps traverse a face;
- twin crosses a shared edge;
- a missing twin identifies a boundary;
- opposite directed shared edges make orientation explicit.

Construction rejects invalid indices, repeated triangle vertices, small or non-finite area, duplicate directed edges, more than two faces on an edge, broken cycles, invalid twins, and disconnected vertex fans.

### Discrete geometry and operators

For triangle p0, p1, p2:

    2A = |(p1 - p0) cross (p2 - p0)|
    n = ((p1 - p0) cross (p2 - p0)) / (2A).

The piecewise-linear barycentric basis gradients are constant within the triangle. For a vertex field u,

    grad(u)_f = sum_i u_i grad(b_i).

The local stiffness is

    L^f_ij = A_f grad(b_i) dot grad(b_j),

equivalent to cotangent weights. Local energy assembly makes symmetry and zero row sums explicit. Obtuse triangles may contribute an individual negative cotangent; the implementation does not silently clamp it.

The lumped mass assigns A_f / 3 to each face vertex, so every valid closed-mesh vertex receives positive mass.

### Heat solve

Backward Euler produces M + tL because L uses the positive stiffness convention. The source right-hand side represents a unit impulse. The practical choice t = h^2 ties diffusion distance to mesh scale.

Heat is largest near the source, so grad(u) points toward hotter values. Its negative points approximately toward increasing distance. Normalization discards magnitude decay while preserving direction. Genuinely vanishing gradients are counted in metadata.

### Weak Poisson reconstruction

Independently normalized face vectors need not integrate to one exact scalar function. The weak load is

    (b_X)_i = sum over incident faces of A_f grad(b_i) dot X_f.

Solving L phi = b_X finds the finite-element scalar field whose gradient best agrees with the direction field. Constants lie in the nullspace because gradients cannot detect a global offset. Pinning one value makes the factorization nonsingular; subtracting the source value establishes distance zero.

### Reusable sparse solves

HeatMethodSolver records and separates:

1. operator assembly;
2. heat and pinned-Poisson factorization;
3. a source-dependent heat solve and face directions;
4. a source-dependent Poisson solve.

The direct path uses Eigen::SimplicialLDLT. The iterative option uses conjugate gradient with incomplete Cholesky. The factors are reusable only while the mesh and time scale stay fixed. Changing genus replaces the mesh, so preprocessing must run again.

Both solve reports calculate

    ||Ax - b||_2 / max(||b||_2, 1e-30)

from the returned solution.

### Face-interior route tracing

Within a triangle phi is linear and grad(phi) is constant. The tracer converts -grad(phi) into barycentric coordinate velocities, finds the first positive time at which one coordinate reaches zero, moves to that edge, and enters the adjacent face.

Guards detect repeated faces, vanishing gradients, non-finite or invalid barycentric states, boundary exits, and excessive steps. A generic monotone one-ring recovery exists for arbitrary inputs, but an official route is invalid when it is used.

## Project-specific geometry walkthrough

The surface generator is not presented as part of Crane's DDG course.

1. A deterministic implicit field describes a smooth union of rounded loop tubes.
2. Cycle rank one through five sets the intended topology.
3. Genus-specific centers, loop widths, lobe depths, and low-frequency modulation change composition without random vertex noise.
4. A fixed six-tetrahedra cube split extracts the zero set.
5. A cache gives adjacent tetrahedra the same interpolated grid-edge vertex.
6. The implicit gradient fixes outward triangle winding.
7. Duplicate and degenerate faces are removed.
8. Recorded genus-specific tangential smoothing and reprojection passes improve triangle placement; a deterministic grid offset avoids near-grid slivers on the denser rosettes.
9. Native topology and quality checks accept or reject the result.
10. World-space landmark anchors are mapped to valid nearby SurfacePoints.

The default Genus 2 world is designed as two unequal rounded lobes sharing a smooth central neck, so both holes read from the opening camera. The higher-genus embeddings read as a rounded triangle, a diamond, and a five-point rosette while retaining smooth organic tubes and controlled depth.

## Native route authoring and export

Outer ridge, Central neck, and Basin rim are semantic world-space landmarks, not toroidal u-v coordinates. C++ maps them to face and barycentric starts, searches local candidates when needed, and validates:

- successful source arrival without recovery;
- several native polyline points;
- finite positive values;
- ambient chord shorter than legal surface paths;
- conservative Heat-to-Dijkstra ratio;
- distinct start positions and route measurements.

Binary schema v3 stores one concatenated native-path point array. Metadata v4 gives each route's offset and count and records source SurfacePoint, topology, signed volume, bounds, quality, generator choices, display-frame times, residuals, and solver conventions.

## Path time versus display diffusion time

The authoritative path solve always uses the Heat Method convention `t = h^2`. That short-time field supplies the normalized directions used by Poisson reconstruction and native path tracing.

The visible release uses nine additional C++ solves at multipliers `0.18, 0.45, 1, 2.5, 6.5, 18, 52, 150, 430` of `h^2`. Multipliers above one are visualization diffusion frames: they show heat reaching distant lobes but do not change the path solve. TypeScript interpolates only between adjacent exported frames. It never invents a radial front or feeds a later display field into the path.

## What C++ owns and what the browser owns

### C++ owns

- procedural geometry and topology;
- halfedge connectivity and invariant validation;
- normals, quality, bounds, and landmarks;
- sparse operators and factorizations;
- Heat Method and Dijkstra fields;
- nine native visualization diffusion frames and vector samples;
- official route tracing and measurements;
- deterministic binary, metadata, and manifest export.

### TypeScript owns

- fetching the manifest and selected native bundle;
- caching successful lazy loads;
- independently validating binary and metadata consistency;
- rebuilding controls from route metadata;
- presenting narrative and accessible state;
- retaining a browser tracer as a diagnostic cross-check.

### Three.js owns

- indexed rendering of validated native arrays;
- lighting, heat colors, markers, and route geometry;
- camera presentation and interaction;
- disposal when a genus changes.

Three.js does not own the surface definition, field computation, official path, or official measurements.

## Browser interaction

OrbitController owns target, azimuth, elevation, distance, desired state, and current state. It uses elapsed-time exponential damping:

- mouse and one-finger drag orbit with pointer capture;
- two touch pointers combine centroid orbit and pinch;
- Explore view maps trackpad wheel deltas to orbit;
- control-wheel and Safari gesture input zoom;
- outside Explore view, ordinary vertical wheel input scrolls the page;
- arrow keys orbit, plus and minus zoom, R resets, and Escape exits Explore view;
- controls focus the beacon or active route start;
- reduced motion disables idle movement and snaps heat to its final exported frame.

Changing genus destroys the old scene, reuses the same canvas, loads or retrieves the selected native bundle, resets transient state, and frames the actual bounding sphere without moving the page.

## Benchmark claims

The checked-in CPU benchmark records a Release build, compiler, host label, steady clock, double precision, one warm-up, eight distributed reused sources, seven Dijkstra repetitions, and residuals. It measures Genus 2 across a resolution sequence and reports generation, assembly, factorization, total preprocessing, one Heat query, reused Heat queries, and Dijkstra separately.

Do not describe it as a universal race. Dijkstra solves an edge-graph shortest-path problem. The Heat Method constructs an approximate surface-distance field. Preprocessing should not be charged to every later source when factors are reused.

## Limitations to state plainly

- Each world is a finite mesh approximation to a smooth implicit surface.
- Heat Method distance and the traced polyline are approximate.
- Triangle quality and the diffusion scale influence error.
- A tracer can encounter critical regions on arbitrary fields.
- Dijkstra is restricted to edge directions.
- Multiple homotopy classes can have nearly equal route lengths.
- Discrete topology checks do not constitute a general continuous collision proof.
- CPU computation is an intentional scope decision.

## Common questions

### Why not use Three.js torus geometry or browser CSG?

That would disconnect the figure from the numerical mesh. The visible vertices, topology, source, fields, routes, and measurements must be the state C++ solved.

### Why does the Heat Method apply when genus changes?

The finite-element operators are local to triangles and their incidence. Genus changes global connectivity, spectrum, landmarks, and paths, but not the definitions of mass, stiffness, gradient, weak divergence, or the heat and Poisson steps.

### Why use Dijkstra if it is not the target answer?

It is deterministic, exact on the edge graph, easy to reconstruct from predecessors, and exposes the directional restriction caused by moving only along mesh edges.

### Why pin Poisson?

Adding a constant to every distance does not change its gradient. Pinning selects one representative so the sparse system can be factored. A final shift puts zero at the source.

### Why t = h squared?

Diffusion time has units of length squared. Scaling by mean edge length squared makes the pulse duration track mesh scale, following the Heat Method's practical recommendation.

### How do you know each requested genus is real?

C++ and the browser independently build the edge set from the extracted faces, compute chi = V - E + F, verify connectedness and closure, then recover g = 1 - chi / 2. Metadata is compared with that derived result.

### Why do triangle, diamond, and rosette not prove the topology?

Those words describe an embedding and silhouette. Genus is a connectivity invariant. The generator uses a loop graph with the intended cycle rank, but acceptance still depends on recovering the exact Euler characteristic and genus from the final connected, closed, oriented manifold mesh.

### Why are later heat frames allowed if the method uses a short time?

They are presentation-only PDE solves. The distance field and route use `t = h^2`; later times help a visitor see diffusion cross more handles. Metadata explicitly records that display frames are not used by the path solve.

### What should never be overstated?

The official native polyline approximates a geodesic on a discrete surface. It is not proof of the exact shortest path on the underlying smooth world, especially when several route classes have similar lengths.
