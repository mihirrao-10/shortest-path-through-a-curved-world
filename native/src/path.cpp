#include "geodesic/path.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <vector>

namespace geodesic {
namespace {

bool barycentricInside(const std::array<double, 3>& barycentric, double tolerance) {
  for (const double value : barycentric) {
    if (value < -tolerance || value > 1.0 + tolerance || !std::isfinite(value)) {
      return false;
    }
  }
  return true;
}

double interpolatedDistance(const TriangleMesh& mesh, Index face,
                            const std::array<double, 3>& barycentric, const Vector& distance) {
  const Triangle& triangle = mesh.faces()[face].vertices;
  double value = 0.0;
  for (int local = 0; local < 3; ++local) {
    value += barycentric[static_cast<std::size_t>(local)] *
             distance[static_cast<int>(triangle[static_cast<std::size_t>(local)])];
  }
  return value;
}

Vec3 distanceGradient(const TriangleMesh& mesh, const std::vector<FaceGeometry>& geometry,
                      const Vector& distance, Index face) {
  Vec3 gradient = Vec3::Zero();
  const Triangle& triangle = mesh.faces()[face].vertices;
  for (int local = 0; local < 3; ++local) {
    gradient += distance[static_cast<int>(triangle[static_cast<std::size_t>(local)])] *
                geometry[face].barycentricGradients[static_cast<std::size_t>(local)];
  }
  return gradient;
}

bool appendVertexFallback(const TriangleMesh& mesh, const Vector& distance, Index sourceVertex,
                          Index initialVertex, std::size_t maxSteps, PathResult& result) {
  std::vector<bool> visited(mesh.vertices().size(), false);
  Index current = initialVertex;
  for (std::size_t step = 0; step < maxSteps; ++step) {
    if (visited[current]) {
      result.termination = "cycle detected during vertex fallback";
      return false;
    }
    visited[current] = true;
    const Vec3& point = mesh.vertices()[current].position;
    if (result.points.empty() || (result.points.back() - point).norm() > 1e-12) {
      result.points.push_back(point);
    }
    if (current == sourceVertex) {
      result.reachedSource = true;
      result.termination = "reached source with monotone vertex fallback";
      return true;
    }

    Index best = kInvalidIndex;
    double bestDistance = distance[static_cast<int>(current)];
    for (const Index neighbor : mesh.oneRing(current)) {
      const double candidate = distance[static_cast<int>(neighbor)];
      if (candidate + 1e-12 < bestDistance ||
          (std::abs(candidate - bestDistance) <= 1e-12 && neighbor == sourceVertex)) {
        bestDistance = candidate;
        best = neighbor;
      }
    }
    if (best == kInvalidIndex) {
      result.termination = "critical point has no decreasing one-ring neighbor";
      return false;
    }
    current = best;
  }
  result.termination = "vertex fallback exceeded maximum steps";
  return false;
}

} // namespace

std::array<double, 3> barycentricCoordinates(const TriangleMesh& mesh, Index face,
                                             const Vec3& point) {
  if (face >= mesh.faces().size()) {
    throw std::invalid_argument("barycentric face is out of range");
  }
  const Triangle& triangle = mesh.faces()[face].vertices;
  const Vec3& a = mesh.vertices()[triangle[0]].position;
  const Vec3& b = mesh.vertices()[triangle[1]].position;
  const Vec3& c = mesh.vertices()[triangle[2]].position;
  const Vec3 v0 = b - a;
  const Vec3 v1 = c - a;
  const Vec3 v2 = point - a;
  const double d00 = v0.dot(v0);
  const double d01 = v0.dot(v1);
  const double d11 = v1.dot(v1);
  const double d20 = v2.dot(v0);
  const double d21 = v2.dot(v1);
  const double denominator = d00 * d11 - d01 * d01;
  if (!(std::abs(denominator) > 1e-30) || !std::isfinite(denominator)) {
    throw MeshError("cannot compute barycentric coordinates on a degenerate face");
  }
  const double v = (d11 * d20 - d01 * d21) / denominator;
  const double w = (d00 * d21 - d01 * d20) / denominator;
  return {1.0 - v - w, v, w};
}

Vec3 interpolateSurfacePoint(const TriangleMesh& mesh, const SurfacePoint& point) {
  if (point.face >= mesh.faces().size()) {
    throw std::invalid_argument("surface point face is out of range");
  }
  const Triangle& triangle = mesh.faces()[point.face].vertices;
  Vec3 result = Vec3::Zero();
  for (int local = 0; local < 3; ++local) {
    result += point.barycentric[static_cast<std::size_t>(local)] *
              mesh.vertices()[triangle[static_cast<std::size_t>(local)]].position;
  }
  return result;
}

PathResult traceDistanceGradient(const TriangleMesh& mesh,
                                 const std::vector<FaceGeometry>& geometry, const Vector& distance,
                                 Index sourceVertex, const SurfacePoint& start,
                                 PathOptions options) {
  if (geometry.size() != mesh.faces().size() ||
      distance.size() != static_cast<Eigen::Index>(mesh.vertices().size()) ||
      sourceVertex >= mesh.vertices().size() || start.face >= mesh.faces().size() ||
      !barycentricInside(start.barycentric, 1e-8)) {
    throw std::invalid_argument("invalid path-tracing input");
  }
  if (options.maxSteps == 0 || !(options.sourceRadiusScale > 0.0) ||
      !(options.edgeEpsilonScale > 0.0) || !(options.criticalGradientEpsilon > 0.0)) {
    throw std::invalid_argument("invalid path-tracing options");
  }

  PathResult result;
  Index face = start.face;
  Vec3 point = interpolateSurfacePoint(mesh, start);
  result.points.push_back(point);
  const Vec3 source = mesh.vertices()[sourceVertex].position;
  const double meanEdge = mesh.meanEdgeLength();
  const double sourceRadius = options.sourceRadiusScale * meanEdge;
  const double nudge = options.edgeEpsilonScale * meanEdge;
  std::vector<unsigned int> faceVisits(mesh.faces().size(), 0U);

  auto fallback = [&](Index currentFace) {
    if (!options.enableVertexFallback) {
      return false;
    }
    result.usedFallback = true;
    const Triangle& triangle = mesh.faces()[currentFace].vertices;
    Index best = triangle[0];
    for (int local = 1; local < 3; ++local) {
      const Index candidate = triangle[static_cast<std::size_t>(local)];
      if (distance[static_cast<int>(candidate)] < distance[static_cast<int>(best)]) {
        best = candidate;
      }
    }
    return appendVertexFallback(mesh, distance, sourceVertex, best,
                                options.maxSteps - std::min(options.maxSteps, result.faceCrossings),
                                result);
  };

  for (std::size_t step = 0; step < options.maxSteps; ++step) {
    if ((point - source).norm() <= sourceRadius) {
      if ((result.points.back() - source).norm() > 1e-12) {
        result.points.push_back(source);
      }
      result.reachedSource = true;
      result.termination = "entered the source neighborhood";
      return result;
    }
    if (++faceVisits[face] > 3U) {
      result.termination = "face cycle detected";
      fallback(face);
      return result;
    }

    std::array<double, 3> barycentric = barycentricCoordinates(mesh, face, point);
    const double fieldValue = interpolatedDistance(mesh, face, barycentric, distance);
    if (fieldValue <= sourceRadius) {
      result.points.push_back(source);
      result.reachedSource = true;
      result.termination = "distance field entered the source neighborhood";
      return result;
    }

    const Vec3 gradient = distanceGradient(mesh, geometry, distance, face);
    const double norm = gradient.norm();
    if (!std::isfinite(norm) || norm <= options.criticalGradientEpsilon) {
      result.termination = "piecewise-linear gradient vanished at a critical face";
      fallback(face);
      return result;
    }
    const Vec3 direction = -gradient / norm;

    double crossingTime = std::numeric_limits<double>::infinity();
    int crossedLocal = -1;
    std::array<double, 3> barycentricVelocity{};
    for (int local = 0; local < 3; ++local) {
      barycentricVelocity[static_cast<std::size_t>(local)] =
          geometry[face].barycentricGradients[static_cast<std::size_t>(local)].dot(direction);
      const double velocity = barycentricVelocity[static_cast<std::size_t>(local)];
      if (velocity < -1e-14) {
        const double candidate = -barycentric[static_cast<std::size_t>(local)] / velocity;
        if (candidate > nudge * 0.01 && candidate < crossingTime) {
          crossingTime = candidate;
          crossedLocal = local;
        }
      }
    }

    if (crossedLocal < 0 || !std::isfinite(crossingTime)) {
      result.termination = "descent ray did not cross a triangle edge";
      fallback(face);
      return result;
    }

    const Vec3 crossing = point + crossingTime * direction;
    if ((crossing - result.points.back()).norm() > nudge * 0.01) {
      result.points.push_back(crossing);
    }
    ++result.faceCrossings;

    std::vector<int> candidateEdges;
    for (int local = 0; local < 3; ++local) {
      const double velocity = barycentricVelocity[static_cast<std::size_t>(local)];
      if (velocity < -1e-14) {
        const double candidate = -barycentric[static_cast<std::size_t>(local)] / velocity;
        if (std::abs(candidate - crossingTime) <= std::max(nudge, crossingTime * 1e-8)) {
          candidateEdges.push_back(local);
        }
      }
    }

    Index nextFace = kInvalidIndex;
    Vec3 nextPoint = crossing;
    for (const int local : candidateEdges) {
      const Index candidateFace = mesh.adjacentFaceAcross(face, static_cast<Index>(local));
      if (candidateFace == kInvalidIndex) {
        continue;
      }
      const Vec3 nextGradient = distanceGradient(mesh, geometry, distance, candidateFace);
      if (nextGradient.norm() <= options.criticalGradientEpsilon) {
        continue;
      }
      const Vec3 candidatePoint = crossing - nudge * nextGradient.normalized();
      const auto candidateBarycentric = barycentricCoordinates(mesh, candidateFace, candidatePoint);
      if (barycentricInside(candidateBarycentric, 1e-5)) {
        nextFace = candidateFace;
        std::array<double, 3> clamped = candidateBarycentric;
        double sum = 0.0;
        for (double& value : clamped) {
          value = std::max(0.0, value);
          sum += value;
        }
        for (double& value : clamped) {
          value /= sum;
        }
        nextPoint = interpolateSurfacePoint(mesh, SurfacePoint{candidateFace, clamped});
        break;
      }
      if (nextFace == kInvalidIndex) {
        nextFace = candidateFace;
      }
    }

    if (nextFace == kInvalidIndex) {
      result.termination = "descent reached a mesh boundary";
      fallback(face);
      return result;
    }
    face = nextFace;
    point = nextPoint;
  }

  result.termination = "face tracing exceeded maximum steps";
  fallback(face);
  return result;
}

} // namespace geodesic
