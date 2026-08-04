#include "geodesic/dijkstra.hpp"
#include "geodesic/heat_method.hpp"
#include "geodesic/path.hpp"
#include "geodesic/procedural.hpp"

#include <Eigen/Core>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <exception>
#include <functional>
#include <iostream>
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

geodesic::SurfacePoint surfacePointAtVertex(const geodesic::TriangleMesh& mesh,
                                            geodesic::Index vertex) {
  const std::vector<geodesic::Index> faces = mesh.incidentFaces(vertex);
  CHECK(!faces.empty());
  const geodesic::Triangle& triangle = mesh.faces()[faces.front()].vertices;
  std::array<double, 3> barycentric{0.0, 0.0, 0.0};
  for (std::size_t local = 0; local < triangle.size(); ++local) {
    if (triangle[local] == vertex) {
      barycentric[local] = 1.0;
    }
  }
  return geodesic::SurfacePoint{faces.front(), barycentric};
}

void testGenusOneCurvedWorld() {
  const geodesic::TriangleMesh first = geodesic::makeCurvedWorld(geodesic::CurvedWorldOptions{4});
  const geodesic::TriangleMesh second = geodesic::makeCurvedWorld(geodesic::CurvedWorldOptions{4});
  CHECK(first.vertices().size() == 2560U);
  CHECK(first.faces().size() == 5120U);
  CHECK(first.vertices().size() == second.vertices().size());
  CHECK(first.faces().size() == second.faces().size());
  CHECK((first.vertices()[713].position - second.vertices()[713].position).norm() < 1e-15);

  std::string reason;
  CHECK(first.validateManifold(&reason));
  CHECK(!first.hasBoundary());
  const long long eulerCharacteristic = static_cast<long long>(first.vertices().size()) -
                                        static_cast<long long>(first.edges().size()) +
                                        static_cast<long long>(first.faces().size());
  CHECK(eulerCharacteristic == 0);
  double maximumAspect = 0.0;
  for (geodesic::Index face = 0; face < first.faces().size(); ++face) {
    CHECK(first.faceArea(face) > 1e-12);
    CHECK(first.faceNormal(face).allFinite());
    const geodesic::Triangle& triangle = first.faces()[face].vertices;
    const geodesic::Vec3& a = first.vertices()[triangle[0]].position;
    const geodesic::Vec3& b = first.vertices()[triangle[1]].position;
    const geodesic::Vec3& c = first.vertices()[triangle[2]].position;
    const double longestSquared =
        std::max({(a - b).squaredNorm(), (b - c).squaredNorm(), (c - a).squaredNorm()});
    maximumAspect = std::max(maximumAspect, longestSquared / (2.0 * first.faceArea(face)));
  }
  CHECK(maximumAspect < 3.25);
  double minimumRadialDistance = std::numeric_limits<double>::infinity();
  for (geodesic::Index vertex = 0; vertex < first.vertices().size(); ++vertex) {
    CHECK(first.vertexNormal(vertex).allFinite());
    const geodesic::Vec3& position = first.vertices()[vertex].position;
    minimumRadialDistance = std::min(minimumRadialDistance, std::hypot(position.x(), position.y()));
  }
  CHECK(minimumRadialDistance > 0.5);

  const geodesic::CurvedWorldLandmarks landmarks = geodesic::selectCurvedWorldLandmarks(first);
  const std::array<geodesic::Index, 4> landmarkVertices{landmarks.source, landmarks.exterior,
                                                        landmarks.tunnel, landmarks.farSide};
  for (const geodesic::Index vertex : landmarkVertices) {
    CHECK(vertex < first.vertices().size());
  }
  CHECK(std::set<geodesic::Index>(landmarkVertices.begin(), landmarkVertices.end()).size() ==
        landmarkVertices.size());
  const auto radialDistance = [&first](geodesic::Index vertex) {
    const geodesic::Vec3& position = first.vertices()[vertex].position;
    return std::hypot(position.x(), position.y());
  };
  CHECK(radialDistance(landmarks.tunnel) < radialDistance(landmarks.exterior));
  const auto radialNormalAlignment = [&first](geodesic::Index vertex) {
    const geodesic::Vec3& position = first.vertices()[vertex].position;
    const geodesic::Vec3 radial(position.x(), position.y(), 0.0);
    return first.vertexNormal(vertex).dot(radial.normalized());
  };
  CHECK(radialNormalAlignment(landmarks.exterior) > 0.8);
  CHECK(radialNormalAlignment(landmarks.tunnel) < -0.8);

  geodesic::HeatMethodSolver solver(first);
  const geodesic::HeatMethodResult heat = solver.compute(landmarks.source);
  CHECK(heat.heatReport.converged);
  CHECK(heat.poissonReport.converged);
  CHECK(heat.heatReport.relativeResidual < 1e-9);
  CHECK(heat.poissonReport.relativeResidual < 1e-9);

  const geodesic::DijkstraResult dijkstra = geodesic::edgeDijkstra(first, landmarks.source);
  for (const geodesic::Index target : {landmarks.exterior, landmarks.tunnel, landmarks.farSide}) {
    const std::vector<geodesic::Index> path =
        geodesic::reconstructVertexPath(dijkstra, target, landmarks.source);
    CHECK(!path.empty());
    CHECK(path.front() == target);
    CHECK(path.back() == landmarks.source);
    CHECK(path.size() <= first.vertices().size());
  }

  for (const geodesic::Index target : {landmarks.exterior, landmarks.tunnel}) {
    const geodesic::PathResult path =
        geodesic::traceDistanceGradient(first, solver.operators().faceGeometry, heat.distance,
                                        landmarks.source, surfacePointAtVertex(first, target));
    CHECK(path.reachedSource);
    CHECK(path.points.size() >= 2U);
    CHECK((path.points.back() - first.vertices()[landmarks.source].position).norm() < 1e-12);
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
      {"genus-one curved world", testGenusOneCurvedWorld},
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
