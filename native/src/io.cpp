#include "geodesic/io.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <limits>
#include <optional>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace geodesic {
namespace {

Index parseObjIndex(const std::string& token, std::size_t vertexCount) {
  const std::size_t slash = token.find('/');
  const std::string position = token.substr(0, slash);
  if (position.empty())
    throw MeshError("OBJ face is missing a position index");
  const long long raw = std::stoll(position);
  const long long resolved = raw > 0 ? raw - 1 : static_cast<long long>(vertexCount) + raw;
  if (raw == 0 || resolved < 0 || resolved >= static_cast<long long>(vertexCount)) {
    throw MeshError("OBJ face index is out of range");
  }
  return static_cast<Index>(resolved);
}

template <typename T> void writeLittleEndian(std::ofstream& output, T value) {
  static_assert(std::is_arithmetic_v<T>);
  std::array<unsigned char, sizeof(T)> bytes{};
  std::memcpy(bytes.data(), &value, sizeof(T));
#if __BYTE_ORDER__ == __ORDER_BIG_ENDIAN__
  std::reverse(bytes.begin(), bytes.end());
#endif
  output.write(reinterpret_cast<const char*>(bytes.data()),
               static_cast<std::streamsize>(bytes.size()));
}

void requireStream(const std::ios& stream, const std::filesystem::path& path) {
  if (!stream)
    throw std::runtime_error("I/O failed for " + path.string());
}

void writeVec3(std::ofstream& output, const Vec3& value) {
  for (int axis = 0; axis < 3; ++axis) {
    writeLittleEndian<float>(output, static_cast<float>(value[axis]));
  }
}

std::string jsonString(const std::string& value) {
  std::ostringstream output;
  output << '"';
  for (const char character : value) {
    switch (character) {
    case '"':
      output << "\\\"";
      break;
    case '\\':
      output << "\\\\";
      break;
    case '\n':
      output << "\\n";
      break;
    case '\r':
      output << "\\r";
      break;
    case '\t':
      output << "\\t";
      break;
    default:
      output << character;
      break;
    }
  }
  output << '"';
  return output.str();
}

struct GradientSample {
  Index face{kInvalidIndex};
  Vec3 position{Vec3::Zero()};
  Vec3 direction{Vec3::Zero()};
};

struct MeshQuality {
  double minimumAngleDegrees{180.0};
  double onePercentileAngleDegrees{180.0};
  double maximumAspectRatio{0.0};
  double minimumFaceArea{std::numeric_limits<double>::infinity()};
};

MeshQuality measureMeshQuality(const TriangleMesh& mesh) {
  MeshQuality quality;
  std::vector<double> angles;
  angles.reserve(mesh.faces().size() * 3U);
  const double radiansToDegrees = 180.0 / std::acos(-1.0);
  for (Index face = 0; face < mesh.faces().size(); ++face) {
    const Triangle& triangle = mesh.faces()[face].vertices;
    const Vec3& a = mesh.vertices()[triangle[0]].position;
    const Vec3& b = mesh.vertices()[triangle[1]].position;
    const Vec3& c = mesh.vertices()[triangle[2]].position;
    const std::array<double, 3> lengths{(b - c).norm(), (c - a).norm(), (a - b).norm()};
    const double area = mesh.faceArea(face);
    quality.minimumFaceArea = std::min(quality.minimumFaceArea, area);
    const double longestSquared =
        std::max({lengths[0] * lengths[0], lengths[1] * lengths[1], lengths[2] * lengths[2]});
    quality.maximumAspectRatio =
        std::max(quality.maximumAspectRatio, longestSquared / (2.0 * area));
    for (std::size_t corner = 0; corner < 3U; ++corner) {
      const double adjacentFirst = lengths[(corner + 1U) % 3U];
      const double adjacentSecond = lengths[(corner + 2U) % 3U];
      const double opposite = lengths[corner];
      const double cosine = std::clamp(
          (adjacentFirst * adjacentFirst + adjacentSecond * adjacentSecond - opposite * opposite) /
              (2.0 * adjacentFirst * adjacentSecond),
          -1.0, 1.0);
      const double angle = std::acos(cosine) * radiansToDegrees;
      angles.push_back(angle);
      quality.minimumAngleDegrees = std::min(quality.minimumAngleDegrees, angle);
    }
  }
  std::sort(angles.begin(), angles.end());
  if (!angles.empty()) {
    quality.onePercentileAngleDegrees = angles[std::min(angles.size() - 1U, angles.size() / 100U)];
  }
  return quality;
}

Index nearestFaceVertex(const TriangleMesh& mesh, const SurfacePoint& start) {
  const Vec3 point = interpolateSurfacePoint(mesh, start);
  const Triangle& triangle = mesh.faces()[start.face].vertices;
  Index best = triangle[0];
  double bestSquaredDistance = (mesh.vertices()[best].position - point).squaredNorm();
  for (std::size_t local = 1; local < triangle.size(); ++local) {
    const Index candidate = triangle[local];
    const double squaredDistance = (mesh.vertices()[candidate].position - point).squaredNorm();
    if (squaredDistance < bestSquaredDistance) {
      best = candidate;
      bestSquaredDistance = squaredDistance;
    }
  }
  return best;
}

double polylineLength(const std::vector<Vec3>& points) {
  double length = 0.0;
  for (std::size_t index = 1; index < points.size(); ++index) {
    length += (points[index] - points[index - 1U]).norm();
  }
  return length;
}

struct CandidateFace {
  Index face{kInvalidIndex};
  double score{0.0};
};

std::vector<SurfacePoint> landmarkCandidates(const TriangleMesh& mesh,
                                             const WorldLandmark& landmark) {
  std::vector<CandidateFace> faces;
  faces.reserve(mesh.faces().size());
  const Vec3 preferred = landmark.preferredNormal.norm() > 1e-12
                             ? landmark.preferredNormal.normalized()
                             : Vec3::Zero();
  for (Index face = 0; face < mesh.faces().size(); ++face) {
    const Triangle& triangle = mesh.faces()[face].vertices;
    const Vec3 centroid =
        (mesh.vertices()[triangle[0]].position + mesh.vertices()[triangle[1]].position +
         mesh.vertices()[triangle[2]].position) /
        3.0;
    const double normalPenalty =
        preferred.squaredNorm() > 0.0 ? 0.12 * (1.0 - mesh.faceNormal(face).dot(preferred)) : 0.0;
    faces.push_back({face, (centroid - landmark.anchor).squaredNorm() + normalPenalty});
  }
  const std::size_t count = std::min<std::size_t>(360U, faces.size());
  std::partial_sort(faces.begin(), faces.begin() + static_cast<std::ptrdiff_t>(count), faces.end(),
                    [](const CandidateFace& first, const CandidateFace& second) {
                      return first.score < second.score ||
                             (first.score == second.score && first.face < second.face);
                    });
  constexpr std::array<std::array<double, 3>, 4> kBarycentrics{{
      {1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0},
      {0.50, 0.27, 0.23},
      {0.23, 0.50, 0.27},
      {0.27, 0.23, 0.50},
  }};
  std::vector<SurfacePoint> result;
  result.reserve(count * kBarycentrics.size() + 1U);
  result.push_back(landmark.point);
  for (std::size_t index = 0; index < count; ++index) {
    for (const auto& barycentric : kBarycentrics) {
      result.push_back({faces[index].face, barycentric});
    }
  }
  return result;
}

std::string routeDescription(const std::string& id, int genus) {
  if (id == "outer-ridge")
    return genus >= 4 ? "Cross the far outer lobe toward the beacon."
                      : "Cross the raised outer ridge from the far shoulder.";
  if (id == "central-neck" && genus == 1)
    return "Cross the compressed inner neck of the handle.";
  if (id == "central-neck" && genus >= 3)
    return "Leave the shared central junction and turn onto a neighboring lobe.";
  if (id == "central-neck")
    return "Pass through the smooth shared neck between neighboring handles.";
  if (genus == 3)
    return "Follow the rounded triangular rim before turning toward the beacon.";
  if (genus == 4)
    return "Follow one side of the diamond rim before crossing the shared center.";
  if (genus == 5)
    return "Skirt a rosette petal before crossing the connected center.";
  return "Skirt the shallow basin along its raised rim.";
}

void writeSurfacePointJson(std::ofstream& output, const SurfacePoint& point) {
  output << "{\"face\": " << point.face << ", \"barycentric\": [" << point.barycentric[0] << ", "
         << point.barycentric[1] << ", " << point.barycentric[2] << "]}";
}

void writeVec3Json(std::ofstream& output, const Vec3& value) {
  output << '[' << value.x() << ", " << value.y() << ", " << value.z() << ']';
}

} // namespace

TriangleMesh loadObj(const std::filesystem::path& path, DegeneratePolicy policy) {
  std::ifstream input(path);
  requireStream(input, path);
  std::vector<Vec3> positions;
  std::vector<Triangle> triangles;
  std::string line;
  std::size_t lineNumber = 0;
  while (std::getline(input, line)) {
    ++lineNumber;
    std::istringstream stream(line);
    std::string kind;
    stream >> kind;
    if (kind.empty() || kind[0] == '#')
      continue;
    if (kind == "v") {
      double x = 0.0;
      double y = 0.0;
      double z = 0.0;
      if (!(stream >> x >> y >> z)) {
        throw MeshError("invalid OBJ vertex on line " + std::to_string(lineNumber));
      }
      positions.emplace_back(x, y, z);
    } else if (kind == "f") {
      std::vector<Index> polygon;
      std::string token;
      while (stream >> token)
        polygon.push_back(parseObjIndex(token, positions.size()));
      if (polygon.size() < 3U) {
        throw MeshError("OBJ face has fewer than three vertices on line " +
                        std::to_string(lineNumber));
      }
      for (std::size_t index = 1; index + 1 < polygon.size(); ++index) {
        triangles.push_back({polygon[0], polygon[index], polygon[index + 1U]});
      }
    }
  }
  return TriangleMesh::build(positions, triangles, policy);
}

void writeObj(const TriangleMesh& mesh, const std::filesystem::path& path) {
  if (path.has_parent_path())
    std::filesystem::create_directories(path.parent_path());
  std::ofstream output(path);
  requireStream(output, path);
  output << std::setprecision(17);
  for (const auto& vertex : mesh.vertices()) {
    output << "v " << vertex.position.x() << ' ' << vertex.position.y() << ' '
           << vertex.position.z() << '\n';
  }
  for (const auto& face : mesh.faces()) {
    output << "f " << face.vertices[0] + 1U << ' ' << face.vertices[1] + 1U << ' '
           << face.vertices[2] + 1U << '\n';
  }
  requireStream(output, path);
}

void writeScalarCsv(const Vector& values, const std::filesystem::path& path,
                    const std::string& columnName) {
  if (path.has_parent_path())
    std::filesystem::create_directories(path.parent_path());
  std::ofstream output(path);
  requireStream(output, path);
  output << "vertex," << columnName << '\n' << std::setprecision(17);
  for (int index = 0; index < values.size(); ++index)
    output << index << ',' << values[index] << '\n';
  requireStream(output, path);
}

void writePathObj(const std::vector<Vec3>& points, const std::filesystem::path& path) {
  if (points.size() < 2U)
    throw std::invalid_argument("a path OBJ needs at least two points");
  if (path.has_parent_path())
    std::filesystem::create_directories(path.parent_path());
  std::ofstream output(path);
  requireStream(output, path);
  output << std::setprecision(17);
  for (const Vec3& point : points)
    output << "v " << point.x() << ' ' << point.y() << ' ' << point.z() << '\n';
  output << 'l';
  for (std::size_t index = 0; index < points.size(); ++index)
    output << ' ' << index + 1U;
  output << '\n';
  requireStream(output, path);
}

std::vector<WebRoutePreset> buildCurvedWorldRoutePresets(const GeneratedCurvedWorld& world,
                                                         const HeatMethodSolver& solver,
                                                         const HeatMethodResult& heat,
                                                         const DijkstraResult& dijkstra,
                                                         Index sourceVertex) {
  const TriangleMesh& mesh = world.mesh;
  if (sourceVertex >= mesh.vertices().size() ||
      heat.distance.size() != static_cast<Eigen::Index>(mesh.vertices().size()) ||
      dijkstra.predecessor.size() != mesh.vertices().size()) {
    throw std::invalid_argument("route preset inputs do not match the mesh");
  }
  std::vector<WebRoutePreset> presets;
  presets.reserve(world.landmarks.routeStarts.size());
  const Vec3& source = mesh.vertices()[sourceVertex].position;
  const double distinctDistance = 0.18 * world.boundingRadius;
  const double distinctLength = 0.012 * world.boundingRadius;
  std::size_t pathOffset = 0;
  for (const WorldLandmark& landmark : world.landmarks.routeStarts) {
    std::optional<WebRoutePreset> selected;
    std::string lastTermination = "no candidate evaluated";
    for (const SurfacePoint& candidate : landmarkCandidates(mesh, landmark)) {
      WebRoutePreset preset;
      preset.id = landmark.id;
      preset.label = landmark.label;
      preset.description = routeDescription(landmark.id, world.topology.recoveredGenus);
      preset.start = candidate;
      const Vec3 startPoint = interpolateSurfacePoint(mesh, candidate);
      bool distinctStart = true;
      for (const WebRoutePreset& existing : presets) {
        if ((interpolateSurfacePoint(mesh, existing.start) - startPoint).norm() <
            distinctDistance) {
          distinctStart = false;
          break;
        }
      }
      if (!distinctStart)
        continue;

      preset.dijkstraStartVertex = nearestFaceVertex(mesh, candidate);
      PathOptions traceOptions;
      traceOptions.enableVertexFallback = false;
      traceOptions.sourceRadiusScale = 1.8;
      const PathResult traced =
          traceDistanceGradient(mesh, solver.operators().faceGeometry, heat.distance, sourceVertex,
                                candidate, traceOptions);
      lastTermination = traced.termination;
      preset.tracingReachedSource = traced.reachedSource;
      preset.fallbackUsed = traced.usedFallback;
      preset.tracedPoints = traced.points;
      preset.edgeVertices =
          reconstructVertexPath(dijkstra, preset.dijkstraStartVertex, sourceVertex);
      preset.ambientChordLength = (startPoint - source).norm();
      preset.tracedHeatMethodRouteLength = polylineLength(preset.tracedPoints);
      std::vector<Vec3> edgePoints;
      edgePoints.reserve(preset.edgeVertices.size() + 1U);
      edgePoints.push_back(startPoint);
      for (const Index vertex : preset.edgeVertices)
        edgePoints.push_back(mesh.vertices()[vertex].position);
      preset.edgeDijkstraRouteLength = polylineLength(edgePoints);

      bool distinctMeasurement = true;
      for (const WebRoutePreset& existing : presets) {
        if (std::abs(existing.tracedHeatMethodRouteLength - preset.tracedHeatMethodRouteLength) <
            distinctLength) {
          distinctMeasurement = false;
          break;
        }
      }
      const bool plausible =
          preset.ambientChordLength > 0.25 * world.boundingRadius &&
          preset.edgeDijkstraRouteLength > preset.ambientChordLength * 1.0001 &&
          preset.tracedHeatMethodRouteLength > preset.ambientChordLength * 1.0001 &&
          preset.tracedHeatMethodRouteLength <= 1.25 * preset.edgeDijkstraRouteLength;
      if (preset.tracingReachedSource && !preset.fallbackUsed && preset.tracedPoints.size() >= 4U &&
          preset.edgeVertices.size() >= 3U && preset.edgeVertices.back() == sourceVertex &&
          std::isfinite(preset.ambientChordLength) &&
          std::isfinite(preset.edgeDijkstraRouteLength) &&
          std::isfinite(preset.tracedHeatMethodRouteLength) && plausible && distinctMeasurement) {
        preset.nativePathOffset = pathOffset;
        pathOffset += preset.tracedPoints.size();
        selected = std::move(preset);
        break;
      }
    }
    if (!selected) {
      throw std::runtime_error("could not find a fallback-free route for landmark " + landmark.id +
                               " (last termination=" + lastTermination + ")");
    }
    presets.push_back(std::move(*selected));
  }
  return presets;
}

WebExportReport exportCurvedWorld(const std::filesystem::path& outputDirectory,
                                  const WebExportOptions& options) {
  if (options.heatTimeMultipliers.empty()) {
    throw std::invalid_argument("web export requires at least one heat frame");
  }
  std::filesystem::create_directories(outputDirectory);
  GeneratedCurvedWorld world = generateCurvedWorld(options.world);
  const TriangleMesh& mesh = world.mesh;
  const Index landmarkSource = nearestFaceVertex(mesh, world.landmarks.source.point);
  const Index source =
      options.sourceVertex == kInvalidIndex ? landmarkSource : options.sourceVertex;
  if (source >= mesh.vertices().size())
    throw std::invalid_argument("web export source is out of range");

  HeatMethodOptions solverOptions;
  solverOptions.solver = CpuSolverKind::Direct;
  HeatMethodSolver solver(mesh, solverOptions);
  HeatMethodResult heat = solver.compute(source);
  DijkstraResult dijkstra = edgeDijkstra(mesh, source);
  std::vector<WebRoutePreset> routePresets =
      buildCurvedWorldRoutePresets(world, solver, heat, dijkstra, source);

  std::vector<Vector> heatFrames;
  std::vector<double> frameTimes;
  std::vector<double> frameMin;
  std::vector<double> frameMax;
  heatFrames.reserve(options.heatTimeMultipliers.size());
  for (const double multiplier : options.heatTimeMultipliers) {
    if (!(multiplier > 0.0) || !std::isfinite(multiplier)) {
      throw std::invalid_argument("heat frame multiplier must be positive and finite");
    }
    const double time = solver.operators().suggestedTimeStep * multiplier;
    Vector frame = solver.solveHeatAtTime(source, time);
    const double maximum = std::max(frame.maxCoeff(), 1e-300);
    Vector logFrame(frame.size());
    const double floor = maximum * 1e-14;
    for (int index = 0; index < frame.size(); ++index) {
      logFrame[index] = std::log(std::max(frame[index], floor));
    }
    frameTimes.push_back(time);
    frameMin.push_back(logFrame.minCoeff());
    frameMax.push_back(logFrame.maxCoeff());
    heatFrames.push_back(std::move(logFrame));
  }

  const std::size_t targetSamples = 300U;
  const std::size_t stride = std::max<std::size_t>(1U, mesh.faces().size() / targetSamples);
  std::vector<GradientSample> samples;
  for (Index face = 0; face < mesh.faces().size(); face += static_cast<Index>(stride)) {
    if (heat.directionField[face].squaredNorm() < 0.5)
      continue;
    const Triangle& triangle = mesh.faces()[face].vertices;
    const Vec3 centroid =
        (mesh.vertices()[triangle[0]].position + mesh.vertices()[triangle[1]].position +
         mesh.vertices()[triangle[2]].position) /
        3.0;
    samples.push_back({face, centroid + 0.008 * mesh.faceNormal(face), heat.directionField[face]});
  }
  std::size_t routePointCount = 0;
  for (const WebRoutePreset& route : routePresets)
    routePointCount += route.tracedPoints.size();

  const std::filesystem::path binaryPath = outputDirectory / "world.bin";
  std::ofstream binary(binaryPath, std::ios::binary);
  requireStream(binary, binaryPath);
  constexpr std::array<char, 8> magic{'G', 'E', 'O', 'W', 'R', 'L', 'D', '3'};
  binary.write(magic.data(), static_cast<std::streamsize>(magic.size()));
  writeLittleEndian<std::uint32_t>(binary, 3U);
  writeLittleEndian<std::uint32_t>(binary, static_cast<std::uint32_t>(mesh.vertices().size()));
  writeLittleEndian<std::uint32_t>(binary, static_cast<std::uint32_t>(mesh.faces().size()));
  writeLittleEndian<std::uint32_t>(binary, static_cast<std::uint32_t>(heatFrames.size()));
  writeLittleEndian<std::uint32_t>(binary, static_cast<std::uint32_t>(samples.size()));
  writeLittleEndian<std::uint32_t>(binary, source);
  writeLittleEndian<std::uint32_t>(binary, static_cast<std::uint32_t>(routePointCount));
  writeLittleEndian<std::uint32_t>(binary, static_cast<std::uint32_t>(routePresets.size()));
  writeLittleEndian<double>(binary, solver.operators().meanEdgeLength);
  writeLittleEndian<double>(binary, solver.operators().suggestedTimeStep);
  for (const double value : frameTimes)
    writeLittleEndian<double>(binary, value);
  for (const double value : frameMin)
    writeLittleEndian<double>(binary, value);
  for (const double value : frameMax)
    writeLittleEndian<double>(binary, value);
  for (const auto& vertex : mesh.vertices())
    writeVec3(binary, vertex.position);
  for (Index vertex = 0; vertex < mesh.vertices().size(); ++vertex) {
    writeVec3(binary, mesh.vertexNormal(vertex));
  }
  for (const auto& face : mesh.faces()) {
    for (const Index vertex : face.vertices)
      writeLittleEndian<std::uint32_t>(binary, vertex);
  }
  for (Index face = 0; face < mesh.faces().size(); ++face) {
    for (Index local = 0; local < 3U; ++local) {
      const Index adjacent = mesh.adjacentFaceAcross(face, local);
      writeLittleEndian<std::int32_t>(
          binary, adjacent == kInvalidIndex ? -1 : static_cast<std::int32_t>(adjacent));
    }
  }
  for (int index = 0; index < heat.distance.size(); ++index) {
    writeLittleEndian<float>(binary, static_cast<float>(heat.distance[index]));
  }
  for (int index = 0; index < dijkstra.distance.size(); ++index) {
    writeLittleEndian<float>(binary, static_cast<float>(dijkstra.distance[index]));
  }
  for (const Index predecessor : dijkstra.predecessor) {
    writeLittleEndian<std::uint32_t>(binary, predecessor);
  }
  for (std::size_t frameIndex = 0; frameIndex < heatFrames.size(); ++frameIndex) {
    const double minimum = frameMin[frameIndex];
    const double range = std::max(frameMax[frameIndex] - minimum, 1e-30);
    for (int index = 0; index < heatFrames[frameIndex].size(); ++index) {
      const double normalized =
          std::clamp((heatFrames[frameIndex][index] - minimum) / range, 0.0, 1.0);
      writeLittleEndian<std::uint16_t>(
          binary, static_cast<std::uint16_t>(std::lround(normalized * 65535.0)));
    }
  }
  for (const GradientSample& sample : samples) {
    writeLittleEndian<std::uint32_t>(binary, sample.face);
    writeVec3(binary, sample.position);
    writeVec3(binary, sample.direction);
  }
  for (const WebRoutePreset& route : routePresets) {
    for (const Vec3& point : route.tracedPoints)
      writeVec3(binary, point);
  }
  requireStream(binary, binaryPath);
  binary.close();

  const MeshQuality quality = measureMeshQuality(mesh);
  const std::filesystem::path metadataPath = outputDirectory / "world.meta.json";
  std::ofstream metadata(metadataPath);
  requireStream(metadata, metadataPath);
  metadata << std::setprecision(12) << "{\n"
           << "  \"schema\": \"geodesic-world-v4\",\n"
           << "  \"title\": \"The Shortest Path Through a Curved World\",\n"
           << "  \"accessibleLabel\": \"Genus " << options.world.genus
           << " closed orientable curved world\",\n"
           << "  \"mesh\": {\"kind\": \"implicit-thickened-loop-graph\", \"genus\": "
           << options.world.genus << ", \"resolution\": " << options.world.resolution
           << ", \"tubeRadius\": " << options.world.tubeRadius
           << ", \"relief\": " << options.world.relief << ", \"seed\": " << options.world.seed
           << "},\n"
           << "  \"generator\": {\"composition\": " << jsonString(world.generator.composition)
           << ", \"junction\": " << jsonString(world.generator.junction)
           << ", \"cycleRank\": " << world.generator.cycleRank
           << ", \"centerlineSamples\": " << world.generator.centerlineSamples
           << ", \"ringRadius\": " << world.generator.ringRadius
           << ", \"loopWidth\": " << world.generator.loopWidth
           << ", \"effectiveTubeRadius\": " << world.generator.effectiveTubeRadius
           << ", \"smoothMinimumRadius\": " << world.generator.smoothMinimumRadius
           << ", \"gridOffsetFractions\": ";
  writeVec3Json(metadata, world.generator.gridOffsetFractions);
  metadata << ", \"smoothingPasses\": " << world.generator.smoothingPasses
           << ", \"reprojectionPasses\": " << world.generator.reprojectionPasses
           << ", \"samplingMinimum\": ";
  writeVec3Json(metadata, world.generator.samplingMinimum);
  metadata << ", \"samplingMaximum\": ";
  writeVec3Json(metadata, world.generator.samplingMaximum);
  metadata << "},\n"
           << "  \"vertices\": " << mesh.vertices().size() << ",\n"
           << "  \"edges\": " << mesh.edges().size() << ",\n"
           << "  \"faces\": " << mesh.faces().size() << ",\n"
           << "  \"bounds\": {\"center\": ";
  writeVec3Json(metadata, world.center);
  metadata << ", \"radius\": " << world.boundingRadius << "},\n"
           << "  \"sourceVertex\": " << source << ",\n"
           << "  \"source\": {\"label\": " << jsonString(world.landmarks.source.label)
           << ", \"surfacePoint\": ";
  writeSurfacePointJson(metadata, world.landmarks.source.point);
  metadata << ", \"anchor\": ";
  writeVec3Json(metadata, world.landmarks.source.anchor);
  metadata
      << "},\n"
      << "  \"topology\": {\"closed\": true, \"orientedManifold\": true, "
         "\"connectedComponents\": "
      << world.topology.connectedComponents
      << ", \"boundaryEdges\": " << world.topology.boundaryEdges
      << ", \"eulerCharacteristic\": " << world.topology.eulerCharacteristic
      << ", \"genus\": " << world.topology.recoveredGenus
      << ", \"signedVolume\": " << world.topology.signedVolume << "},\n"
      << "  \"quality\": {\"minimumAngleDegrees\": " << quality.minimumAngleDegrees
      << ", \"onePercentileAngleDegrees\": " << quality.onePercentileAngleDegrees
      << ", \"maximumAspectRatio\": " << quality.maximumAspectRatio
      << ", \"minimumFaceArea\": " << quality.minimumFaceArea << "},\n"
      << "  \"meanEdgeLength\": " << solver.operators().meanEdgeLength << ",\n"
      << "  \"heatMethodTimeStep\": " << solver.operators().suggestedTimeStep << ",\n"
      << "  \"laplacianSign\": \"positive-semidefinite stiffness matrix approximating -Delta\",\n"
      << "  \"boundaryCondition\": \"natural Neumann; generated worlds are closed\",\n"
      << "  \"heatEncoding\": \"per-frame log(u), linearly quantized to uint16\",\n"
      << "  \"heatDisplay\": {\"kind\": \"visualization-diffusion-frames\", "
         "\"frameCount\": "
      << frameTimes.size() << ", \"pathSolveUsesDisplayFrames\": false, "
      << "\"timeStepMultipliers\": [";
  for (std::size_t index = 0; index < options.heatTimeMultipliers.size(); ++index) {
    metadata << options.heatTimeMultipliers[index]
             << (index + 1U == options.heatTimeMultipliers.size() ? "" : ", ");
  }
  metadata << "], \"frameTimes\": [";
  for (std::size_t index = 0; index < frameTimes.size(); ++index) {
    metadata << frameTimes[index] << (index + 1U == frameTimes.size() ? "" : ", ");
  }
  metadata << "]},\n"
           << "  \"heatResidual\": " << heat.heatReport.relativeResidual << ",\n"
           << "  \"poissonResidual\": " << heat.poissonReport.relativeResidual << ",\n"
           << "  \"zeroGradientFaces\": " << heat.zeroGradientFaces << ",\n"
           << "  \"routePresets\": [\n";
  for (std::size_t index = 0; index < routePresets.size(); ++index) {
    const WebRoutePreset& preset = routePresets[index];
    metadata << "    {\"id\": " << jsonString(preset.id)
             << ", \"label\": " << jsonString(preset.label)
             << ", \"description\": " << jsonString(preset.description) << ", \"start\": ";
    writeSurfacePointJson(metadata, preset.start);
    metadata << ", \"dijkstraStartVertex\": " << preset.dijkstraStartVertex
             << ", \"ambientChordLength\": " << preset.ambientChordLength
             << ", \"edgeDijkstraRouteLength\": " << preset.edgeDijkstraRouteLength
             << ", \"tracedHeatMethodRouteLength\": " << preset.tracedHeatMethodRouteLength
             << ", \"tracingReachedSource\": true, \"fallbackUsed\": false, "
                "\"nativePathOffset\": "
             << preset.nativePathOffset << ", \"nativePathCount\": " << preset.tracedPoints.size()
             << "}" << (index + 1U == routePresets.size() ? "\n" : ",\n");
  }
  metadata << "  ],\n"
           << "  \"solver\": {\"language\": \"C++20\", \"library\": \"Eigen 3.4\", "
              "\"precision\": \"float64\", \"direct\": \"SimplicialLDLT\", "
              "\"iterative\": \"conjugate gradient with incomplete Cholesky\"},\n"
           << "  \"references\": [\n"
           << "    \"Keenan Crane, Discrete Differential Geometry\",\n"
           << "    \"Crane, Weischedel, and Wardetzky, Geodesics in Heat, ACM TOG 2013\"\n"
           << "  ]\n"
           << "}\n";
  requireStream(metadata, metadataPath);

  return {binaryPath,
          metadataPath,
          options.world.genus,
          world.topology.eulerCharacteristic,
          mesh.vertices().size(),
          mesh.faces().size(),
          source,
          heat.heatReport.relativeResidual,
          heat.poissonReport.relativeResidual,
          solver.preprocessingMilliseconds(),
          heat.heatReport.milliseconds + heat.poissonReport.milliseconds,
          std::move(routePresets)};
}

std::vector<WebExportReport> exportAllCurvedWorlds(const std::filesystem::path& outputDirectory,
                                                   const WebExportOptions& options) {
  std::filesystem::create_directories(outputDirectory);
  std::vector<WebExportReport> reports;
  reports.reserve(5U);
  for (int genus = 1; genus <= 5; ++genus) {
    WebExportOptions genusOptions = options;
    genusOptions.world.genus = genus;
    genusOptions.sourceVertex = kInvalidIndex;
    reports.push_back(
        exportCurvedWorld(outputDirectory / ("genus-" + std::to_string(genus)), genusOptions));
  }
  const std::filesystem::path manifestPath = outputDirectory / "manifest.json";
  std::ofstream manifest(manifestPath);
  requireStream(manifest, manifestPath);
  manifest << "{\n"
           << "  \"schema\": \"geodesic-world-manifest-v1\",\n"
           << "  \"binarySchemaVersion\": 3,\n"
           << "  \"defaultGenus\": 2,\n"
           << "  \"supportedGenera\": [1, 2, 3, 4, 5],\n"
           << "  \"worlds\": [\n";
  for (std::size_t index = 0; index < reports.size(); ++index) {
    const WebExportReport& report = reports[index];
    manifest << "    {\"genus\": " << report.genus << ", \"label\": \"Genus " << report.genus
             << "\", \"accessibleLabel\": \"Genus " << report.genus
             << " closed orientable surface with " << report.genus
             << (report.genus == 1 ? " handle\", " : " handles\", ") << "\"binary\": \"genus-"
             << report.genus << "/world.bin\", \"metadata\": \"genus-" << report.genus
             << "/world.meta.json\", \"binaryBytes\": "
             << std::filesystem::file_size(report.binaryPath)
             << ", \"vertices\": " << report.vertexCount << ", \"faces\": " << report.faceCount
             << "}" << (index + 1U == reports.size() ? "\n" : ",\n");
  }
  manifest << "  ]\n}\n";
  requireStream(manifest, manifestPath);
  return reports;
}

} // namespace geodesic
