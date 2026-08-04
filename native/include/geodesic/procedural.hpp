#pragma once

#include "geodesic/mesh.hpp"

#include <cstdint>

namespace geodesic {

struct TorusOptions {
  int majorSegments{160};
  int minorSegments{64};
  double majorRadius{1.28};
  double minorRadius{0.46};
  double relief{0.18};
  std::uint32_t seed{0x5EED1234u};
};

TriangleMesh makeIcosphere(int subdivisions, double radius = 1.0);
TriangleMesh makeCurvedWorld(const TorusOptions& options = {});
Index selectCurvedWorldBeacon(const TriangleMesh& mesh, const TorusOptions& options = {});
TriangleMesh makePlanarGrid(int rows, int columns, double spacing = 1.0);

} // namespace geodesic
