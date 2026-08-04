#include "geodesic/procedural.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <unordered_map>
#include <vector>

namespace geodesic {
namespace {

std::uint64_t edgeKey(Index a, Index b) {
  if (b < a) {
    std::swap(a, b);
  }
  return (static_cast<std::uint64_t>(a) << 32U) | static_cast<std::uint64_t>(b);
}

void orientOutward(std::vector<Vec3>& vertices, std::vector<Triangle>& faces) {
  for (Triangle& face : faces) {
    const Vec3 normal =
        (vertices[face[1]] - vertices[face[0]]).cross(vertices[face[2]] - vertices[face[0]]);
    const Vec3 center = vertices[face[0]] + vertices[face[1]] + vertices[face[2]];
    if (normal.dot(center) < 0.0) {
      std::swap(face[1], face[2]);
    }
  }
}

Index nearestVertex(const TriangleMesh& mesh, const Vec3& target) {
  Index best = 0;
  double bestSquaredDistance = std::numeric_limits<double>::infinity();
  for (Index vertex = 0; vertex < mesh.vertices().size(); ++vertex) {
    const double squaredDistance = (mesh.vertices()[vertex].position - target).squaredNorm();
    if (squaredDistance < bestSquaredDistance) {
      bestSquaredDistance = squaredDistance;
      best = vertex;
    }
  }
  return best;
}

} // namespace

TriangleMesh makeIcosphere(int subdivisions, double radius) {
  if (subdivisions < 0 || subdivisions > 8 || !(radius > 0.0) || !std::isfinite(radius)) {
    throw std::invalid_argument("invalid icosphere parameters");
  }
  const double golden = (1.0 + std::sqrt(5.0)) * 0.5;
  std::vector<Vec3> vertices{{-1, golden, 0}, {1, golden, 0}, {-1, -golden, 0}, {1, -golden, 0},
                             {0, -1, golden}, {0, 1, golden}, {0, -1, -golden}, {0, 1, -golden},
                             {golden, 0, -1}, {golden, 0, 1}, {-golden, 0, -1}, {-golden, 0, 1}};
  for (Vec3& vertex : vertices) {
    vertex.normalize();
  }
  std::vector<Triangle> faces{{0, 11, 5}, {0, 5, 1},  {0, 1, 7},   {0, 7, 10}, {0, 10, 11},
                              {1, 5, 9},  {5, 11, 4}, {11, 10, 2}, {10, 7, 6}, {7, 1, 8},
                              {3, 9, 4},  {3, 4, 2},  {3, 2, 6},   {3, 6, 8},  {3, 8, 9},
                              {4, 9, 5},  {2, 4, 11}, {6, 2, 10},  {8, 6, 7},  {9, 8, 1}};

  for (int level = 0; level < subdivisions; ++level) {
    std::unordered_map<std::uint64_t, Index> midpointCache;
    midpointCache.reserve(faces.size() * 3U / 2U);
    auto midpoint = [&](Index a, Index b) {
      const std::uint64_t key = edgeKey(a, b);
      const auto found = midpointCache.find(key);
      if (found != midpointCache.end()) {
        return found->second;
      }
      Vec3 point = (vertices[a] + vertices[b]).normalized();
      const Index index = static_cast<Index>(vertices.size());
      vertices.push_back(point);
      midpointCache.emplace(key, index);
      return index;
    };

    std::vector<Triangle> refined;
    refined.reserve(faces.size() * 4U);
    for (const Triangle& face : faces) {
      const Index ab = midpoint(face[0], face[1]);
      const Index bc = midpoint(face[1], face[2]);
      const Index ca = midpoint(face[2], face[0]);
      refined.push_back({face[0], ab, ca});
      refined.push_back({face[1], bc, ab});
      refined.push_back({face[2], ca, bc});
      refined.push_back({ab, bc, ca});
    }
    faces = std::move(refined);
  }
  for (Vec3& vertex : vertices) {
    vertex *= radius;
  }
  orientOutward(vertices, faces);
  return TriangleMesh::build(vertices, faces);
}

TriangleMesh makeCurvedWorld(const CurvedWorldOptions& options) {
  if (options.detailLevel < 1 || options.detailLevel > 8 || !(options.majorRadius > 0.0) ||
      !(options.minorRadius > 0.0) || options.majorRadius <= 1.65 * options.minorRadius ||
      !(options.deformation >= 0.0) || options.deformation > 0.35 ||
      !std::isfinite(options.majorRadius) || !std::isfinite(options.minorRadius) ||
      !std::isfinite(options.deformation)) {
    throw std::invalid_argument("invalid curved-world parameters");
  }

  const int majorSegments = 5 * (1 << options.detailLevel);
  const int minorSegments = 2 * (1 << options.detailLevel);
  const double twoPi = 2.0 * std::acos(-1.0);
  const double phase = twoPi * static_cast<double>(options.seed % 10007U) / 10007.0;
  std::vector<Vec3> positions;
  positions.reserve(static_cast<std::size_t>(majorSegments * minorSegments));
  for (int major = 0; major < majorSegments; ++major) {
    const double u = twoPi * static_cast<double>(major) / static_cast<double>(majorSegments);
    const Vec3 radial(std::cos(u), std::sin(u), 0.0);
    const Vec3 tangent(-std::sin(u), std::cos(u), 0.0);
    const double centerRadius =
        options.majorRadius *
        (1.0 + options.deformation *
                   (0.28 * std::sin(3.0 * u + phase) + 0.16 * std::cos(5.0 * u - 0.4 * phase)));
    const double centerHeight =
        options.majorRadius * options.deformation *
        (0.20 * std::sin(2.0 * u + 0.7 * phase) + 0.07 * std::cos(5.0 * u - phase));
    for (int minor = 0; minor < minorSegments; ++minor) {
      const double v = twoPi * static_cast<double>(minor) / static_cast<double>(minorSegments);
      const double tubeScale =
          1.0 + options.deformation * (0.36 * std::sin(3.0 * u + phase) +
                                       0.16 * std::cos(2.0 * v - 2.0 * u + 0.3 * phase));
      const double radialOffset =
          options.minorRadius * tubeScale * (1.0 + 0.06 * std::sin(u + 2.0 * v)) * std::cos(v);
      const double verticalOffset =
          options.minorRadius * tubeScale * (0.92 + 0.06 * std::cos(2.0 * u - phase)) * std::sin(v);
      const double tangentOffset =
          options.minorRadius * options.deformation * 0.10 * std::sin(2.0 * v + 3.0 * u + phase);
      positions.push_back((centerRadius + radialOffset) * radial + tangentOffset * tangent +
                          Vec3(0.0, 0.0, centerHeight + verticalOffset));
    }
  }

  std::vector<Triangle> faces;
  faces.reserve(static_cast<std::size_t>(majorSegments * minorSegments * 2));
  const auto index = [minorSegments](int major, int minor) {
    return static_cast<Index>(major * minorSegments + minor);
  };
  for (int major = 0; major < majorSegments; ++major) {
    const int nextMajor = (major + 1) % majorSegments;
    for (int minor = 0; minor < minorSegments; ++minor) {
      const int nextMinor = (minor + 1) % minorSegments;
      const Index a = index(major, minor);
      const Index b = index(nextMajor, minor);
      const Index c = index(major, nextMinor);
      const Index d = index(nextMajor, nextMinor);
      faces.push_back({a, b, d});
      faces.push_back({a, d, c});
    }
  }
  return TriangleMesh::build(positions, faces);
}

CurvedWorldLandmarks selectCurvedWorldLandmarks(const TriangleMesh& mesh) {
  if (mesh.vertices().empty()) {
    throw std::invalid_argument("landmark selection requires a nonempty mesh");
  }
  CurvedWorldLandmarks result;
  result.source = nearestVertex(mesh, Vec3(0.82, -1.20, 0.34));
  result.exterior = nearestVertex(mesh, Vec3(1.42, 0.66, 0.08));
  result.tunnel = nearestVertex(mesh, Vec3(-0.54, 0.26, 0.08));

  double farthestSquaredDistance = -1.0;
  const Vec3 sourcePosition = mesh.vertices()[result.source].position;
  for (Index vertex = 0; vertex < mesh.vertices().size(); ++vertex) {
    const Vec3& position = mesh.vertices()[vertex].position;
    const double radialDistance = std::hypot(position.x(), position.y());
    if (radialDistance < 0.9) {
      continue;
    }
    const double squaredDistance = (position - sourcePosition).squaredNorm();
    if (squaredDistance > farthestSquaredDistance) {
      farthestSquaredDistance = squaredDistance;
      result.farSide = vertex;
    }
  }
  if (result.farSide == kInvalidIndex) {
    throw std::runtime_error("could not select the far-side landmark");
  }
  return result;
}

TriangleMesh makePlanarGrid(int rows, int columns, double spacing) {
  if (rows < 2 || columns < 2 || !(spacing > 0.0) || !std::isfinite(spacing)) {
    throw std::invalid_argument("invalid planar-grid parameters");
  }
  std::vector<Vec3> positions;
  positions.reserve(static_cast<std::size_t>(rows * columns));
  for (int row = 0; row < rows; ++row) {
    for (int column = 0; column < columns; ++column) {
      positions.emplace_back(static_cast<double>(column) * spacing,
                             static_cast<double>(row) * spacing, 0.0);
    }
  }
  std::vector<Triangle> faces;
  faces.reserve(static_cast<std::size_t>((rows - 1) * (columns - 1) * 2));
  for (int row = 0; row + 1 < rows; ++row) {
    for (int column = 0; column + 1 < columns; ++column) {
      const Index a = static_cast<Index>(row * columns + column);
      const Index b = a + 1U;
      const Index c = static_cast<Index>((row + 1) * columns + column);
      const Index d = c + 1U;
      faces.push_back({a, b, d});
      faces.push_back({a, d, c});
    }
  }
  return TriangleMesh::build(positions, faces);
}

} // namespace geodesic
