#include "geodesic/procedural.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
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

double ridge(double value, double width) {
  return std::exp(-(value * value) / width);
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

TriangleMesh makeCurvedWorld(const PlanetOptions& options) {
  TriangleMesh sphere = makeIcosphere(options.subdivisions, 1.0);
  std::vector<Vec3> positions;
  positions.reserve(sphere.vertices().size());
  const double phase = static_cast<double>(options.seed % 10007U) / 10007.0;
  for (const auto& vertex : sphere.vertices()) {
    const Vec3 q = vertex.position.normalized();
    const double broad = 0.42 * std::sin(3.4 * q.x() + 1.1 * q.y() - 0.7 + phase) *
                             std::cos(3.1 * q.z() - 0.8 * q.x()) +
                         0.23 * std::sin(7.3 * (q.x() - 0.45 * q.y() + 0.32 * q.z()));
    const double foldedRidge = 0.38 * ridge(std::sin(2.5 * q.x() + 1.7 * q.z()) - 0.25, 0.035);
    const double valley = -0.34 * ridge(q.x() + 0.35, 0.055) * ridge(q.z() - 0.15, 0.18);
    const double passage = -0.21 * ridge(q.y() + 0.08, 0.018) * std::cos(5.0 * q.x());
    const double radial =
        options.radius * (1.0 + options.relief * (broad + foldedRidge + valley + passage));
    const Vec3 tangentWarp = options.radius * options.relief * 0.035 *
                             std::sin(5.0 * q.z() + 2.0 * q.x()) *
                             Vec3(-q.y(), q.x(), 0.35 * q.y());
    positions.push_back(radial * q + tangentWarp);
  }
  std::vector<Triangle> faces;
  faces.reserve(sphere.faces().size());
  for (const auto& face : sphere.faces()) {
    faces.push_back(face.vertices);
  }
  orientOutward(positions, faces);
  return TriangleMesh::build(positions, faces);
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
