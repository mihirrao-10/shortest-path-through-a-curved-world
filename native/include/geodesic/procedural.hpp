#pragma once

#include "geodesic/path.hpp"

#include <array>
#include <cstdint>
#include <string>

namespace geodesic {

struct CurvedWorldOptions {
  int genus{2};
  int resolution{64};
  double tubeRadius{0.30};
  double relief{0.16};
  std::uint32_t seed{0x5EED1234u};
};

struct WorldLandmark {
  std::string id;
  std::string label;
  Vec3 anchor{Vec3::Zero()};
  Vec3 preferredNormal{Vec3::Zero()};
  SurfacePoint point{};
};

struct WorldLandmarks {
  WorldLandmark source;
  std::array<WorldLandmark, 3> routeStarts;
};

struct WorldTopology {
  long long eulerCharacteristic{0};
  int recoveredGenus{0};
  std::size_t connectedComponents{0};
  std::size_t boundaryEdges{0};
  double signedVolume{0.0};
};

struct WorldGeneratorMetadata {
  std::string composition;
  std::string junction;
  int cycleRank{0};
  int centerlineSamples{0};
  double ringRadius{0.0};
  double loopWidth{0.0};
  double effectiveTubeRadius{0.0};
  double smoothMinimumRadius{0.0};
  Vec3 gridOffsetFractions{Vec3::Zero()};
  int smoothingPasses{0};
  int reprojectionPasses{0};
  Vec3 samplingMinimum{Vec3::Zero()};
  Vec3 samplingMaximum{Vec3::Zero()};
};

struct GeneratedCurvedWorld {
  TriangleMesh mesh;
  WorldLandmarks landmarks;
  WorldTopology topology;
  WorldGeneratorMetadata generator;
  Vec3 center{Vec3::Zero()};
  double boundingRadius{0.0};
};

TriangleMesh makeIcosphere(int subdivisions, double radius = 1.0);
GeneratedCurvedWorld generateCurvedWorld(const CurvedWorldOptions& options = {});
TriangleMesh makePlanarGrid(int rows, int columns, double spacing = 1.0);

} // namespace geodesic
