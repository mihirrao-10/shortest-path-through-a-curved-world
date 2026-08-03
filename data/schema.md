# `geodesic-world-v1` binary schema

`web/public/data/world.bin` is a deterministic, little-endian export from the
C++ engine. The browser does not solve or fabricate a replacement distance
field. It interpolates and traces this exported piecewise-linear field.

The byte stream contains, in order:

1. 8-byte ASCII magic `GEOWRLD1`;
2. seven `uint32` values: version, vertex count, face count, heat-frame count,
   gradient-sample count, source vertex, and a reserved zero;
3. `float64` mean edge length and Heat Method time step;
4. heat-frame time, log-minimum, and log-maximum arrays (`float64`);
5. positions and area-weighted vertex normals (`float32`, xyz per vertex);
6. triangle indices (`uint32`) and face adjacency across each opposite edge
   (`int32`, `-1` for a boundary);
7. Heat Method distance and edge-Dijkstra distance (`float32` per vertex);
8. Dijkstra predecessor (`uint32` per vertex, `0xffffffff` if absent);
9. each real heat solution as `log(u)`, linearly quantized to `uint16` using
   that frame's stored minimum and maximum;
10. adaptive direction samples: face `uint32`, position xyz `float32`, and
    normalized direction xyz `float32`.

`world.meta.json` records dimensions, residuals, timings, operator convention,
the deterministic procedural seed, and whether a measured CUDA result exists.
