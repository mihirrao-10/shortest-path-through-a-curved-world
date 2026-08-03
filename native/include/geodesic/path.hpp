#pragma once

#include "geodesic/operators.hpp"

#include <array>
#include <string>
#include <vector>

namespace geodesic {

struct SurfacePoint {
  Index face{kInvalidIndex};
  std::array<double, 3> barycentric{1.0, 0.0, 0.0};
};

struct PathOptions {
  double sourceRadiusScale{1.5};
  double edgeEpsilonScale{1e-8};
  double criticalGradientEpsilon{1e-11};
  std::size_t maxSteps{10000};
  bool enableVertexFallback{true};
};

struct PathResult {
  std::vector<Vec3> points;
  bool reachedSource{false};
  bool usedFallback{false};
  std::size_t faceCrossings{0};
  std::string termination;
};

std::array<double, 3> barycentricCoordinates(const TriangleMesh& mesh, Index face,
                                             const Vec3& point);
Vec3 interpolateSurfacePoint(const TriangleMesh& mesh, const SurfacePoint& point);

PathResult traceDistanceGradient(const TriangleMesh& mesh,
                                 const std::vector<FaceGeometry>& geometry, const Vector& distance,
                                 Index sourceVertex, const SurfacePoint& start,
                                 PathOptions options = {});

} // namespace geodesic
