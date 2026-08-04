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

double periodicBump(double angle, double center, double concentration) {
  return std::exp(concentration * (std::cos(angle - center) - 1.0));
}

double seedPhase(std::uint32_t seed) {
  const double twoPi = 2.0 * std::acos(-1.0);
  return twoPi * static_cast<double>(seed % 10007U) / 10007.0;
}

Index nearestPeriodicIndex(double angle, int segmentCount) {
  const double twoPi = 2.0 * std::acos(-1.0);
  double wrapped = std::fmod(angle, twoPi);
  if (wrapped < 0.0) {
    wrapped += twoPi;
  }
  const auto rounded =
      static_cast<long long>(std::llround(wrapped * static_cast<double>(segmentCount) / twoPi));
  return static_cast<Index>((rounded % segmentCount + segmentCount) % segmentCount);
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

TriangleMesh makeCurvedWorld(const TorusOptions& options) {
  if (options.majorSegments < 12 || options.minorSegments < 8 || options.majorSegments > 2048 ||
      options.minorSegments > 1024 || !(options.majorRadius > 0.0) ||
      !(options.minorRadius > 0.0) || options.majorRadius <= 2.1 * options.minorRadius ||
      !(options.relief >= 0.0) || options.relief > 0.3 || !std::isfinite(options.majorRadius) ||
      !std::isfinite(options.minorRadius) || !std::isfinite(options.relief)) {
    throw std::invalid_argument("invalid curved-world parameters");
  }

  const double twoPi = 2.0 * std::acos(-1.0);
  const double phase = seedPhase(options.seed);
  std::vector<Vec3> positions;
  positions.reserve(static_cast<std::size_t>(options.majorSegments * options.minorSegments));
  for (int major = 0; major < options.majorSegments; ++major) {
    const double u =
        twoPi * static_cast<double>(major) / static_cast<double>(options.majorSegments);
    const Vec3 radial(std::cos(u), std::sin(u), 0.0);
    const Vec3 tangent(-std::sin(u), std::cos(u), 0.0);

    const double broadAsymmetry = 0.035 * std::cos(u - 0.35 + 0.08 * phase) +
                                  0.022 * std::sin(2.0 * u + 0.4) +
                                  0.012 * std::cos(3.0 * u - phase);
    const double centerRadius = options.majorRadius * (1.0 + broadAsymmetry);
    const double centerHeight =
        options.majorRadius * options.relief *
        (0.16 * std::sin(u - 0.3) + 0.055 * std::sin(3.0 * u + 0.25 * phase));
    const double thickness =
        options.minorRadius * (1.0 + 0.10 * std::cos(u - 1.15) + 0.035 * std::sin(2.0 * u + phase));
    const double twist =
        options.relief * (0.42 * std::sin(u + 0.2) + 0.13 * std::sin(3.0 * u - phase));

    for (int minor = 0; minor < options.minorSegments; ++minor) {
      const double v =
          twoPi * static_cast<double>(minor) / static_cast<double>(options.minorSegments);
      const double tubeAngle = v + twist;

      const double ridgeCenter = 0.14 + 0.20 * std::sin(2.0 * u - 0.5);
      const double ridge = periodicBump(u, 0.48, 9.0) * periodicBump(v, ridgeCenter, 20.0);

      const double basinCore = periodicBump(u, 2.34, 15.0) * periodicBump(v, 0.72, 16.0);
      const double basinShoulder = periodicBump(u, 2.34, 6.0) * periodicBump(v, 0.72, 6.5);
      const double basin = -0.88 * basinCore + 0.30 * (basinShoulder - basinCore);

      const double saddleWindow =
          periodicBump(u, 4.08, 10.0) * periodicBump(v, std::acos(-1.0), 7.0);
      const double saddle = 0.34 * saddleWindow *
                            (std::cos(2.0 * (u - 4.08)) - std::cos(2.0 * (v - std::acos(-1.0))));
      const double innerPass =
          -0.28 * periodicBump(u, 4.08, 13.0) * periodicBump(v, std::acos(-1.0), 14.0);
      const double broadWarp = 0.11 * std::sin(2.0 * v - u + 0.35 * phase);

      const double localScale = std::max(
          0.72, 1.0 + options.relief * (0.92 * ridge + basin + saddle + innerPass + broadWarp));
      const double radialOffset = thickness * localScale * std::cos(tubeAngle);
      const double verticalOffset =
          thickness * localScale * (0.96 + 0.035 * std::cos(2.0 * u - 0.2)) * std::sin(tubeAngle);
      const double tangentOffset =
          options.minorRadius * options.relief *
          (0.11 * std::sin(2.0 * v + 3.0 * u) + 0.12 * ridge * std::sin(v - ridgeCenter));

      positions.push_back((centerRadius + radialOffset) * radial + tangentOffset * tangent +
                          Vec3(0.0, 0.0, centerHeight + verticalOffset));
    }
  }

  std::vector<Triangle> faces;
  faces.reserve(static_cast<std::size_t>(2 * options.majorSegments * options.minorSegments));
  const auto index = [&options](int major, int minor) {
    return static_cast<Index>(major * options.minorSegments + minor);
  };
  for (int major = 0; major < options.majorSegments; ++major) {
    const int nextMajor = (major + 1) % options.majorSegments;
    for (int minor = 0; minor < options.minorSegments; ++minor) {
      const int nextMinor = (minor + 1) % options.minorSegments;
      const Index a = index(major, minor);
      const Index b = index(nextMajor, minor);
      const Index c = index(major, nextMinor);
      const Index d = index(nextMajor, nextMinor);

      // Increasing u crossed with increasing v follows the analytic outward tube normal.
      // This winding remains correct on the inner ring, where an origin-dot-normal rule fails.
      faces.push_back({a, b, d});
      faces.push_back({a, d, c});
    }
  }
  return TriangleMesh::build(positions, faces);
}

Index selectCurvedWorldBeacon(const TriangleMesh& mesh, const TorusOptions& options) {
  const std::size_t expectedVertexCount =
      static_cast<std::size_t>(options.majorSegments * options.minorSegments);
  if (mesh.vertices().size() != expectedVertexCount) {
    throw std::invalid_argument("beacon selection requires a nonempty mesh");
  }
  const Index major = nearestPeriodicIndex(5.63, options.majorSegments);
  const Index minor = nearestPeriodicIndex(5.58, options.minorSegments);
  return major * static_cast<Index>(options.minorSegments) + minor;
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
