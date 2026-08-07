#include "geodesic/dijkstra.hpp"
#include "geodesic/heat_method.hpp"
#include "geodesic/io.hpp"
#include "geodesic/path.hpp"
#include "geodesic/procedural.hpp"

#include <Eigen/Core>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <exception>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <iterator>
#include <limits>
#include <numbers>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

struct TestFailure : std::runtime_error {
  using std::runtime_error::runtime_error;
};

#define CHECK(condition)                                                                           \
  do {                                                                                             \
    if (!(condition)) {                                                                            \
      throw TestFailure(std::string("CHECK failed: ") + #condition + " at " + __FILE__ + ":" +     \
                        std::to_string(__LINE__));                                                 \
    }                                                                                              \
  } while (false)

void checkNear(double actual, double expected, double tolerance) {
  if (std::abs(actual - expected) > tolerance) {
    throw TestFailure("expected " + std::to_string(expected) + ", got " + std::to_string(actual) +
                      ", tolerance " + std::to_string(tolerance));
  }
}

void testHalfedgeInvariants() {
  const geodesic::TriangleMesh mesh = geodesic::makeIcosphere(1);
  std::string reason;
  CHECK(mesh.validateManifold(&reason));
  CHECK(mesh.halfedges().size() == mesh.faces().size() * 3U);
  CHECK(mesh.edges().size() * 2U == mesh.halfedges().size());
  CHECK(!mesh.hasBoundary());
  for (geodesic::Index h = 0; h < mesh.halfedges().size(); ++h) {
    const auto& halfedge = mesh.halfedges()[h];
    CHECK(halfedge.twin != geodesic::kInvalidIndex);
    CHECK(mesh.halfedges()[halfedge.twin].twin == h);
  }
}

void testAdjacencyAndBoundary() {
  const geodesic::TriangleMesh mesh = geodesic::makePlanarGrid(3, 4);
  CHECK(mesh.hasBoundary());
  CHECK(mesh.isBoundaryVertex(0));
  CHECK(!mesh.isBoundaryVertex(5));
  CHECK(mesh.oneRing(5).size() == 6U);
  CHECK(mesh.incidentFaces(5).size() == 6U);
  CHECK(mesh.oneRing(0).size() == 3U);
}

void testAreaAndNormals() {
  const geodesic::TriangleMesh mesh = geodesic::makePlanarGrid(2, 2, 2.0);
  CHECK(mesh.faces().size() == 2U);
  checkNear(mesh.faceArea(0), 2.0, 1e-12);
  checkNear(mesh.faceArea(1), 2.0, 1e-12);
  checkNear(mesh.faceNormal(0).z(), 1.0, 1e-12);
  checkNear(mesh.vertexNormal(0).z(), 1.0, 1e-12);
  checkNear(mesh.meanEdgeLength(), (2.0 + 2.0 + 2.0 + 2.0 + std::sqrt(8.0)) / 5.0, 1e-12);
}

void testOperators() {
  const geodesic::TriangleMesh mesh = geodesic::makePlanarGrid(6, 7);
  const geodesic::DiscreteOperators operators = geodesic::assembleOperators(mesh);
  CHECK(operators.laplacian.rows() == static_cast<int>(mesh.vertices().size()));
  CHECK(operators.lumpedMass.size() == static_cast<int>(mesh.vertices().size()));
  CHECK((operators.lumpedMass.array() > 0.0).all());
  const geodesic::SparseMatrix transpose = operators.laplacian.transpose();
  CHECK((operators.laplacian - transpose).norm() < 1e-12);
  const geodesic::Vector ones = geodesic::Vector::Ones(operators.laplacian.rows());
  CHECK((operators.laplacian * ones).norm() < 1e-11);
  CHECK(operators.suggestedTimeStep > 0.0);

  const auto gradient = geodesic::faceGradient(mesh, operators.faceGeometry, ones);
  for (const geodesic::Vec3& value : gradient) {
    CHECK(value.norm() < 1e-12);
  }
}

void testSolvesAndDeterminism() {
  const geodesic::TriangleMesh mesh = geodesic::makeIcosphere(2);
  geodesic::HeatMethodSolver solver(mesh);
  const geodesic::HeatMethodResult first = solver.compute(7);
  const geodesic::HeatMethodResult second = solver.compute(7);
  CHECK(first.heatReport.converged);
  CHECK(first.poissonReport.converged);
  CHECK(first.heatReport.relativeResidual < 1e-9);
  CHECK(first.poissonReport.relativeResidual < 1e-9);
  CHECK((first.distance - second.distance).norm() < 1e-12);
  CHECK((first.heat - second.heat).norm() < 1e-12);
  checkNear(first.distance[7], 0.0, 1e-12);
  CHECK(first.distance.maxCoeff() > 2.0);
}

void testFlatDomainDistanceAndPath() {
  constexpr int rows = 31;
  constexpr int columns = 31;
  const geodesic::TriangleMesh mesh = geodesic::makePlanarGrid(rows, columns, 0.1);
  const geodesic::Index source = static_cast<geodesic::Index>((rows / 2) * columns + columns / 2);
  geodesic::HeatMethodSolver solver(mesh);
  const geodesic::HeatMethodResult result = solver.compute(source);
  const std::array<geodesic::Index, 4> probes{
      static_cast<geodesic::Index>(source + 7), static_cast<geodesic::Index>(source + 6 * columns),
      static_cast<geodesic::Index>(source + 5 * columns + 4),
      static_cast<geodesic::Index>(source - 6 * columns - 3)};
  for (const geodesic::Index probe : probes) {
    const double exact =
        (mesh.vertices()[probe].position - mesh.vertices()[source].position).norm();
    const double error = std::abs(result.distance[static_cast<int>(probe)] - exact);
    CHECK(error < 0.14);
  }

  const geodesic::Index startFace = static_cast<geodesic::Index>(mesh.faces().size() - 3U);
  const geodesic::PathResult path =
      geodesic::traceDistanceGradient(mesh, solver.operators().faceGeometry, result.distance,
                                      source, geodesic::SurfacePoint{startFace, {0.2, 0.3, 0.5}});
  CHECK(path.reachedSource);
  CHECK(path.points.size() >= 2U);
  CHECK((path.points.back() - mesh.vertices()[source].position).norm() < 1e-12);
  CHECK(path.faceCrossings < 200U);
}

void testSphereGreatCircleDistance() {
  const geodesic::TriangleMesh mesh = geodesic::makeIcosphere(3);
  constexpr geodesic::Index source = 0;
  geodesic::HeatMethodSolver solver(mesh);
  const geodesic::HeatMethodResult result = solver.compute(source);
  const geodesic::Vec3 sourceDirection = mesh.vertices()[source].position.normalized();
  double relativeErrorSum = 0.0;
  std::size_t samples = 0;
  for (geodesic::Index vertex = 1; vertex < mesh.vertices().size(); vertex += 17U) {
    const double cosine =
        std::clamp(sourceDirection.dot(mesh.vertices()[vertex].position.normalized()), -1.0, 1.0);
    const double exact = std::acos(cosine);
    if (exact > 0.35 && exact < std::numbers::pi - 0.2) {
      relativeErrorSum += std::abs(result.distance[static_cast<int>(vertex)] - exact) / exact;
      ++samples;
    }
  }
  CHECK(samples > 20U);
  CHECK(relativeErrorSum / static_cast<double>(samples) < 0.075);
}

void testDirectIterativeAgreement() {
  const geodesic::TriangleMesh mesh = geodesic::makePlanarGrid(20, 20, 0.1);
  geodesic::HeatMethodOptions directOptions;
  directOptions.solver = geodesic::CpuSolverKind::Direct;
  geodesic::HeatMethodOptions iterativeOptions;
  iterativeOptions.solver = geodesic::CpuSolverKind::Iterative;
  iterativeOptions.solverTolerance = 1e-11;
  geodesic::HeatMethodSolver direct(mesh, directOptions);
  geodesic::HeatMethodSolver iterative(mesh, iterativeOptions);
  const geodesic::Index source = 210;
  const auto directResult = direct.compute(source);
  const auto iterativeResult = iterative.compute(source);
  CHECK(iterativeResult.heatReport.converged);
  CHECK(iterativeResult.poissonReport.converged);
  const double relative = (directResult.distance - iterativeResult.distance).norm() /
                          std::max(directResult.distance.norm(), 1e-30);
  CHECK(relative < 2e-7);
}

void testDijkstraBaseline() {
  const geodesic::TriangleMesh mesh = geodesic::makePlanarGrid(8, 8);
  const geodesic::DijkstraResult result = geodesic::edgeDijkstra(mesh, 0);
  const auto path = geodesic::reconstructVertexPath(result, 63, 0);
  CHECK(path.front() == 63U);
  CHECK(path.back() == 0U);
  CHECK(result.distance[63] >= std::sqrt(98.0));
}

geodesic::Index landmarkVertex(const geodesic::GeneratedCurvedWorld& world) {
  const geodesic::SurfacePoint& source = world.landmarks.source.point;
  const geodesic::Triangle& triangle = world.mesh.faces()[source.face].vertices;
  std::size_t local = 0;
  if (source.barycentric[1] > source.barycentric[local])
    local = 1;
  if (source.barycentric[2] > source.barycentric[local])
    local = 2;
  return triangle[local];
}

void testMultiGenusWorldsAndAuthoredRoutes() {
  std::set<std::size_t> vertexCounts;
  const std::array<std::string, 5> expectedCompositions{
      "irregular-ring", "folded-double-loop", "triangular-shared-hub", "square-shared-hub",
      "five-point-star-shared-hub"};
  const std::array<int, 5> expectedSmoothingPasses{4, 4, 8, 8, 12};
  const std::array<int, 5> expectedReprojectionPasses{4, 4, 8, 8, 4};
  for (int genus = 1; genus <= 5; ++genus) {
    geodesic::CurvedWorldOptions options;
    options.genus = genus;
    options.resolution = 40;
    const geodesic::GeneratedCurvedWorld first = geodesic::generateCurvedWorld(options);
    const geodesic::GeneratedCurvedWorld second = geodesic::generateCurvedWorld(options);
    const geodesic::TriangleMesh& mesh = first.mesh;
    CHECK(vertexCounts.insert(mesh.vertices().size()).second);
    CHECK(mesh.vertices().size() == second.mesh.vertices().size());
    CHECK(mesh.faces().size() == second.mesh.faces().size());
    for (geodesic::Index vertex = 0; vertex < mesh.vertices().size(); ++vertex) {
      CHECK(mesh.vertices()[vertex].position == second.mesh.vertices()[vertex].position);
      CHECK(mesh.vertices()[vertex].position.allFinite());
      CHECK(mesh.vertexNormal(vertex).allFinite());
      CHECK(mesh.vertexNormal(vertex).norm() > 0.99);
    }
    for (geodesic::Index face = 0; face < mesh.faces().size(); ++face) {
      CHECK(mesh.faces()[face].vertices == second.mesh.faces()[face].vertices);
    }

    std::string reason;
    CHECK(mesh.validateManifold(&reason));
    CHECK(!mesh.hasBoundary());
    CHECK(mesh.edges().size() * 2U == mesh.halfedges().size());
    CHECK(first.topology.connectedComponents == 1U);
    CHECK(first.topology.boundaryEdges == 0U);
    CHECK(first.topology.eulerCharacteristic == 2 - 2 * genus);
    CHECK(first.topology.recoveredGenus == genus);
    CHECK(first.topology.signedVolume > 0.5);
    CHECK(first.generator.composition == expectedCompositions[static_cast<std::size_t>(genus - 1)]);
    CHECK(first.generator.cycleRank == genus);
    CHECK(first.generator.effectiveTubeRadius > 0.18);
    CHECK(first.generator.smoothMinimumRadius > 0.0);
    CHECK(first.generator.smoothingPasses ==
          expectedSmoothingPasses[static_cast<std::size_t>(genus - 1)]);
    CHECK(first.generator.reprojectionPasses ==
          expectedReprojectionPasses[static_cast<std::size_t>(genus - 1)]);
    CHECK((first.generator.samplingMaximum - first.generator.samplingMinimum).minCoeff() > 0.0);
    if (genus >= 3) {
      CHECK(first.generator.junction == "shared-central-junction");
      CHECK(first.generator.centerlineSamples == 72);
      CHECK(first.generator.loopWidth > 0.0);
      CHECK(first.generator.gridOffsetFractions.minCoeff() > 0.0);
    } else {
      CHECK(first.generator.gridOffsetFractions.isZero());
    }

    std::set<std::array<geodesic::Index, 3>> uniqueFaces;
    std::vector<double> angles;
    double maximumAspectRatio = 0.0;
    for (geodesic::Index face = 0; face < mesh.faces().size(); ++face) {
      const double area = mesh.faceArea(face);
      CHECK(std::isfinite(area));
      CHECK(area > 1e-7);
      CHECK(mesh.faceNormal(face).allFinite());
      std::array<geodesic::Index, 3> key = mesh.faces()[face].vertices;
      std::sort(key.begin(), key.end());
      CHECK(uniqueFaces.insert(key).second);
      const geodesic::Triangle& triangle = mesh.faces()[face].vertices;
      const std::array<double, 3> lengths{
          (mesh.vertices()[triangle[1]].position - mesh.vertices()[triangle[2]].position).norm(),
          (mesh.vertices()[triangle[2]].position - mesh.vertices()[triangle[0]].position).norm(),
          (mesh.vertices()[triangle[0]].position - mesh.vertices()[triangle[1]].position).norm()};
      const double longestSquared =
          std::max({lengths[0] * lengths[0], lengths[1] * lengths[1], lengths[2] * lengths[2]});
      maximumAspectRatio = std::max(maximumAspectRatio, longestSquared / (2.0 * area));
      for (std::size_t corner = 0; corner < 3U; ++corner) {
        const double firstLength = lengths[(corner + 1U) % 3U];
        const double secondLength = lengths[(corner + 2U) % 3U];
        const double opposite = lengths[corner];
        const double cosine = std::clamp(
            (firstLength * firstLength + secondLength * secondLength - opposite * opposite) /
                (2.0 * firstLength * secondLength),
            -1.0, 1.0);
        angles.push_back(std::acos(cosine) * 180.0 / std::numbers::pi);
      }
    }
    std::sort(angles.begin(), angles.end());
    CHECK(angles.front() > 10.0);
    CHECK(angles[angles.size() / 100U] > 25.0);
    CHECK(maximumAspectRatio < 8.0);

    const geodesic::DiscreteOperators operators = geodesic::assembleOperators(mesh);
    CHECK((operators.lumpedMass.array() > 0.0).all());
    CHECK((operators.laplacian - geodesic::SparseMatrix(operators.laplacian.transpose())).norm() <
          1e-10);
    const geodesic::Index source = landmarkVertex(first);
    geodesic::HeatMethodSolver solver(mesh);
    const geodesic::HeatMethodResult heat = solver.compute(source);
    CHECK(heat.heatReport.converged);
    CHECK(heat.poissonReport.converged);
    CHECK(heat.heatReport.relativeResidual < 1e-9);
    CHECK(heat.poissonReport.relativeResidual < 1e-9);
    CHECK(heat.distance.allFinite());
    CHECK((heat.distance.array() >= 0.0).all());
    checkNear(heat.distance[static_cast<int>(source)], 0.0, 1e-12);
    const geodesic::DijkstraResult dijkstra = geodesic::edgeDijkstra(mesh, source);
    const std::vector<geodesic::WebRoutePreset> routes =
        geodesic::buildCurvedWorldRoutePresets(first, solver, heat, dijkstra, source);
    CHECK(routes.size() == 3U);
    const std::array<std::string, 3> expectedIds{"outer-ridge", "central-neck", "basin-rim"};
    std::set<geodesic::Index> startingFaces;
    std::size_t expectedOffset = 0;
    for (std::size_t index = 0; index < routes.size(); ++index) {
      const geodesic::WebRoutePreset& route = routes[index];
      CHECK(route.id == expectedIds[index]);
      CHECK(route.start.face < mesh.faces().size());
      CHECK(startingFaces.insert(route.start.face).second);
      checkNear(route.start.barycentric[0] + route.start.barycentric[1] +
                    route.start.barycentric[2],
                1.0, 1e-12);
      CHECK(*std::min_element(route.start.barycentric.begin(), route.start.barycentric.end()) >
            0.0);
      CHECK(route.tracingReachedSource);
      CHECK(!route.fallbackUsed);
      CHECK(route.tracedPoints.size() >= 4U);
      CHECK(route.edgeVertices.size() >= 3U);
      CHECK(route.edgeVertices.back() == source);
      CHECK(route.ambientChordLength > 0.0);
      CHECK(route.edgeDijkstraRouteLength > route.ambientChordLength);
      CHECK(route.tracedHeatMethodRouteLength > route.ambientChordLength);
      CHECK(route.tracedHeatMethodRouteLength <= 1.25 * route.edgeDijkstraRouteLength);
      CHECK(route.nativePathOffset == expectedOffset);
      expectedOffset += route.tracedPoints.size();
      CHECK(geodesic::reconstructVertexPath(dijkstra, route.dijkstraStartVertex, source) ==
            route.edgeVertices);
    }
  }

  bool rejected = false;
  try {
    geodesic::CurvedWorldOptions invalid;
    invalid.genus = 6;
    static_cast<void>(geodesic::generateCurvedWorld(invalid));
  } catch (const std::invalid_argument&) {
    rejected = true;
  }
  CHECK(rejected);
}

std::string readFile(const std::filesystem::path& path) {
  std::ifstream input(path, std::ios::binary);
  if (!input) {
    throw TestFailure("could not read deterministic export fixture");
  }
  return std::string(std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>());
}

void testDeterministicWebExport() {
  const std::filesystem::path root =
      std::filesystem::temp_directory_path() / "geodesic-world-export-test";
  const std::filesystem::path firstDirectory = root / "first";
  const std::filesystem::path secondDirectory = root / "second";
  std::filesystem::remove_all(root);

  geodesic::WebExportOptions options;
  options.world.resolution = 32;
  const std::vector<geodesic::WebExportReport> first =
      geodesic::exportAllCurvedWorlds(firstDirectory, options);
  const std::vector<geodesic::WebExportReport> second =
      geodesic::exportAllCurvedWorlds(secondDirectory, options);
  CHECK(first.size() == 5U);
  CHECK(second.size() == 5U);
  for (std::size_t index = 0; index < first.size(); ++index) {
    CHECK(first[index].genus == static_cast<int>(index + 1U));
    CHECK(first[index].eulerCharacteristic == 2 - 2 * first[index].genus);
    CHECK(first[index].sourceVertex == second[index].sourceVertex);
    CHECK(first[index].routePresets.size() == 3U);
    CHECK(first[index].minimumFinalRouteStartNormalizedHeat >= 0.08);
    CHECK(readFile(first[index].binaryPath) == readFile(second[index].binaryPath));
    CHECK(readFile(first[index].metadataPath) == readFile(second[index].metadataPath));
    const std::string metadata = readFile(first[index].metadataPath);
    CHECK(metadata.find("\"genus\": " + std::to_string(first[index].genus)) != std::string::npos);
    CHECK(metadata.find("\"eulerCharacteristic\": " +
                        std::to_string(first[index].eulerCharacteristic)) != std::string::npos);
    CHECK(metadata.find("\"nativePathCount\":") != std::string::npos);
    CHECK(metadata.find("\"schema\": \"geodesic-world-v4\"") != std::string::npos);
    CHECK(metadata.find("\"frameCount\": 9") != std::string::npos);
    CHECK(metadata.find("\"pathSolveUsesDisplayFrames\": false") != std::string::npos);
    CHECK(metadata.find("\"allRouteStartsReached\": true") != std::string::npos);
    CHECK(metadata.find("\"cycleRank\": " + std::to_string(first[index].genus)) !=
          std::string::npos);
  }
  const std::string firstManifest = readFile(firstDirectory / "manifest.json");
  CHECK(firstManifest == readFile(secondDirectory / "manifest.json"));
  CHECK(firstManifest.find("\"defaultGenus\": 2") != std::string::npos);
  CHECK(firstManifest.find("\"supportedGenera\": [1, 2, 3, 4, 5]") != std::string::npos);
  std::filesystem::remove_all(root);
}

void testMalformedAndDegenerateMeshes() {
  const std::vector<geodesic::Vec3> positions{{0, 0, 0}, {1, 0, 0}, {2, 0, 0}, {0, 1, 0}};
  bool rejected = false;
  try {
    static_cast<void>(geodesic::TriangleMesh::build(positions, {{0, 1, 2}}));
  } catch (const geodesic::MeshError&) {
    rejected = true;
  }
  CHECK(rejected);

  const geodesic::TriangleMesh skipped = geodesic::TriangleMesh::build(
      {{0, 0, 0}, {1, 0, 0}, {0, 1, 0}}, {{0, 1, 1}, {0, 1, 2}}, geodesic::DegeneratePolicy::Skip);
  CHECK(skipped.faces().size() == 1U);
  CHECK(skipped.skippedDegenerateFaces() == 1U);

  rejected = false;
  try {
    static_cast<void>(geodesic::TriangleMesh::build({{0, 0, 0}, {1, 0, 0}, {0, 1, 0}, {0, -1, 0}},
                                                    {{0, 1, 2}, {0, 1, 3}}));
  } catch (const geodesic::MeshError&) {
    rejected = true;
  }
  CHECK(rejected);

  // Two otherwise closed tetrahedra that touch at one vertex have manifold
  // edges but a disconnected vertex link, so the shared vertex is a bow tie.
  rejected = false;
  try {
    static_cast<void>(geodesic::TriangleMesh::build(
        {{0, 0, 0}, {1, 0, 0}, {0, 1, 0}, {0, 0, 1}, {-1, 0, 0}, {0, -1, 0}, {0, 0, -1}},
        {{0, 2, 1}, {0, 1, 3}, {0, 3, 2}, {1, 2, 3}, {0, 4, 5}, {0, 6, 4}, {0, 5, 6}, {4, 6, 5}}));
  } catch (const geodesic::MeshError&) {
    rejected = true;
  }
  CHECK(rejected);
}

} // namespace

int main() {
  const std::vector<std::pair<std::string, std::function<void()>>> tests{
      {"halfedge invariants", testHalfedgeInvariants},
      {"adjacency and boundary", testAdjacencyAndBoundary},
      {"area and normals", testAreaAndNormals},
      {"discrete operators", testOperators},
      {"solver residuals and determinism", testSolvesAndDeterminism},
      {"flat distance and path termination", testFlatDomainDistanceAndPath},
      {"sphere great-circle approximation", testSphereGreatCircleDistance},
      {"direct versus iterative", testDirectIterativeAgreement},
      {"Dijkstra baseline", testDijkstraBaseline},
      {"multi-genus worlds and authored routes", testMultiGenusWorldsAndAuthoredRoutes},
      {"deterministic web export", testDeterministicWebExport},
      {"malformed and degenerate meshes", testMalformedAndDegenerateMeshes},
  };

  std::size_t passed = 0;
  for (const auto& [name, test] : tests) {
    try {
      test();
      ++passed;
      std::cout << "[PASS] " << name << '\n';
    } catch (const std::exception& error) {
      std::cerr << "[FAIL] " << name << ": " << error.what() << '\n';
    }
  }
  std::cout << passed << '/' << tests.size() << " tests passed\n";
  return passed == tests.size() ? EXIT_SUCCESS : EXIT_FAILURE;
}
