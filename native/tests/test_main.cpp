#include "geodesic/dijkstra.hpp"
#include "geodesic/heat_method.hpp"
#include "geodesic/io.hpp"
#include "geodesic/path.hpp"
#include "geodesic/procedural.hpp"

#ifdef GEODESIC_HAS_CUDA
#include "geodesic/cuda_solver.hpp"
#endif

#include <Eigen/Core>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <exception>
#include <functional>
#include <iostream>
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
  const geodesic::PlanetOptions options{4};
  const geodesic::TriangleMesh first = geodesic::makeCurvedWorld(options);
  const geodesic::TriangleMesh second = geodesic::makeCurvedWorld(options);
  CHECK(first.vertices().size() == 2562U);
  CHECK(first.faces().size() == 5120U);
  CHECK(first.vertices().size() == second.vertices().size());
  CHECK(first.faces().size() == second.faces().size());
  for (geodesic::Index vertex = 0; vertex < first.vertices().size(); vertex += 97U) {
    CHECK((first.vertices()[vertex].position - second.vertices()[vertex].position).norm() < 1e-15);
  }

  std::string reason;
  CHECK(first.validateManifold(&reason));
  CHECK(!first.hasBoundary());
  const long long eulerCharacteristic = static_cast<long long>(first.vertices().size()) -
                                        static_cast<long long>(first.edges().size()) +
                                        static_cast<long long>(first.faces().size());
  CHECK(eulerCharacteristic == 2);

  double minimumRadius = std::numeric_limits<double>::infinity();
  double maximumRadius = 0.0;
  geodesic::Vec3 minimum = geodesic::Vec3::Constant(std::numeric_limits<double>::infinity());
  geodesic::Vec3 maximum = geodesic::Vec3::Constant(-std::numeric_limits<double>::infinity());
  for (geodesic::Index vertex = 0; vertex < first.vertices().size(); ++vertex) {
    const geodesic::Vec3& point = first.vertices()[vertex].position;
    CHECK(point.allFinite());
    minimumRadius = std::min(minimumRadius, point.norm());
    maximumRadius = std::max(maximumRadius, point.norm());
    minimum = minimum.cwiseMin(point);
    maximum = maximum.cwiseMax(point);
    CHECK(first.vertexNormal(vertex).allFinite());
  }
  CHECK(minimumRadius > 0.6);
  CHECK(maximumRadius / minimumRadius > 1.7);
  const geodesic::Vec3 extents = maximum - minimum;
  CHECK(extents.maxCoeff() / extents.minCoeff() > 1.35);

  double maximumAspectRatio = 0.0;
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
    const geodesic::Vec3 centroid =
        (first.vertices()[triangle[0]].position + first.vertices()[triangle[1]].position +
         first.vertices()[triangle[2]].position) /
        3.0;
    CHECK(first.faceNormal(face).dot(centroid) > 0.0);
  }
  CHECK(maximumAspectRatio < 4.0);

  const geodesic::Index source = geodesic::selectCurvedWorldBeacon(first);
  geodesic::HeatMethodSolver solver(first);
  const geodesic::HeatMethodResult heat = solver.compute(source);
  CHECK(heat.heatReport.converged);
  CHECK(heat.poissonReport.converged);
  CHECK(heat.heatReport.relativeResidual < 1e-9);
  CHECK(heat.poissonReport.relativeResidual < 1e-9);
  const geodesic::DijkstraResult dijkstra = geodesic::edgeDijkstra(first, source);
  const std::vector<geodesic::WebRoutePreset> routes =
      geodesic::buildCurvedWorldRoutePresets(first, solver, heat, dijkstra, source);
  CHECK(routes.size() == 3U);
  const std::array<std::string, 3> expectedIds{"ridge-crossing", "saddle-pass", "basin-rim"};
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
  }
  for (std::size_t firstRoute = 0; firstRoute < routes.size(); ++firstRoute) {
    const geodesic::Vec3 firstStart =
        geodesic::interpolateSurfacePoint(first, routes[firstRoute].start);
    for (std::size_t secondRoute = firstRoute + 1U; secondRoute < routes.size(); ++secondRoute) {
      const geodesic::Vec3 secondStart =
          geodesic::interpolateSurfacePoint(first, routes[secondRoute].start);
      CHECK((firstStart - secondStart).norm() > 0.4);
      CHECK(std::abs(routes[firstRoute].tracedHeatMethodRouteLength -
                     routes[secondRoute].tracedHeatMethodRouteLength) > 0.01);
    }
  }
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

#ifdef GEODESIC_HAS_CUDA
void testCudaAgreementWhenDeviceAvailable() {
  if (!geodesic::cudaDeviceAvailable()) {
    std::cout << "[SKIP] CUDA agreement (no device)\n";
    return;
  }
  const geodesic::TriangleMesh mesh = geodesic::makeIcosphere(2);
  const geodesic::DiscreteOperators operators = geodesic::assembleOperators(mesh);
  geodesic::SparseMatrix heatMatrix = operators.suggestedTimeStep * operators.laplacian;
  for (int i = 0; i < operators.lumpedMass.size(); ++i) {
    heatMatrix.coeffRef(i, i) += operators.lumpedMass[i];
  }
  geodesic::Vector rhs = geodesic::Vector::Zero(heatMatrix.rows());
  rhs[0] = 1.0;
  geodesic::CudaPcgSolver gpu(heatMatrix);
  const geodesic::CudaSolveResult gpuResult = gpu.solve(rhs);
  Eigen::SimplicialLDLT<geodesic::SparseMatrix> cpu(heatMatrix);
  const geodesic::Vector cpuResult = cpu.solve(rhs);
  CHECK(gpuResult.report.converged);
  CHECK((gpuResult.solution - cpuResult).norm() / cpuResult.norm() < 1e-7);
}
#endif

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
      {"malformed and degenerate meshes", testMalformedAndDegenerateMeshes},
#ifdef GEODESIC_HAS_CUDA
      {"CPU versus CUDA", testCudaAgreementWhenDeviceAvailable},
#endif
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
