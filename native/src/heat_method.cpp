#include "geodesic/heat_method.hpp"

#include <Eigen/IterativeLinearSolvers>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <stdexcept>
#include <vector>

namespace geodesic {
namespace {

using Clock = std::chrono::steady_clock;

double elapsedMilliseconds(const Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

SparseMatrix makeHeatMatrix(const SparseMatrix& laplacian, const Vector& mass, double timeStep) {
  SparseMatrix matrix = timeStep * laplacian;
  for (int i = 0; i < mass.size(); ++i) {
    matrix.coeffRef(i, i) += mass[i];
  }
  matrix.makeCompressed();
  return matrix;
}

} // namespace

HeatMethodSolver::HeatMethodSolver(const TriangleMesh& mesh, HeatMethodOptions options)
    : mesh_(mesh), options_(options) {
  if (!(options_.solverTolerance > 0.0) || options_.maxIterations <= 0 ||
      !(options_.zeroGradientEpsilon > 0.0)) {
    throw std::invalid_argument("invalid Heat Method solver options");
  }

  const auto start = Clock::now();
  operators_ = assembleOperators(mesh, options.timeScale);
  heatMatrix_ =
      makeHeatMatrix(operators_.laplacian, operators_.lumpedMass, operators_.suggestedTimeStep);
  poissonMatrix_ = pinnedPoissonMatrix();
  heatDirect_.compute(heatMatrix_);
  poissonDirect_.compute(poissonMatrix_);
  ready_ = heatDirect_.info() == Eigen::Success && poissonDirect_.info() == Eigen::Success;
  preprocessingMilliseconds_ = elapsedMilliseconds(start);
  if (!ready_) {
    throw std::runtime_error("sparse factorization failed during Heat Method preprocessing");
  }
}

SparseMatrix HeatMethodSolver::pinnedPoissonMatrix() const {
  const int count = static_cast<int>(mesh_.vertices().size());
  std::vector<Eigen::Triplet<double, int>> triplets;
  triplets.reserve(static_cast<std::size_t>(operators_.laplacian.nonZeros()) + 1U);
  for (int outer = 0; outer < operators_.laplacian.outerSize(); ++outer) {
    for (SparseMatrix::InnerIterator entry(operators_.laplacian, outer); entry; ++entry) {
      if (entry.row() != 0 && entry.col() != 0) {
        triplets.emplace_back(entry.row(), entry.col(), entry.value());
      }
    }
  }
  triplets.emplace_back(0, 0, 1.0);
  SparseMatrix result(count, count);
  result.setFromTriplets(triplets.begin(), triplets.end(), std::plus<double>());
  result.makeCompressed();
  return result;
}

SolveReport HeatMethodSolver::solveSystem(const SparseMatrix& matrix,
                                          const Eigen::SimplicialLDLT<SparseMatrix>& direct,
                                          const Vector& rhs, Vector& x) const {
  SolveReport report;
  const auto start = Clock::now();
  if (options_.solver == CpuSolverKind::Direct) {
    x = direct.solve(rhs);
    report.converged = direct.info() == Eigen::Success && x.allFinite();
    report.iterations = 1;
    report.method = "Eigen SimplicialLDLT";
  } else {
    Eigen::ConjugateGradient<SparseMatrix, Eigen::Lower | Eigen::Upper,
                             Eigen::IncompleteCholesky<double>>
        iterative;
    iterative.setTolerance(options_.solverTolerance);
    iterative.setMaxIterations(options_.maxIterations);
    iterative.compute(matrix);
    x = iterative.solve(rhs);
    report.converged = iterative.info() == Eigen::Success && x.allFinite();
    report.iterations = static_cast<int>(iterative.iterations());
    report.method = "Eigen PCG + incomplete Cholesky";
  }
  report.milliseconds = elapsedMilliseconds(start);
  report.relativeResidual =
      x.allFinite() ? relativeResidual(matrix, x, rhs) : std::numeric_limits<double>::infinity();
  report.converged = report.converged &&
                     report.relativeResidual <= std::max(options_.solverTolerance * 20.0, 1e-9);
  return report;
}

HeatMethodResult HeatMethodSolver::compute(Index sourceVertex) const {
  if (sourceVertex >= mesh_.vertices().size()) {
    throw std::invalid_argument("source vertex is out of range");
  }
  if (!ready_) {
    throw std::runtime_error("Heat Method solver is not ready");
  }

  const int count = static_cast<int>(mesh_.vertices().size());
  Vector rhs = Vector::Zero(count);
  // delta_s has value 1/M_ss; multiplying by M therefore gives a unit load.
  rhs[static_cast<int>(sourceVertex)] = 1.0;

  HeatMethodResult result;
  result.timeStep = operators_.suggestedTimeStep;
  result.heatReport = solveSystem(heatMatrix_, heatDirect_, rhs, result.heat);
  if (!result.heatReport.converged) {
    throw std::runtime_error("heat solve did not satisfy its residual tolerance");
  }

  std::vector<Vec3> gradients = faceGradient(mesh_, operators_.faceGeometry, result.heat);
  result.directionField.resize(gradients.size(), Vec3::Zero());
  for (std::size_t face = 0; face < gradients.size(); ++face) {
    const double norm = gradients[face].norm();
    if (!std::isfinite(norm) || norm <= options_.zeroGradientEpsilon) {
      ++result.zeroGradientFaces;
      continue;
    }
    result.directionField[face] = -gradients[face] / norm;
  }

  Vector load = gradientLoad(mesh_, operators_.faceGeometry, result.directionField);
  load[0] = 0.0;
  result.poissonReport = solveSystem(poissonMatrix_, poissonDirect_, load, result.distance);
  if (!result.poissonReport.converged) {
    throw std::runtime_error("Poisson solve did not satisfy its residual tolerance");
  }

  result.distance.array() -= result.distance[static_cast<int>(sourceVertex)];
  const double negativeTolerance = -1e-8 * operators_.meanEdgeLength;
  for (int i = 0; i < result.distance.size(); ++i) {
    if (result.distance[i] < 0.0 && result.distance[i] >= negativeTolerance) {
      result.distance[i] = 0.0;
    }
  }
  // Discretization can very occasionally place a tiny lower value beside the source.
  // Clamping preserves the field's descent direction away from that local source patch.
  result.distance = result.distance.cwiseMax(0.0);
  result.distance[static_cast<int>(sourceVertex)] = 0.0;
  return result;
}

Vector HeatMethodSolver::solveHeatAtTime(Index sourceVertex, double timeStep,
                                         SolveReport* report) const {
  if (sourceVertex >= mesh_.vertices().size()) {
    throw std::invalid_argument("source vertex is out of range");
  }
  if (!(timeStep > 0.0) || !std::isfinite(timeStep)) {
    throw std::invalid_argument("heat time step must be positive and finite");
  }
  SparseMatrix matrix = makeHeatMatrix(operators_.laplacian, operators_.lumpedMass, timeStep);
  Eigen::SimplicialLDLT<SparseMatrix> direct;
  direct.compute(matrix);
  if (direct.info() != Eigen::Success) {
    throw std::runtime_error("heat-frame factorization failed");
  }
  Vector rhs = Vector::Zero(static_cast<int>(mesh_.vertices().size()));
  rhs[static_cast<int>(sourceVertex)] = 1.0;
  Vector solution;
  SolveReport local = solveSystem(matrix, direct, rhs, solution);
  if (report != nullptr) {
    *report = local;
  }
  if (!local.converged) {
    throw std::runtime_error("heat-frame solve failed its residual check");
  }
  return solution;
}

} // namespace geodesic
