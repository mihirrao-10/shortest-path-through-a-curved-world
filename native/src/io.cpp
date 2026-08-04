#include "geodesic/io.hpp"

#include "geodesic/procedural.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <limits>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace geodesic {
namespace {

Index parseObjIndex(const std::string& token, std::size_t vertexCount) {
  const std::size_t slash = token.find('/');
  const std::string position = token.substr(0, slash);
  if (position.empty()) {
    throw MeshError("OBJ face is missing a position index");
  }
  const long long raw = std::stoll(position);
  long long resolved = 0;
  if (raw > 0) {
    resolved = raw - 1;
  } else if (raw < 0) {
    resolved = static_cast<long long>(vertexCount) + raw;
  } else {
    throw MeshError("OBJ indices are one-based and cannot be zero");
  }
  if (resolved < 0 || resolved >= static_cast<long long>(vertexCount)) {
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
  if (!stream) {
    throw std::runtime_error("I/O failed for " + path.string());
  }
}

struct GradientSample {
  Index face{kInvalidIndex};
  Vec3 position{Vec3::Zero()};
  Vec3 direction{Vec3::Zero()};
};

struct AuthoredRouteSeed {
  const char* id;
  const char* label;
  const char* description;
  double u;
  double v;
  std::array<double, 3> barycentric;
};

const std::array<AuthoredRouteSeed, 3> kAuthoredRouteSeeds{{
    {"ridge-crossing",
     "Ridge crossing",
     "Cross the folded outer ridge from its raised eastern shoulder.",
     1.05,
     0.45,
     {0.24, 0.33, 0.43}},
    {"inner-saddle-pass",
     "Inner saddle pass",
     "Thread the saddle-like inner throat where the tube bends in opposite directions.",
     3.72,
     3.15,
     {0.31, 0.27, 0.42}},
    {"basin-rim",
     "Basin rim",
     "Skirt the raised rim of the localized outer-tube basin.",
     2.55,
     0.85,
     {0.29, 0.46, 0.25}},
}};

int wrapIndex(int value, int count) {
  const int remainder = value % count;
  return remainder < 0 ? remainder + count : remainder;
}

std::vector<SurfacePoint> torusFeatureCandidates(const AuthoredRouteSeed& seed,
                                                 const TorusOptions& options) {
  const double twoPi = 2.0 * std::acos(-1.0);
  const int centralMajor =
      static_cast<int>(std::floor(seed.u * static_cast<double>(options.majorSegments) / twoPi));
  const int centralMinor =
      static_cast<int>(std::floor(seed.v * static_cast<double>(options.minorSegments) / twoPi));
  std::vector<SurfacePoint> candidates;
  candidates.reserve(360U);
  for (int radius = 0; radius <= 6; ++radius) {
    for (int majorOffset = -radius; majorOffset <= radius; ++majorOffset) {
      for (int minorOffset = -radius; minorOffset <= radius; ++minorOffset) {
        if (std::max(std::abs(majorOffset), std::abs(minorOffset)) != radius) {
          continue;
        }
        const int major = wrapIndex(centralMajor + majorOffset, options.majorSegments);
        const int minor = wrapIndex(centralMinor + minorOffset, options.minorSegments);
        const Index quad = static_cast<Index>(major * options.minorSegments + minor);
        candidates.push_back(SurfacePoint{2U * quad, seed.barycentric});
        candidates.push_back(SurfacePoint{
            2U * quad + 1U, {seed.barycentric[0], seed.barycentric[2], seed.barycentric[1]}});
      }
    }
  }
  return candidates;
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

struct MeshQuality {
  double minimumAngleDegrees{180.0};
  double maximumAspectRatio{0.0};
};

MeshQuality measureMeshQuality(const TriangleMesh& mesh) {
  MeshQuality quality;
  const double radiansToDegrees = 180.0 / std::acos(-1.0);
  for (Index face = 0; face < mesh.faces().size(); ++face) {
    const Triangle& triangle = mesh.faces()[face].vertices;
    const Vec3& a = mesh.vertices()[triangle[0]].position;
    const Vec3& b = mesh.vertices()[triangle[1]].position;
    const Vec3& c = mesh.vertices()[triangle[2]].position;
    const std::array<double, 3> lengths{(b - c).norm(), (c - a).norm(), (a - b).norm()};
    const double area = mesh.faceArea(face);
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
      quality.minimumAngleDegrees =
          std::min(quality.minimumAngleDegrees, std::acos(cosine) * radiansToDegrees);
    }
  }
  return quality;
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
    if (kind.empty() || kind[0] == '#') {
      continue;
    }
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
      while (stream >> token) {
        polygon.push_back(parseObjIndex(token, positions.size()));
      }
      if (polygon.size() < 3U) {
        throw MeshError("OBJ face has fewer than three vertices on line " +
                        std::to_string(lineNumber));
      }
      for (std::size_t i = 1; i + 1 < polygon.size(); ++i) {
        triangles.push_back({polygon[0], polygon[i], polygon[i + 1]});
      }
    }
  }
  return TriangleMesh::build(positions, triangles, policy);
}

void writeObj(const TriangleMesh& mesh, const std::filesystem::path& path) {
  if (path.has_parent_path()) {
    std::filesystem::create_directories(path.parent_path());
  }
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
  if (path.has_parent_path()) {
    std::filesystem::create_directories(path.parent_path());
  }
  std::ofstream output(path);
  requireStream(output, path);
  output << "vertex," << columnName << '\n' << std::setprecision(17);
  for (int i = 0; i < values.size(); ++i) {
    output << i << ',' << values[i] << '\n';
  }
  requireStream(output, path);
}

void writePathObj(const std::vector<Vec3>& points, const std::filesystem::path& path) {
  if (points.size() < 2U) {
    throw std::invalid_argument("a path OBJ needs at least two points");
  }
  if (path.has_parent_path()) {
    std::filesystem::create_directories(path.parent_path());
  }
  std::ofstream output(path);
  requireStream(output, path);
  output << std::setprecision(17);
  for (const Vec3& point : points) {
    output << "v " << point.x() << ' ' << point.y() << ' ' << point.z() << '\n';
  }
  output << "l";
  for (std::size_t i = 0; i < points.size(); ++i) {
    output << ' ' << i + 1U;
  }
  output << '\n';
  requireStream(output, path);
}

std::vector<WebRoutePreset>
buildCurvedWorldRoutePresets(const TriangleMesh& mesh, const HeatMethodSolver& solver,
                             const HeatMethodResult& heat, const DijkstraResult& dijkstra,
                             Index sourceVertex, const TorusOptions& options) {
  if (sourceVertex >= mesh.vertices().size() ||
      heat.distance.size() != static_cast<Eigen::Index>(mesh.vertices().size()) ||
      dijkstra.predecessor.size() != mesh.vertices().size() ||
      mesh.vertices().size() !=
          static_cast<std::size_t>(options.majorSegments * options.minorSegments)) {
    throw std::invalid_argument("route preset inputs do not match the mesh");
  }

  std::vector<WebRoutePreset> presets;
  presets.reserve(kAuthoredRouteSeeds.size());
  const Vec3& source = mesh.vertices()[sourceVertex].position;
  for (const AuthoredRouteSeed& seed : kAuthoredRouteSeeds) {
    const std::vector<SurfacePoint> candidates = torusFeatureCandidates(seed, options);
    std::optional<WebRoutePreset> selected;
    std::string lastTermination = "no candidate evaluated";
    for (const SurfacePoint& candidate : candidates) {
      WebRoutePreset preset;
      preset.id = seed.id;
      preset.label = seed.label;
      preset.description = seed.description;
      preset.start = candidate;
      const Vec3 startPoint = interpolateSurfacePoint(mesh, preset.start);
      bool distinctStart = true;
      for (const WebRoutePreset& existing : presets) {
        if ((interpolateSurfacePoint(mesh, existing.start) - startPoint).norm() < 0.7) {
          distinctStart = false;
          break;
        }
      }
      if (!distinctStart) {
        continue;
      }

      preset.dijkstraStartVertex = nearestFaceVertex(mesh, preset.start);
      PathOptions traceOptions;
      traceOptions.enableVertexFallback = false;
      const PathResult traced =
          traceDistanceGradient(mesh, solver.operators().faceGeometry, heat.distance, sourceVertex,
                                preset.start, traceOptions);
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
      for (const Index vertex : preset.edgeVertices) {
        edgePoints.push_back(mesh.vertices()[vertex].position);
      }
      preset.edgeDijkstraRouteLength = polylineLength(edgePoints);

      // A trace can technically terminate at the source after cycling through many faces. Treat
      // that as an invalid authored route instead of publishing a spectacular but meaningless
      // polyline. A well-behaved reconstructed surface path stays close to, and normally below,
      // the edge-restricted Dijkstra route on this mesh.
      const bool saneSurfaceLength =
          preset.tracedHeatMethodRouteLength > preset.ambientChordLength &&
          preset.tracedHeatMethodRouteLength <= 1.25 * preset.edgeDijkstraRouteLength;

      bool distinctLength = true;
      for (const WebRoutePreset& existing : presets) {
        if (std::abs(existing.tracedHeatMethodRouteLength - preset.tracedHeatMethodRouteLength) <
            0.04) {
          distinctLength = false;
          break;
        }
      }
      if (preset.tracingReachedSource && !preset.fallbackUsed && preset.tracedPoints.size() >= 3U &&
          !preset.edgeVertices.empty() && preset.edgeVertices.back() == sourceVertex &&
          std::isfinite(preset.ambientChordLength) &&
          std::isfinite(preset.edgeDijkstraRouteLength) &&
          std::isfinite(preset.tracedHeatMethodRouteLength) && saneSurfaceLength &&
          distinctLength) {
        selected = std::move(preset);
        break;
      }
    }
    if (!selected) {
      throw std::runtime_error(
          "could not find a fallback-free authored route preset: " + std::string(seed.id) +
          " (last termination=" + lastTermination + ")");
    }
    presets.push_back(std::move(*selected));
  }

  for (std::size_t first = 0; first < presets.size(); ++first) {
    const Vec3 firstPoint = interpolateSurfacePoint(mesh, presets[first].start);
    for (std::size_t second = first + 1U; second < presets.size(); ++second) {
      const Vec3 secondPoint = interpolateSurfacePoint(mesh, presets[second].start);
      if ((firstPoint - secondPoint).norm() < 0.7 ||
          std::abs(presets[first].tracedHeatMethodRouteLength -
                   presets[second].tracedHeatMethodRouteLength) < 0.04) {
        throw std::runtime_error("authored route presets are not spatially distinct");
      }
    }
  }
  return presets;
}

WebExportReport exportCurvedWorld(const std::filesystem::path& outputDirectory,
                                  const WebExportOptions& options) {
  if (options.heatTimeMultipliers.empty()) {
    throw std::invalid_argument("web export requires at least one heat frame");
  }
  std::filesystem::create_directories(outputDirectory);
  TriangleMesh mesh = makeCurvedWorld(options.torus);
  const Index source = options.sourceVertex == kInvalidIndex
                           ? selectCurvedWorldBeacon(mesh, options.torus)
                           : options.sourceVertex;
  if (source >= mesh.vertices().size()) {
    throw std::invalid_argument("web export source is out of range");
  }

  HeatMethodOptions solverOptions;
  solverOptions.solver = CpuSolverKind::Direct;
  HeatMethodSolver solver(mesh, solverOptions);
  HeatMethodResult heat = solver.compute(source);
  DijkstraResult dijkstra = edgeDijkstra(mesh, source);
  const std::vector<WebRoutePreset> routePresets =
      buildCurvedWorldRoutePresets(mesh, solver, heat, dijkstra, source, options.torus);

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
    for (int i = 0; i < frame.size(); ++i) {
      logFrame[i] = std::log(std::max(frame[i], floor));
    }
    frameTimes.push_back(time);
    frameMin.push_back(logFrame.minCoeff());
    frameMax.push_back(logFrame.maxCoeff());
    heatFrames.push_back(std::move(logFrame));
  }

  const std::size_t targetSamples = 280U;
  const std::size_t stride = std::max<std::size_t>(1U, mesh.faces().size() / targetSamples);
  std::vector<GradientSample> samples;
  samples.reserve(targetSamples + 1U);
  for (Index face = 0; face < mesh.faces().size(); face += static_cast<Index>(stride)) {
    if (heat.directionField[face].squaredNorm() < 0.5) {
      continue;
    }
    const Triangle& triangle = mesh.faces()[face].vertices;
    const Vec3 centroid =
        (mesh.vertices()[triangle[0]].position + mesh.vertices()[triangle[1]].position +
         mesh.vertices()[triangle[2]].position) /
        3.0;
    samples.push_back(
        GradientSample{face, centroid + 0.008 * mesh.faceNormal(face), heat.directionField[face]});
  }

  const std::filesystem::path binaryPath = outputDirectory / "world.bin";
  std::ofstream binary(binaryPath, std::ios::binary);
  requireStream(binary, binaryPath);
  constexpr std::array<char, 8> magic{'G', 'E', 'O', 'W', 'R', 'L', 'D', '2'};
  binary.write(magic.data(), static_cast<std::streamsize>(magic.size()));
  writeLittleEndian<std::uint32_t>(binary, 2U);
  writeLittleEndian<std::uint32_t>(binary, static_cast<std::uint32_t>(mesh.vertices().size()));
  writeLittleEndian<std::uint32_t>(binary, static_cast<std::uint32_t>(mesh.faces().size()));
  writeLittleEndian<std::uint32_t>(binary, static_cast<std::uint32_t>(heatFrames.size()));
  writeLittleEndian<std::uint32_t>(binary, static_cast<std::uint32_t>(samples.size()));
  writeLittleEndian<std::uint32_t>(binary, source);
  writeLittleEndian<std::uint32_t>(binary, 0U);
  writeLittleEndian<double>(binary, solver.operators().meanEdgeLength);
  writeLittleEndian<double>(binary, solver.operators().suggestedTimeStep);
  for (const double value : frameTimes) {
    writeLittleEndian<double>(binary, value);
  }
  for (const double value : frameMin) {
    writeLittleEndian<double>(binary, value);
  }
  for (const double value : frameMax) {
    writeLittleEndian<double>(binary, value);
  }
  for (const auto& vertex : mesh.vertices()) {
    for (int axis = 0; axis < 3; ++axis) {
      writeLittleEndian<float>(binary, static_cast<float>(vertex.position[axis]));
    }
  }
  for (Index vertex = 0; vertex < mesh.vertices().size(); ++vertex) {
    const Vec3 normal = mesh.vertexNormal(vertex);
    for (int axis = 0; axis < 3; ++axis) {
      writeLittleEndian<float>(binary, static_cast<float>(normal[axis]));
    }
  }
  for (const auto& face : mesh.faces()) {
    for (const Index vertex : face.vertices) {
      writeLittleEndian<std::uint32_t>(binary, vertex);
    }
  }
  for (Index face = 0; face < mesh.faces().size(); ++face) {
    for (Index local = 0; local < 3U; ++local) {
      const Index adjacent = mesh.adjacentFaceAcross(face, local);
      const std::int32_t encoded =
          adjacent == kInvalidIndex ? -1 : static_cast<std::int32_t>(adjacent);
      writeLittleEndian<std::int32_t>(binary, encoded);
    }
  }
  for (int i = 0; i < heat.distance.size(); ++i) {
    writeLittleEndian<float>(binary, static_cast<float>(heat.distance[i]));
  }
  for (int i = 0; i < dijkstra.distance.size(); ++i) {
    writeLittleEndian<float>(binary, static_cast<float>(dijkstra.distance[i]));
  }
  for (const Index predecessor : dijkstra.predecessor) {
    writeLittleEndian<std::uint32_t>(binary, predecessor);
  }
  for (std::size_t frameIndex = 0; frameIndex < heatFrames.size(); ++frameIndex) {
    const double minimum = frameMin[frameIndex];
    const double range = std::max(frameMax[frameIndex] - minimum, 1e-30);
    for (int i = 0; i < heatFrames[frameIndex].size(); ++i) {
      const double normalized = std::clamp((heatFrames[frameIndex][i] - minimum) / range, 0.0, 1.0);
      writeLittleEndian<std::uint16_t>(
          binary, static_cast<std::uint16_t>(std::lround(normalized * 65535.0)));
    }
  }
  for (const GradientSample& sample : samples) {
    writeLittleEndian<std::uint32_t>(binary, sample.face);
    for (int axis = 0; axis < 3; ++axis) {
      writeLittleEndian<float>(binary, static_cast<float>(sample.position[axis]));
    }
    for (int axis = 0; axis < 3; ++axis) {
      writeLittleEndian<float>(binary, static_cast<float>(sample.direction[axis]));
    }
  }
  requireStream(binary, binaryPath);

  const std::filesystem::path metadataPath = outputDirectory / "world.meta.json";
  std::ofstream metadata(metadataPath);
  requireStream(metadata, metadataPath);
  const long long eulerCharacteristic = static_cast<long long>(mesh.vertices().size()) -
                                        static_cast<long long>(mesh.edges().size()) +
                                        static_cast<long long>(mesh.faces().size());
  std::size_t boundaryEdges = 0;
  for (Index edge = 0; edge < mesh.edges().size(); ++edge) {
    if (mesh.isBoundaryEdge(edge)) {
      ++boundaryEdges;
    }
  }
  const MeshQuality quality = measureMeshQuality(mesh);
  metadata
      << std::setprecision(12) << "{\n"
      << "  \"schema\": \"geodesic-world-v2\",\n"
      << "  \"title\": \"The Shortest Path Through a Curved World\",\n"
      << "  \"deterministicSeed\": " << options.torus.seed << ",\n"
      << "  \"mesh\": {\"kind\": \"procedural-torus\", \"majorSegments\": "
      << options.torus.majorSegments << ", \"minorSegments\": " << options.torus.minorSegments
      << ", \"majorRadius\": " << options.torus.majorRadius
      << ", \"minorRadius\": " << options.torus.minorRadius
      << ", \"relief\": " << options.torus.relief << "},\n"
      << "  \"vertices\": " << mesh.vertices().size() << ",\n"
      << "  \"faces\": " << mesh.faces().size() << ",\n"
      << "  \"sourceVertex\": " << source << ",\n"
      << "  \"source\": {\"vertex\": " << source
      << ", \"u\": 5.63, \"v\": 5.58, \"label\": \"Heat source\"},\n"
      << "  \"topology\": {\"closed\": true, \"orientedManifold\": true, "
         "\"boundaryEdges\": "
      << boundaryEdges << ", \"eulerCharacteristic\": " << eulerCharacteristic
      << ", \"genus\": 1},\n"
      << "  \"quality\": {\"minimumAngleDegrees\": " << quality.minimumAngleDegrees
      << ", \"maximumAspectRatio\": " << quality.maximumAspectRatio << "},\n"
      << "  \"meanEdgeLength\": " << solver.operators().meanEdgeLength << ",\n"
      << "  \"heatMethodTimeStep\": " << solver.operators().suggestedTimeStep << ",\n"
      << "  \"laplacianSign\": \"positive-semidefinite stiffness matrix approximating -Delta\",\n"
      << "  \"boundaryCondition\": \"natural Neumann; primary world is closed\",\n"
      << "  \"heatEncoding\": \"per-frame log(u), linearly quantized to uint16\",\n"
      << "  \"heatResidual\": " << heat.heatReport.relativeResidual << ",\n"
      << "  \"poissonResidual\": " << heat.poissonReport.relativeResidual << ",\n"
      << "  \"zeroGradientFaces\": " << heat.zeroGradientFaces << ",\n"
      << "  \"routePresets\": [\n";
  for (std::size_t index = 0; index < routePresets.size(); ++index) {
    const WebRoutePreset& preset = routePresets[index];
    metadata << "    {\"id\": \"" << preset.id << "\", \"label\": \"" << preset.label
             << "\", \"description\": \"" << preset.description
             << "\", \"startFace\": " << preset.start.face << ", \"startBarycentric\": ["
             << preset.start.barycentric[0] << ", " << preset.start.barycentric[1] << ", "
             << preset.start.barycentric[2]
             << "], \"dijkstraStartVertex\": " << preset.dijkstraStartVertex
             << ", \"ambientChordLength\": " << preset.ambientChordLength
             << ", \"edgeDijkstraRouteLength\": " << preset.edgeDijkstraRouteLength
             << ", \"tracedHeatMethodRouteLength\": " << preset.tracedHeatMethodRouteLength
             << ", \"tracingReachedSource\": " << (preset.tracingReachedSource ? "true" : "false")
             << ", \"fallbackUsed\": " << (preset.fallbackUsed ? "true" : "false") << "}"
             << (index + 1U == routePresets.size() ? "\n" : ",\n");
  }
  metadata << "  ],\n"
           << "  \"solver\": {\"language\": \"C++20\", \"library\": \"Eigen 3.4\", "
              "\"precision\": \"float64\", \"direct\": \"SimplicialLDLT\", "
              "\"iterative\": \"conjugate gradient with incomplete Cholesky\"},\n"
           << "  \"reference\": \"Crane, Weischedel, Wardetzky, Geodesics in Heat, ACM TOG 2013\"\n"
           << "}\n";
  requireStream(metadata, metadataPath);

  return WebExportReport{binaryPath,
                         metadataPath,
                         mesh.vertices().size(),
                         mesh.faces().size(),
                         source,
                         heat.heatReport.relativeResidual,
                         heat.poissonReport.relativeResidual,
                         solver.preprocessingMilliseconds(),
                         heat.heatReport.milliseconds + heat.poissonReport.milliseconds,
                         routePresets};
}

} // namespace geodesic
