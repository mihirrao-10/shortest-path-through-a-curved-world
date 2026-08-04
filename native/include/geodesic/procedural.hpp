#pragma once

#include "geodesic/mesh.hpp"

#include <cstdint>

namespace geodesic {

struct CurvedWorldOptions {
  int detailLevel{5};
  std::uint32_t seed{0x5EED1234u};
  double majorRadius{1.08};
  double minorRadius{0.48};
  double deformation{0.14};
};

struct CurvedWorldLandmarks {
  Index source{kInvalidIndex};
  Index exterior{kInvalidIndex};
  Index tunnel{kInvalidIndex};
  Index farSide{kInvalidIndex};
};

TriangleMesh makeIcosphere(int subdivisions, double radius = 1.0);
TriangleMesh makeCurvedWorld(const CurvedWorldOptions& options = {});
CurvedWorldLandmarks selectCurvedWorldLandmarks(const TriangleMesh& mesh);
TriangleMesh makePlanarGrid(int rows, int columns, double spacing = 1.0);

} // namespace geodesic
