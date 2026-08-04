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

struct PresetRoute {
  Index target{kInvalidIndex};
  std::vector<Vec3> heatPoints;
  std::vector<Index> edgeVertices;
  double chordLength{0.0};
  double heatLength{0.0};
  double edgeLength{0.0};
};

SurfacePoint vertexSurfacePoint(const TriangleMesh& mesh, Index vertex) {
  const std::vector<Index> faces = mesh.incidentFaces(vertex);
  if (faces.empty()) {
    throw std::runtime_error("target landmark has no incident face");
  }
  const Triangle& triangle = mesh.faces()[faces.front()].vertices;
  std::array<double, 3> barycentric{0.0, 0.0, 0.0};
  for (std::size_t local = 0; local < triangle.size(); ++local) {
    if (triangle[local] == vertex) {
      barycentric[local] = 1.0;
    }
  }
  return SurfacePoint{faces.front(), barycentric};
}

double polylineLength(const std::vector<Vec3>& points) {
  double length = 0.0;
  for (std::size_t index = 1; index < points.size(); ++index) {
    length += (points[index] - points[index - 1U]).norm();
  }
  return length;
}

PresetRoute buildPresetRoute(const TriangleMesh& mesh, const HeatMethodSolver& solver,
                             const HeatMethodResult& heat, const DijkstraResult& dijkstra,
                             Index source, Index target) {
  const PathResult path =
      traceDistanceGradient(mesh, solver.operators().faceGeometry, heat.distance, source,
                            vertexSurfacePoint(mesh, target));
  if (!path.reachedSource) {
    throw std::runtime_error("preset path did not reach the source: " + path.termination);
  }
  PresetRoute route;
  route.target = target;
  route.heatPoints = path.points;
  route.edgeVertices = reconstructVertexPath(dijkstra, target, source);
  route.chordLength = (mesh.vertices()[target].position - mesh.vertices()[source].position).norm();
  route.heatLength = polylineLength(route.heatPoints);
  route.edgeLength = dijkstra.distance[static_cast<int>(target)];
  if (route.edgeVertices.empty() || route.edgeVertices.back() != source ||
      !std::isfinite(route.edgeLength)) {
    throw std::runtime_error("preset edge route did not reach the source");
  }
  return route;
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

WebExportReport exportCurvedWorld(const std::filesystem::path& outputDirectory,
                                  const WebExportOptions& options) {
  if (options.heatTimeMultipliers.empty()) {
    throw std::invalid_argument("web export requires at least one heat frame");
  }
  std::filesystem::create_directories(outputDirectory);
  TriangleMesh mesh = makeCurvedWorld(CurvedWorldOptions{options.detailLevel});
  CurvedWorldLandmarks landmarks = selectCurvedWorldLandmarks(mesh);
  const Index source =
      options.sourceVertex == kInvalidIndex ? landmarks.source : options.sourceVertex;
  if (source >= mesh.vertices().size()) {
    throw std::invalid_argument("web export source is out of range");
  }
  landmarks.source = source;

  HeatMethodOptions solverOptions;
  solverOptions.solver = CpuSolverKind::Direct;
  HeatMethodSolver solver(mesh, solverOptions);
  HeatMethodResult heat = solver.compute(source);
  DijkstraResult dijkstra = edgeDijkstra(mesh, source);
  const std::array<Index, 3> presetTargets{landmarks.exterior, landmarks.tunnel, landmarks.farSide};
  std::array<PresetRoute, 3> presetRoutes;
  for (std::size_t index = 0; index < presetRoutes.size(); ++index) {
    presetRoutes[index] =
        buildPresetRoute(mesh, solver, heat, dijkstra, source, presetTargets[index]);
  }

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
  writeLittleEndian<std::uint32_t>(binary, static_cast<std::uint32_t>(presetRoutes.size()));
  writeLittleEndian<double>(binary, solver.operators().meanEdgeLength);
  writeLittleEndian<double>(binary, solver.operators().suggestedTimeStep);
  for (const PresetRoute& route : presetRoutes) {
    writeLittleEndian<std::uint32_t>(binary, route.target);
  }
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
  for (std::size_t index = 0; index < presetRoutes.size(); ++index) {
    const PresetRoute& route = presetRoutes[index];
    writeLittleEndian<std::uint32_t>(binary, static_cast<std::uint32_t>(index));
    writeLittleEndian<std::uint32_t>(binary, route.target);
    writeLittleEndian<std::uint32_t>(binary, static_cast<std::uint32_t>(route.heatPoints.size()));
    writeLittleEndian<std::uint32_t>(binary, static_cast<std::uint32_t>(route.edgeVertices.size()));
    writeLittleEndian<double>(binary, route.chordLength);
    writeLittleEndian<double>(binary, route.heatLength);
    writeLittleEndian<double>(binary, route.edgeLength);
    for (const Vec3& point : route.heatPoints) {
      for (int axis = 0; axis < 3; ++axis) {
        writeLittleEndian<float>(binary, static_cast<float>(point[axis]));
      }
    }
    for (const Index vertex : route.edgeVertices) {
      writeLittleEndian<std::uint32_t>(binary, vertex);
    }
  }
  requireStream(binary, binaryPath);

  const std::filesystem::path metadataPath = outputDirectory / "world.meta.json";
  std::ofstream metadata(metadataPath);
  requireStream(metadata, metadataPath);
  const long long eulerCharacteristic = static_cast<long long>(mesh.vertices().size()) -
                                        static_cast<long long>(mesh.edges().size()) +
                                        static_cast<long long>(mesh.faces().size());
  metadata
      << std::setprecision(12) << "{\n"
      << "  \"schema\": \"geodesic-world-v2\",\n"
      << "  \"title\": \"The Shortest Path Through a Curved World\",\n"
      << "  \"deterministicSeed\": " << CurvedWorldOptions{}.seed << ",\n"
      << "  \"detailLevel\": " << options.detailLevel << ",\n"
      << "  \"vertices\": " << mesh.vertices().size() << ",\n"
      << "  \"faces\": " << mesh.faces().size() << ",\n"
      << "  \"sourceVertex\": " << source << ",\n"
      << "  \"topology\": {\"closed\": true, \"orientedManifold\": true, "
         "\"eulerCharacteristic\": "
      << eulerCharacteristic << ", \"genus\": 1},\n"
      << "  \"targetPresets\": {\n"
      << "    \"exterior\": {\"vertex\": " << landmarks.exterior
      << ", \"chordLength\": " << presetRoutes[0].chordLength
      << ", \"heatRouteLength\": " << presetRoutes[0].heatLength
      << ", \"edgeRouteLength\": " << presetRoutes[0].edgeLength << "},\n"
      << "    \"tunnel\": {\"vertex\": " << landmarks.tunnel
      << ", \"chordLength\": " << presetRoutes[1].chordLength
      << ", \"heatRouteLength\": " << presetRoutes[1].heatLength
      << ", \"edgeRouteLength\": " << presetRoutes[1].edgeLength << "},\n"
      << "    \"farSide\": {\"vertex\": " << landmarks.farSide
      << ", \"chordLength\": " << presetRoutes[2].chordLength
      << ", \"heatRouteLength\": " << presetRoutes[2].heatLength
      << ", \"edgeRouteLength\": " << presetRoutes[2].edgeLength << "}\n"
      << "  },\n"
      << "  \"meanEdgeLength\": " << solver.operators().meanEdgeLength << ",\n"
      << "  \"heatMethodTimeStep\": " << solver.operators().suggestedTimeStep << ",\n"
      << "  \"laplacianSign\": \"positive-semidefinite stiffness matrix approximating -Delta\",\n"
      << "  \"boundaryCondition\": \"natural Neumann; primary world is closed\",\n"
      << "  \"heatEncoding\": \"per-frame log(u), linearly quantized to uint16\",\n"
      << "  \"heatResidual\": " << heat.heatReport.relativeResidual << ",\n"
      << "  \"poissonResidual\": " << heat.poissonReport.relativeResidual << ",\n"
      << "  \"zeroGradientFaces\": " << heat.zeroGradientFaces << ",\n"
      << "  \"operatorAssemblyMilliseconds\": " << solver.operatorAssemblyMilliseconds() << ",\n"
      << "  \"factorizationMilliseconds\": " << solver.factorizationMilliseconds() << ",\n"
      << "  \"preprocessingMilliseconds\": " << solver.preprocessingMilliseconds() << ",\n"
      << "  \"heatSolveMilliseconds\": " << heat.heatReport.milliseconds << ",\n"
      << "  \"poissonSolveMilliseconds\": " << heat.poissonReport.milliseconds << ",\n"
      << "  \"dijkstraMilliseconds\": " << dijkstra.milliseconds << ",\n"
      << "  \"engine\": \"C++20 with Eigen sparse direct and iterative solvers\",\n"
      << "  \"reference\": \"Crane, Weischedel, Wardetzky, Geodesics in Heat, ACM TOG 2013\"\n"
      << "}\n";
  requireStream(metadata, metadataPath);

  return WebExportReport{binaryPath,
                         metadataPath,
                         mesh.vertices().size(),
                         mesh.faces().size(),
                         source,
                         landmarks,
                         heat.heatReport.relativeResidual,
                         heat.poissonReport.relativeResidual,
                         solver.preprocessingMilliseconds(),
                         heat.heatReport.milliseconds + heat.poissonReport.milliseconds};
}

} // namespace geodesic
