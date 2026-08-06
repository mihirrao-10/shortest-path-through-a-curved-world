#include "geodesic/procedural.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <numbers>
#include <queue>
#include <set>
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

void orientSphereOutward(std::vector<Vec3>& vertices, std::vector<Triangle>& faces) {
  for (Triangle& face : faces) {
    const Vec3 normal =
        (vertices[face[1]] - vertices[face[0]]).cross(vertices[face[2]] - vertices[face[0]]);
    const Vec3 center = vertices[face[0]] + vertices[face[1]] + vertices[face[2]];
    if (normal.dot(center) < 0.0) {
      std::swap(face[1], face[2]);
    }
  }
}

double seedPhase(std::uint32_t seed) {
  return 2.0 * std::numbers::pi * static_cast<double>(seed % 10007U) / 10007.0;
}

struct ImplicitWorld {
  CurvedWorldOptions options;
  double ringRadius{0.78};
  double spacing{1.68};
  double effectiveTubeRadius{0.30};
  double phase{0.0};
  std::vector<double> centers;

  explicit ImplicitWorld(const CurvedWorldOptions& input)
      : options(input), phase(seedPhase(input.seed)) {
    if (options.genus == 1) {
      ringRadius = 0.98;
      spacing = 0.0;
      effectiveTubeRadius = options.tubeRadius * 1.05;
    } else if (options.genus == 2) {
      ringRadius = 0.78;
      spacing = 2.0 * ringRadius + 0.11;
      effectiveTubeRadius = options.tubeRadius;
    } else {
      ringRadius = 0.59;
      spacing = 2.0 * ringRadius + 0.10;
      effectiveTubeRadius = options.tubeRadius * 0.88;
    }
    centers.reserve(static_cast<std::size_t>(options.genus));
    for (int lobe = 0; lobe < options.genus; ++lobe) {
      centers.push_back((static_cast<double>(lobe) - 0.5 * static_cast<double>(options.genus - 1)) *
                        spacing);
    }
  }

  [[nodiscard]] double smoothMinimum(double first, double second) const {
    const double blendRadius = 0.22 * effectiveTubeRadius;
    const double h = std::clamp(0.5 + 0.5 * (second - first) / blendRadius, 0.0, 1.0);
    return second * (1.0 - h) + first * h - blendRadius * h * (1.0 - h);
  }

  [[nodiscard]] double value(const Vec3& position) const {
    const double relief = options.relief;
    Vec3 point = position;
    point.x() += relief * (0.045 * std::sin(1.25 * position.y() + 0.35 * phase) +
                           0.018 * std::sin(2.1 * position.z() - phase));
    point.y() += relief * (0.038 * std::sin(0.92 * position.x() - 0.2 * phase));
    point.z() += relief * (0.030 * std::sin(0.75 * position.x() + 1.1 * position.y() + phase));

    double field = std::numeric_limits<double>::infinity();
    for (int lobe = 0; lobe < options.genus; ++lobe) {
      const double localX = point.x() - centers[static_cast<std::size_t>(lobe)];
      const double horizontalScale = 1.0 +
                                     0.025 * std::sin(phase + 1.7 * static_cast<double>(lobe)) +
                                     (lobe % 2 == 0 ? 0.018 : -0.014);
      const double localY = point.y() / horizontalScale;
      const double angle = std::atan2(localY, localX);
      const double lobeRadius =
          ringRadius * (1.0 + 0.025 * std::sin(phase + 1.31 * static_cast<double>(lobe)));
      const double radiusModulation =
          1.0 + relief * (0.12 * std::sin(2.0 * angle + phase + 0.8 * lobe) +
                          0.055 * std::cos(3.0 * angle - 0.45 * phase));
      const double localTubeRadius = effectiveTubeRadius * radiusModulation;
      const double centerHeight =
          relief * effectiveTubeRadius *
          (0.24 * std::sin(angle - 0.35 + 0.5 * lobe) + 0.08 * std::sin(3.0 * angle + phase));
      const double verticalScale =
          0.94 + 0.035 * std::cos(angle + 0.55 * static_cast<double>(lobe));
      const double radialDistance = std::hypot(localX, localY) - lobeRadius;
      const double verticalDistance = (point.z() - centerHeight) / verticalScale;
      double lobeField = std::hypot(radialDistance, verticalDistance) - localTubeRadius;

      // A broad ridge and shallow basin provide readable relief without high-frequency noise.
      const double outerSide = std::cos(angle);
      lobeField -=
          relief * effectiveTubeRadius *
          (0.055 * std::exp(-3.2 * (angle - 0.42) * (angle - 0.42)) * (0.55 + 0.45 * outerSide) -
           0.035 * std::exp(-2.4 * (angle + 1.7) * (angle + 1.7)));
      field = lobe == 0 ? lobeField : smoothMinimum(field, lobeField);
    }
    return field;
  }

  [[nodiscard]] Vec3 gradient(const Vec3& point, double step = 1e-5) const {
    Vec3 gradient;
    for (int axis = 0; axis < 3; ++axis) {
      Vec3 positive = point;
      Vec3 negative = point;
      positive[axis] += step;
      negative[axis] -= step;
      gradient[axis] = (value(positive) - value(negative)) / (2.0 * step);
    }
    return gradient;
  }

  [[nodiscard]] Vec3 minimumBounds() const {
    const double margin = 0.34;
    return Vec3(centers.front() - ringRadius - effectiveTubeRadius - margin,
                -ringRadius - effectiveTubeRadius - margin,
                -effectiveTubeRadius * 1.25 - margin * 0.45);
  }

  [[nodiscard]] Vec3 maximumBounds() const {
    const double margin = 0.34;
    return Vec3(centers.back() + ringRadius + effectiveTubeRadius + margin,
                ringRadius + effectiveTubeRadius + margin,
                effectiveTubeRadius * 1.25 + margin * 0.45);
  }
};

struct Grid {
  Vec3 minimum{Vec3::Zero()};
  double spacing{0.0};
  std::array<int, 3> points{};
  std::vector<double> values;

  [[nodiscard]] Index index(int x, int y, int z) const {
    return static_cast<Index>((z * points[1] + y) * points[0] + x);
  }

  [[nodiscard]] Vec3 position(int x, int y, int z) const {
    return minimum +
           spacing * Vec3(static_cast<double>(x), static_cast<double>(y), static_cast<double>(z));
  }
};

Grid sampleGrid(const ImplicitWorld& field) {
  const Vec3 minimum = field.minimumBounds();
  const Vec3 maximum = field.maximumBounds();
  const Vec3 extent = maximum - minimum;
  const double spacing = extent.maxCoeff() / static_cast<double>(field.options.resolution);
  Grid grid;
  grid.minimum = minimum;
  grid.spacing = spacing;
  for (int axis = 0; axis < 3; ++axis) {
    grid.points[axis] = static_cast<int>(std::ceil(extent[axis] / spacing)) + 1;
  }
  const std::size_t count = static_cast<std::size_t>(grid.points[0]) *
                            static_cast<std::size_t>(grid.points[1]) *
                            static_cast<std::size_t>(grid.points[2]);
  grid.values.resize(count);
  for (int z = 0; z < grid.points[2]; ++z) {
    for (int y = 0; y < grid.points[1]; ++y) {
      for (int x = 0; x < grid.points[0]; ++x) {
        const Index index = grid.index(x, y, z);
        // The irrational offset prevents a level-set vertex from landing exactly on a grid point.
        grid.values[index] = field.value(grid.position(x, y, z)) + 1.0e-12 * std::numbers::sqrt2;
      }
    }
  }
  return grid;
}

struct ExtractedSurface {
  std::vector<Vec3> vertices;
  std::vector<Triangle> faces;
};

ExtractedSurface extractSurface(const ImplicitWorld& field, const Grid& grid) {
  constexpr std::array<std::array<int, 3>, 8> kCornerOffset{{
      {0, 0, 0},
      {1, 0, 0},
      {0, 1, 0},
      {1, 1, 0},
      {0, 0, 1},
      {1, 0, 1},
      {0, 1, 1},
      {1, 1, 1},
  }};
  constexpr std::array<std::array<int, 4>, 6> kTetrahedra{{
      {0, 1, 3, 7},
      {0, 3, 2, 7},
      {0, 2, 6, 7},
      {0, 6, 4, 7},
      {0, 4, 5, 7},
      {0, 5, 1, 7},
  }};

  ExtractedSurface surface;
  std::unordered_map<std::uint64_t, Index> intersectionCache;
  const std::size_t estimated = static_cast<std::size_t>(field.options.resolution) *
                                static_cast<std::size_t>(field.options.resolution) * 8U;
  surface.vertices.reserve(estimated);
  surface.faces.reserve(estimated * 2U);
  intersectionCache.reserve(estimated * 2U);

  auto intersection = [&](Index first, Index second, const Vec3& firstPosition,
                          const Vec3& secondPosition, double firstValue, double secondValue) {
    const std::uint64_t key = edgeKey(first, second);
    const auto existing = intersectionCache.find(key);
    if (existing != intersectionCache.end()) {
      return existing->second;
    }
    const double denominator = firstValue - secondValue;
    const double ratio = std::clamp(firstValue / denominator, 0.0, 1.0);
    const Index result = static_cast<Index>(surface.vertices.size());
    surface.vertices.push_back(firstPosition + ratio * (secondPosition - firstPosition));
    intersectionCache.emplace(key, result);
    return result;
  };

  auto appendOriented = [&](Index a, Index b, Index c) {
    if (a == b || b == c || c == a) {
      return;
    }
    Triangle face{a, b, c};
    const Vec3 centroid = (surface.vertices[a] + surface.vertices[b] + surface.vertices[c]) / 3.0;
    const Vec3 normal = (surface.vertices[b] - surface.vertices[a])
                            .cross(surface.vertices[c] - surface.vertices[a]);
    if (normal.dot(field.gradient(centroid, grid.spacing * 0.02)) < 0.0) {
      std::swap(face[1], face[2]);
    }
    surface.faces.push_back(face);
  };

  for (int z = 0; z + 1 < grid.points[2]; ++z) {
    for (int y = 0; y + 1 < grid.points[1]; ++y) {
      for (int x = 0; x + 1 < grid.points[0]; ++x) {
        std::array<Index, 8> indices{};
        std::array<Vec3, 8> positions{};
        std::array<double, 8> values{};
        for (int corner = 0; corner < 8; ++corner) {
          const auto& offset = kCornerOffset[static_cast<std::size_t>(corner)];
          indices[static_cast<std::size_t>(corner)] =
              grid.index(x + offset[0], y + offset[1], z + offset[2]);
          positions[static_cast<std::size_t>(corner)] =
              grid.position(x + offset[0], y + offset[1], z + offset[2]);
          values[static_cast<std::size_t>(corner)] =
              grid.values[indices[static_cast<std::size_t>(corner)]];
        }

        for (const auto& tetrahedron : kTetrahedra) {
          std::array<int, 4> inside{};
          std::array<int, 4> outside{};
          int insideCount = 0;
          int outsideCount = 0;
          for (const int local : tetrahedron) {
            if (values[static_cast<std::size_t>(local)] < 0.0) {
              inside[static_cast<std::size_t>(insideCount++)] = local;
            } else {
              outside[static_cast<std::size_t>(outsideCount++)] = local;
            }
          }
          if (insideCount == 0 || insideCount == 4) {
            continue;
          }
          auto crossing = [&](int first, int second) {
            return intersection(
                indices[static_cast<std::size_t>(first)], indices[static_cast<std::size_t>(second)],
                positions[static_cast<std::size_t>(first)],
                positions[static_cast<std::size_t>(second)],
                values[static_cast<std::size_t>(first)], values[static_cast<std::size_t>(second)]);
          };
          if (insideCount == 1) {
            appendOriented(crossing(inside[0], outside[0]), crossing(inside[0], outside[1]),
                           crossing(inside[0], outside[2]));
          } else if (insideCount == 3) {
            appendOriented(crossing(outside[0], inside[0]), crossing(outside[0], inside[1]),
                           crossing(outside[0], inside[2]));
          } else {
            const Index ac = crossing(inside[0], outside[0]);
            const Index ad = crossing(inside[0], outside[1]);
            const Index bc = crossing(inside[1], outside[0]);
            const Index bd = crossing(inside[1], outside[1]);
            const double firstDiagonal =
                (surface.vertices[ac] - surface.vertices[bd]).squaredNorm();
            const double secondDiagonal =
                (surface.vertices[ad] - surface.vertices[bc]).squaredNorm();
            if (firstDiagonal <= secondDiagonal) {
              appendOriented(ac, ad, bd);
              appendOriented(ac, bd, bc);
            } else {
              appendOriented(ac, ad, bc);
              appendOriented(ad, bd, bc);
            }
          }
        }
      }
    }
  }

  std::set<std::array<Index, 3>> uniqueFaces;
  std::vector<Triangle> filtered;
  filtered.reserve(surface.faces.size());
  for (const Triangle& face : surface.faces) {
    std::array<Index, 3> key{face[0], face[1], face[2]};
    std::sort(key.begin(), key.end());
    if (uniqueFaces.insert(key).second) {
      filtered.push_back(face);
    }
  }
  surface.faces = std::move(filtered);
  return surface;
}

std::vector<std::vector<Index>> buildNeighbors(std::size_t vertexCount,
                                               const std::vector<Triangle>& faces) {
  std::vector<std::vector<Index>> neighbors(vertexCount);
  for (const Triangle& face : faces) {
    for (int local = 0; local < 3; ++local) {
      const Index vertex = face[static_cast<std::size_t>(local)];
      neighbors[vertex].push_back(face[static_cast<std::size_t>((local + 1) % 3)]);
      neighbors[vertex].push_back(face[static_cast<std::size_t>((local + 2) % 3)]);
    }
  }
  for (auto& ring : neighbors) {
    std::sort(ring.begin(), ring.end());
    ring.erase(std::unique(ring.begin(), ring.end()), ring.end());
  }
  return neighbors;
}

void improveSurface(const ImplicitWorld& field, ExtractedSurface& surface) {
  const auto neighbors = buildNeighbors(surface.vertices.size(), surface.faces);
  for (int pass = 0; pass < 4; ++pass) {
    std::vector<Vec3> next = surface.vertices;
    for (std::size_t vertex = 0; vertex < surface.vertices.size(); ++vertex) {
      if (neighbors[vertex].empty()) {
        continue;
      }
      Vec3 average = Vec3::Zero();
      for (const Index neighbor : neighbors[vertex]) {
        average += surface.vertices[neighbor];
      }
      average /= static_cast<double>(neighbors[vertex].size());
      const Vec3 gradient = field.gradient(surface.vertices[vertex]);
      const double squaredNorm = gradient.squaredNorm();
      if (!(squaredNorm > 1e-16)) {
        continue;
      }
      const Vec3 normal = gradient / std::sqrt(squaredNorm);
      const Vec3 displacement = average - surface.vertices[vertex];
      next[vertex] += 0.34 * (displacement - normal * displacement.dot(normal));
      const Vec3 projectedGradient = field.gradient(next[vertex]);
      const double projectedSquaredNorm = projectedGradient.squaredNorm();
      if (projectedSquaredNorm > 1e-16) {
        next[vertex] -= field.value(next[vertex]) * projectedGradient / projectedSquaredNorm;
      }
    }
    surface.vertices = std::move(next);
  }
}

double signedVolume(const TriangleMesh& mesh) {
  double volume = 0.0;
  for (const auto& face : mesh.faces()) {
    const Vec3& a = mesh.vertices()[face.vertices[0]].position;
    const Vec3& b = mesh.vertices()[face.vertices[1]].position;
    const Vec3& c = mesh.vertices()[face.vertices[2]].position;
    volume += a.dot(b.cross(c)) / 6.0;
  }
  return volume;
}

std::size_t connectedComponentCount(const TriangleMesh& mesh) {
  std::vector<bool> visited(mesh.vertices().size(), false);
  std::size_t components = 0;
  std::queue<Index> queue;
  for (Index start = 0; start < mesh.vertices().size(); ++start) {
    if (visited[start]) {
      continue;
    }
    ++components;
    visited[start] = true;
    queue.push(start);
    while (!queue.empty()) {
      const Index current = queue.front();
      queue.pop();
      for (const Index neighbor : mesh.oneRing(current)) {
        if (!visited[neighbor]) {
          visited[neighbor] = true;
          queue.push(neighbor);
        }
      }
    }
  }
  return components;
}

std::pair<Vec3, std::array<double, 3>> closestPointOnTriangle(const Vec3& point, const Vec3& a,
                                                              const Vec3& b, const Vec3& c) {
  // Ericson's region tests produce both the closest point and valid barycentric coordinates.
  const Vec3 ab = b - a;
  const Vec3 ac = c - a;
  const Vec3 ap = point - a;
  const double d1 = ab.dot(ap);
  const double d2 = ac.dot(ap);
  if (d1 <= 0.0 && d2 <= 0.0)
    return {a, {1.0, 0.0, 0.0}};
  const Vec3 bp = point - b;
  const double d3 = ab.dot(bp);
  const double d4 = ac.dot(bp);
  if (d3 >= 0.0 && d4 <= d3)
    return {b, {0.0, 1.0, 0.0}};
  const double vc = d1 * d4 - d3 * d2;
  if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {
    const double v = d1 / (d1 - d3);
    return {a + v * ab, {1.0 - v, v, 0.0}};
  }
  const Vec3 cp = point - c;
  const double d5 = ab.dot(cp);
  const double d6 = ac.dot(cp);
  if (d6 >= 0.0 && d5 <= d6)
    return {c, {0.0, 0.0, 1.0}};
  const double vb = d5 * d2 - d1 * d6;
  if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {
    const double w = d2 / (d2 - d6);
    return {a + w * ac, {1.0 - w, 0.0, w}};
  }
  const double va = d3 * d6 - d5 * d4;
  if (va <= 0.0 && d4 - d3 >= 0.0 && d5 - d6 >= 0.0) {
    const double w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return {b + w * (c - b), {0.0, 1.0 - w, w}};
  }
  const double denominator = 1.0 / (va + vb + vc);
  const double v = vb * denominator;
  const double w = vc * denominator;
  return {a + ab * v + ac * w, {1.0 - v - w, v, w}};
}

SurfacePoint mapAnchorToSurface(const TriangleMesh& mesh, const Vec3& anchor,
                                const Vec3& preferredNormal) {
  Index bestFace = kInvalidIndex;
  std::array<double, 3> bestBarycentric{};
  double bestScore = std::numeric_limits<double>::infinity();
  const Vec3 preferred =
      preferredNormal.norm() > 1e-12 ? preferredNormal.normalized() : Vec3::Zero();
  for (Index face = 0; face < mesh.faces().size(); ++face) {
    const Triangle& triangle = mesh.faces()[face].vertices;
    const auto [closest, barycentric] = closestPointOnTriangle(
        anchor, mesh.vertices()[triangle[0]].position, mesh.vertices()[triangle[1]].position,
        mesh.vertices()[triangle[2]].position);
    const double normalPenalty =
        preferred.squaredNorm() > 0.0
            ? 0.08 * (1.0 - std::max(-0.2, mesh.faceNormal(face).dot(preferred)))
            : 0.0;
    const double score = (closest - anchor).squaredNorm() + normalPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestFace = face;
      bestBarycentric = barycentric;
    }
  }
  if (bestFace == kInvalidIndex) {
    throw std::runtime_error("could not map world landmark to the generated surface");
  }
  for (double& weight : bestBarycentric) {
    weight = 0.94 * weight + 0.02;
  }
  return SurfacePoint{bestFace, bestBarycentric};
}

WorldLandmarks buildLandmarks(const TriangleMesh& mesh, const ImplicitWorld& field) {
  const double left = field.centers.front() - field.ringRadius;
  const double right = field.centers.back() + field.ringRadius;
  const double top = field.ringRadius + field.effectiveTubeRadius * 0.72;
  const double z = field.effectiveTubeRadius * 0.82;
  const double firstNeck =
      field.options.genus == 1 ? 0.0 : 0.5 * (field.centers[0] + field.centers[1]);
  const double basinX = field.options.genus == 1 ? -0.35 * field.ringRadius : field.centers.front();

  WorldLandmarks landmarks;
  landmarks.source = {"beacon",
                      "Heat source",
                      Vec3(right, -0.30 * field.ringRadius, z),
                      Vec3(0.45, -0.2, 0.85),
                      {}};
  landmarks.routeStarts = {{
      {"outer-ridge",
       "Outer ridge",
       Vec3(left, 0.18 * field.ringRadius, z),
       Vec3(-0.55, 0.1, 0.82),
       {}},
      {"central-neck", "Central neck", Vec3(firstNeck, 0.0, -0.92 * z), Vec3(0.0, 0.0, -1.0), {}},
      {"basin-rim", "Basin rim", Vec3(basinX, top, 0.35 * z), Vec3(0.0, 0.75, 0.65), {}},
  }};
  landmarks.source.point =
      mapAnchorToSurface(mesh, landmarks.source.anchor, landmarks.source.preferredNormal);
  for (WorldLandmark& landmark : landmarks.routeStarts) {
    landmark.point = mapAnchorToSurface(mesh, landmark.anchor, landmark.preferredNormal);
  }
  return landmarks;
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
  for (Vec3& vertex : vertices)
    vertex.normalize();
  std::vector<Triangle> faces{{0, 11, 5}, {0, 5, 1},  {0, 1, 7},   {0, 7, 10}, {0, 10, 11},
                              {1, 5, 9},  {5, 11, 4}, {11, 10, 2}, {10, 7, 6}, {7, 1, 8},
                              {3, 9, 4},  {3, 4, 2},  {3, 2, 6},   {3, 6, 8},  {3, 8, 9},
                              {4, 9, 5},  {2, 4, 11}, {6, 2, 10},  {8, 6, 7},  {9, 8, 1}};
  for (int level = 0; level < subdivisions; ++level) {
    std::unordered_map<std::uint64_t, Index> midpointCache;
    auto midpoint = [&](Index a, Index b) {
      const std::uint64_t key = edgeKey(a, b);
      const auto found = midpointCache.find(key);
      if (found != midpointCache.end())
        return found->second;
      const Index index = static_cast<Index>(vertices.size());
      vertices.push_back((vertices[a] + vertices[b]).normalized());
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
  for (Vec3& vertex : vertices)
    vertex *= radius;
  orientSphereOutward(vertices, faces);
  return TriangleMesh::build(vertices, faces);
}

GeneratedCurvedWorld generateCurvedWorld(const CurvedWorldOptions& options) {
  if (options.genus < 1 || options.genus > 3) {
    throw std::invalid_argument("curved-world genus must be 1, 2, or 3");
  }
  if (options.resolution < 28 || options.resolution > 192 || !(options.tubeRadius > 0.18) ||
      options.tubeRadius > 0.42 || !(options.relief >= 0.0) || options.relief > 0.30 ||
      !std::isfinite(options.tubeRadius) || !std::isfinite(options.relief)) {
    throw std::invalid_argument("invalid curved-world generation options");
  }
  const ImplicitWorld field(options);
  const Grid grid = sampleGrid(field);
  ExtractedSurface extracted = extractSurface(field, grid);
  if (extracted.vertices.empty() || extracted.faces.empty()) {
    throw std::runtime_error("implicit extraction produced an empty surface");
  }
  improveSurface(field, extracted);

  TriangleMesh mesh = TriangleMesh::build(extracted.vertices, extracted.faces);
  double volume = signedVolume(mesh);
  if (volume < 0.0) {
    for (Triangle& face : extracted.faces)
      std::swap(face[1], face[2]);
    mesh = TriangleMesh::build(extracted.vertices, extracted.faces);
    volume = signedVolume(mesh);
  }

  WorldTopology topology;
  topology.eulerCharacteristic = static_cast<long long>(mesh.vertices().size()) -
                                 static_cast<long long>(mesh.edges().size()) +
                                 static_cast<long long>(mesh.faces().size());
  topology.connectedComponents = connectedComponentCount(mesh);
  for (Index edge = 0; edge < mesh.edges().size(); ++edge) {
    if (mesh.isBoundaryEdge(edge))
      ++topology.boundaryEdges;
  }
  if ((2 - topology.eulerCharacteristic) % 2 != 0) {
    throw std::runtime_error("generated surface has an invalid orientable Euler characteristic");
  }
  topology.recoveredGenus = static_cast<int>(1 - topology.eulerCharacteristic / 2);
  topology.signedVolume = volume;
  if (topology.connectedComponents != 1U || topology.boundaryEdges != 0U ||
      topology.recoveredGenus != options.genus || !(topology.signedVolume > 0.0)) {
    throw std::runtime_error("generated surface failed closed orientable genus validation");
  }

  Vec3 center = Vec3::Zero();
  for (const auto& vertex : mesh.vertices())
    center += vertex.position;
  center /= static_cast<double>(mesh.vertices().size());
  double boundingRadius = 0.0;
  for (const auto& vertex : mesh.vertices()) {
    boundingRadius = std::max(boundingRadius, (vertex.position - center).norm());
  }
  WorldLandmarks landmarks = buildLandmarks(mesh, field);
  return GeneratedCurvedWorld{std::move(mesh), std::move(landmarks), topology, center,
                              boundingRadius};
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
