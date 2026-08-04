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

double ridge(double value, double width) {
  return std::exp(-(value * value) / width);
}

double sphericalFeature(const Vec3& direction, const Vec3& center, double width) {
  const double separation = 1.0 - std::clamp(direction.dot(center.normalized()), -1.0, 1.0);
  return std::exp(-(separation * separation) / width);
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
  if (options.subdivisions < 1 || options.subdivisions > 8 || !(options.radius > 0.0) ||
      !(options.relief >= 0.0) || options.relief > 0.4 || !std::isfinite(options.radius) ||
      !std::isfinite(options.relief)) {
    throw std::invalid_argument("invalid curved-world parameters");
  }
  TriangleMesh sphere = makeIcosphere(options.subdivisions, 1.0);
  std::vector<Vec3> positions;
  positions.reserve(sphere.vertices().size());
  const double twoPi = 2.0 * std::acos(-1.0);
  const double phase = twoPi * static_cast<double>(options.seed % 10007U) / 10007.0;
  const Vec3 basinCenter = Vec3(-0.58, 0.48, 0.66).normalized();
  const Vec3 ridgeCenter = Vec3(0.28, 0.70, 0.66).normalized();
  const Vec3 saddleCenter = Vec3(-0.10, -0.91, 0.40).normalized();
  for (const auto& vertex : sphere.vertices()) {
    const Vec3 q = vertex.position.normalized();
    const double broad = 0.30 * std::sin(2.8 * q.x() + 1.2 * q.y() - 0.6 + phase) *
                             std::cos(2.4 * q.z() - 0.7 * q.x()) +
                         0.16 * std::sin(5.3 * (q.x() - 0.42 * q.y() + 0.30 * q.z()) - 0.3 * phase);

    // A raised, folded seam. The spherical window keeps it local while the narrow band makes
    // the ridge readable in silhouette instead of turning the whole world into a corrugation.
    const double ridgeBand = q.y() - 0.30 * std::sin(2.7 * q.z() + 0.4);
    const double foldedRidge =
        0.92 * ridge(ridgeBand, 0.018) * sphericalFeature(q, ridgeCenter, 0.42);

    // The basin is intentionally deeper and wider than the old valley term. A small raised rim
    // gives routes around it a visible navigational choice without producing an overhang.
    const double basinCore = sphericalFeature(q, basinCenter, 0.050);
    const double basinRim = sphericalFeature(q, basinCenter, 0.16) - basinCore;
    const double valley = -1.05 * basinCore + 0.24 * basinRim;

    // A localized hyperbolic term creates a saddle/pass. It remains radial and smooth, so the
    // surface stays star-shaped and the existing outward-orientation rule remains valid.
    const Vec3 saddleDelta = q - saddleCenter;
    const double saddleWindow = sphericalFeature(q, saddleCenter, 0.12);
    const double saddle = 0.72 * saddleWindow * (3.2 * saddleDelta.x() * saddleDelta.z());

    // Compress a narrow channel between two fuller lobes. The longitudinal window prevents the
    // channel from becoming a global waist.
    const double channelBand = q.x() + 0.10 + 0.17 * std::sin(3.0 * q.z());
    const double channelWindow = ridge(q.y() - 0.05, 0.22) * ridge(q.z() + 0.12, 0.30);
    const double passage = -0.72 * ridge(channelBand, 0.014) * channelWindow;

    const double unequalLobes = 0.34 * q.x() + 0.13 * (q.x() * q.x() - q.y() * q.y());
    const double deformation = broad + foldedRidge + valley + saddle + passage + unequalLobes;
    const double radialScale = std::max(0.62, 1.0 + options.relief * deformation);

    // Moderate anisotropy establishes unequal axes before local relief is applied.
    const Vec3 anisotropic(1.20 * q.x(), 0.86 * q.y(), 1.06 * q.z());
    Vec3 firstWarp(-q.y(), q.x(), 0.22 * q.y());
    firstWarp -= firstWarp.dot(q) * q;
    Vec3 secondWarp(q.z(), -0.18 * q.z(), -q.x());
    secondWarp -= secondWarp.dot(q) * q;
    const Vec3 tangentWarp =
        options.radius * options.relief *
        (0.105 * std::sin(3.8 * q.z() + 2.1 * q.x() + phase) * firstWarp +
         0.070 * std::cos(3.2 * q.y() - 1.7 * q.z() - 0.5 * phase) * secondWarp);
    positions.push_back(options.radius * radialScale * anisotropic + tangentWarp);
  }
  std::vector<Triangle> faces;
  faces.reserve(sphere.faces().size());
  for (const auto& face : sphere.faces()) {
    faces.push_back(face.vertices);
  }
  orientOutward(positions, faces);
  return TriangleMesh::build(positions, faces);
}

Index selectCurvedWorldBeacon(const TriangleMesh& mesh) {
  if (mesh.vertices().empty()) {
    throw std::invalid_argument("beacon selection requires a nonempty mesh");
  }
  const Vec3 target = Vec3(0.68, -0.34, -0.65).normalized();
  Index best = 0;
  double bestDot = -std::numeric_limits<double>::infinity();
  for (Index vertex = 0; vertex < mesh.vertices().size(); ++vertex) {
    const double score = mesh.vertices()[vertex].position.normalized().dot(target);
    if (score > bestDot) {
      bestDot = score;
      best = vertex;
    }
  }
  return best;
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
