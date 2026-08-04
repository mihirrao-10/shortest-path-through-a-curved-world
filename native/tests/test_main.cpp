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

void testComplexCurvedWorldAndAuthoredRoutes() {
  geodesic::TorusOptions options;
  const geodesic::TriangleMesh first = geodesic::makeCurvedWorld(options);
  const geodesic::TriangleMesh second = geodesic::makeCurvedWorld(options);
  CHECK(first.vertices().size() == 10240U);
  CHECK(first.faces().size() == 20480U);
  CHECK(first.edges().size() == 30720U);
  CHECK(first.vertices().size() == second.vertices().size());
  CHECK(first.faces().size() == second.faces().size());
  for (geodesic::Index vertex = 0; vertex < first.vertices().size(); ++vertex) {
    CHECK((first.vertices()[vertex].position - second.vertices()[vertex].position).norm() < 1e-15);
  }

  const geodesic::Index lastMajorStart =
      static_cast<geodesic::Index>((options.majorSegments - 1) * options.minorSegments);
  const geodesic::Index lastMinor = static_cast<geodesic::Index>(options.minorSegments - 1);
  const geodesic::Triangle& wrappedMajor = first.faces()[2U * lastMajorStart].vertices;
  CHECK(wrappedMajor[0] == lastMajorStart);
  CHECK(wrappedMajor[1] == 0U);
  const geodesic::Triangle& wrappedMinor = first.faces()[2U * lastMinor].vertices;
  CHECK(wrappedMinor[0] == lastMinor);
  CHECK(wrappedMinor[2] == static_cast<geodesic::Index>(options.minorSegments));

  std::string reason;
  CHECK(first.validateManifold(&reason));
  CHECK(!first.hasBoundary());
  const long long eulerCharacteristic = static_cast<long long>(first.vertices().size()) -
                                        static_cast<long long>(first.edges().size()) +
                                        static_cast<long long>(first.faces().size());
  CHECK(eulerCharacteristic == 0);
  const long long genus = 1 - eulerCharacteristic / 2;
  CHECK(genus == 1);

  std::vector<geodesic::Vec3> ringCenters(static_cast<std::size_t>(options.majorSegments),
                                          geodesic::Vec3::Zero());
  for (int major = 0; major < options.majorSegments; ++major) {
    for (int minor = 0; minor < options.minorSegments; ++minor) {
      const geodesic::Index vertex =
          static_cast<geodesic::Index>(major * options.minorSegments + minor);
      ringCenters[static_cast<std::size_t>(major)] += first.vertices()[vertex].position;
    }
    ringCenters[static_cast<std::size_t>(major)] /= static_cast<double>(options.minorSegments);
  }

  double minimumCenterRadius = std::numeric_limits<double>::infinity();
  double maximumTubeRadius = 0.0;
  std::vector<double> tubeRadii(static_cast<std::size_t>(options.majorSegments), 0.0);
  for (geodesic::Index vertex = 0; vertex < first.vertices().size(); ++vertex) {
    const geodesic::Vec3& point = first.vertices()[vertex].position;
    CHECK(point.allFinite());
    CHECK(first.vertexNormal(vertex).allFinite());
    const std::size_t major = vertex / static_cast<geodesic::Index>(options.minorSegments);
    const geodesic::Vec3 outward = point - ringCenters[major];
    maximumTubeRadius = std::max(maximumTubeRadius, outward.norm());
    tubeRadii[major] = std::max(tubeRadii[major], outward.norm());
    CHECK(first.vertexNormal(vertex).dot(outward.normalized()) > 0.65);
  }
  for (const geodesic::Vec3& center : ringCenters) {
    minimumCenterRadius = std::min(minimumCenterRadius, std::hypot(center.x(), center.y()));
  }
  CHECK(minimumCenterRadius - maximumTubeRadius > 0.24);
  const int localSectionWindow = options.majorSegments / 6;
  for (int firstMajor = 0; firstMajor < options.majorSegments; ++firstMajor) {
    for (int secondMajor = firstMajor + 1; secondMajor < options.majorSegments; ++secondMajor) {
      const int directSeparation = secondMajor - firstMajor;
      const int periodicSeparation =
          std::min(directSeparation, options.majorSegments - directSeparation);
      if (periodicSeparation <= localSectionWindow) {
        continue;
      }
      const double centerDistance = (ringCenters[static_cast<std::size_t>(firstMajor)] -
                                     ringCenters[static_cast<std::size_t>(secondMajor)])
                                        .norm();
      CHECK(centerDistance > tubeRadii[static_cast<std::size_t>(firstMajor)] +
                                 tubeRadii[static_cast<std::size_t>(secondMajor)]);
    }
  }

  double maximumAspectRatio = 0.0;
  double minimumAngle = std::numbers::pi;
  for (geodesic::Index face = 0; face < first.faces().size(); ++face) {
    CHECK(std::isfinite(first.faceArea(face)));
    CHECK(first.faceArea(face) > 1e-10);
    CHECK(first.faceNormal(face).allFinite());
    const geodesic::Triangle& triangle = first.faces()[face].vertices;
    const geodesic::Vec3 edge01 =
        first.vertices()[triangle[1]].position - first.vertices()[triangle[0]].position;
    const geodesic::Vec3 edge12 =
        first.vertices()[triangle[2]].position - first.vertices()[triangle[1]].position;
    const geodesic::Vec3 edge20 =
        first.vertices()[triangle[0]].position - first.vertices()[triangle[2]].position;
    const double longestSquaredEdge =
        std::max({edge01.squaredNorm(), edge12.squaredNorm(), edge20.squaredNorm()});
    maximumAspectRatio =
        std::max(maximumAspectRatio, longestSquaredEdge / (2.0 * first.faceArea(face)));
    const std::array<double, 3> lengths{edge12.norm(), edge20.norm(), edge01.norm()};
    for (std::size_t corner = 0; corner < 3U; ++corner) {
      const double adjacentFirst = lengths[(corner + 1U) % 3U];
      const double adjacentSecond = lengths[(corner + 2U) % 3U];
      const double opposite = lengths[corner];
      const double cosine = std::clamp(
          (adjacentFirst * adjacentFirst + adjacentSecond * adjacentSecond - opposite * opposite) /
              (2.0 * adjacentFirst * adjacentSecond),
          -1.0, 1.0);
      minimumAngle = std::min(minimumAngle, std::acos(cosine));
    }
    for (const geodesic::Index vertex : triangle) {
      CHECK(vertex < first.vertices().size());
    }
  }
  CHECK(maximumAspectRatio < 3.6);
  CHECK(minimumAngle * 180.0 / std::numbers::pi > 18.0);

  const geodesic::DiscreteOperators operators = geodesic::assembleOperators(first);
  CHECK((operators.lumpedMass.array() > 0.0).all());
  CHECK((operators.laplacian - geodesic::SparseMatrix(operators.laplacian.transpose())).norm() <
        1e-11);
  CHECK((operators.laplacian * geodesic::Vector::Ones(operators.laplacian.rows())).norm() < 1e-10);

  const geodesic::Index source = geodesic::selectCurvedWorldBeacon(first, options);
  CHECK(source == geodesic::selectCurvedWorldBeacon(second, options));
  geodesic::HeatMethodSolver solver(first);
  const geodesic::HeatMethodResult heat = solver.compute(source);
  CHECK(heat.heatReport.converged);
  CHECK(heat.poissonReport.converged);
  CHECK(heat.heatReport.relativeResidual < 1e-9);
  CHECK(heat.poissonReport.relativeResidual < 1e-9);
  CHECK(heat.distance.allFinite());
  CHECK((heat.distance.array() >= 0.0).all());
  checkNear(heat.distance[static_cast<int>(source)], 0.0, 1e-12);
  const geodesic::DijkstraResult dijkstra = geodesic::edgeDijkstra(first, source);
  const std::vector<geodesic::WebRoutePreset> routes =
      geodesic::buildCurvedWorldRoutePresets(first, solver, heat, dijkstra, source, options);
  CHECK(routes.size() == 3U);
  const std::array<std::string, 3> expectedIds{"ridge-crossing", "inner-saddle-pass", "basin-rim"};
  std::set<geodesic::Index> startingFaces;
  for (std::size_t index = 0; index < routes.size(); ++index) {
    const geodesic::WebRoutePreset& route = routes[index];
    CHECK(route.id == expectedIds[index]);
    CHECK(route.start.face < first.faces().size());
    CHECK(startingFaces.insert(route.start.face).second);
    const double barycentricSum =
        route.start.barycentric[0] + route.start.barycentric[1] + route.start.barycentric[2];
    checkNear(barycentricSum, 1.0, 1e-12);
    CHECK(*std::min_element(route.start.barycentric.begin(), route.start.barycentric.end()) > 0.0);
    CHECK(route.dijkstraStartVertex < first.vertices().size());
    CHECK(route.tracingReachedSource);
    CHECK(!route.fallbackUsed);
    CHECK(route.tracedPoints.size() > 2U);
    CHECK(route.edgeVertices.size() > 2U);
    CHECK(route.edgeVertices.back() == source);
    CHECK(route.ambientChordLength > 0.5);
    CHECK(route.edgeDijkstraRouteLength > route.ambientChordLength);
    CHECK(route.tracedHeatMethodRouteLength > route.ambientChordLength);
    CHECK(route.tracedHeatMethodRouteLength <= 1.25 * route.edgeDijkstraRouteLength);
    const std::vector<geodesic::Index> reconstructed =
        geodesic::reconstructVertexPath(dijkstra, route.dijkstraStartVertex, source);
    CHECK(reconstructed == route.edgeVertices);
  }
  for (std::size_t firstRoute = 0; firstRoute < routes.size(); ++firstRoute) {
    const geodesic::Vec3 firstStart =
        geodesic::interpolateSurfacePoint(first, routes[firstRoute].start);
    for (std::size_t secondRoute = firstRoute + 1U; secondRoute < routes.size(); ++secondRoute) {
      const geodesic::Vec3 secondStart =
          geodesic::interpolateSurfacePoint(first, routes[secondRoute].start);
      CHECK((firstStart - secondStart).norm() > 0.7);
      CHECK(std::abs(routes[firstRoute].tracedHeatMethodRouteLength -
                     routes[secondRoute].tracedHeatMethodRouteLength) > 0.04);
    }
  }
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
      std::filesystem::temp_directory_path() / "geodesic-torus-export-test";
  const std::filesystem::path firstDirectory = root / "first";
  const std::filesystem::path secondDirectory = root / "second";
  std::filesystem::remove_all(root);

  geodesic::WebExportOptions options;
  options.torus.majorSegments = 80;
  options.torus.minorSegments = 32;
  const geodesic::WebExportReport first = geodesic::exportCurvedWorld(firstDirectory, options);
  const geodesic::WebExportReport second = geodesic::exportCurvedWorld(secondDirectory, options);
  CHECK(first.vertexCount == 2560U);
  CHECK(first.faceCount == 5120U);
  CHECK(first.sourceVertex == second.sourceVertex);
  CHECK(first.routePresets.size() == 3U);
  CHECK(readFile(first.binaryPath) == readFile(second.binaryPath));
  CHECK(readFile(first.metadataPath) == readFile(second.metadataPath));
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
      positions, {{0, 1, 2}, {0, 1, 3}}, geodesic::DegeneratePolicy::Skip);
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
      {"complex curved world and authored routes", testComplexCurvedWorldAndAuthoredRoutes},
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
