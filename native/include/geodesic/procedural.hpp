#pragma once

#include "geodesic/mesh.hpp"

#include <cstdint>

namespace geodesic {

struct PlanetOptions {
  int subdivisions{4};
  std::uint32_t seed{0x5EED1234u};
  double radius{1.0};
  double relief{0.18};
};

TriangleMesh makeIcosphere(int subdivisions, double radius = 1.0);
TriangleMesh makeCurvedWorld(const PlanetOptions& options = {});
TriangleMesh makePlanarGrid(int rows, int columns, double spacing = 1.0);

} // namespace geodesic
