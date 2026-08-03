#pragma once

#include "geodesic/operators.hpp"

#include <Eigen/IterativeLinearSolvers>
#include <Eigen/SparseCholesky>

#include <vector>

namespace geodesic {

enum class CpuSolverKind { Direct, Iterative };

struct HeatMethodOptions {
  double timeScale{1.0};
  double zeroGradientEpsilon{1e-300};
  double solverTolerance{1e-10};
  int maxIterations{4000};
  CpuSolverKind solver{CpuSolverKind::Direct};
};

struct HeatMethodResult {
  Vector heat;
  std::vector<Vec3> directionField;
  Vector distance;
  SolveReport heatReport;
  SolveReport poissonReport;
  double timeStep{0.0};
  std::size_t zeroGradientFaces{0};
};

class HeatMethodSolver {
public:
  HeatMethodSolver(const TriangleMesh& mesh, HeatMethodOptions options = {});

  [[nodiscard]] const DiscreteOperators& operators() const noexcept {
    return operators_;
  }
  [[nodiscard]] const HeatMethodOptions& options() const noexcept {
    return options_;
  }
  [[nodiscard]] double preprocessingMilliseconds() const noexcept {
    return preprocessingMilliseconds_;
  }
  [[nodiscard]] bool ready() const noexcept {
    return ready_;
  }

  HeatMethodResult compute(Index sourceVertex) const;
  Vector solveHeatAtTime(Index sourceVertex, double timeStep, SolveReport* report = nullptr) const;

private:
  SolveReport solveSystem(const SparseMatrix& matrix,
                          const Eigen::SimplicialLDLT<SparseMatrix>& direct, const Vector& rhs,
                          Vector& x) const;
  SparseMatrix pinnedPoissonMatrix() const;

  const TriangleMesh& mesh_;
  HeatMethodOptions options_;
  DiscreteOperators operators_;
  SparseMatrix heatMatrix_;
  SparseMatrix poissonMatrix_;
  Eigen::SimplicialLDLT<SparseMatrix> heatDirect_;
  Eigen::SimplicialLDLT<SparseMatrix> poissonDirect_;
  double preprocessingMilliseconds_{0.0};
  bool ready_{false};
};

} // namespace geodesic
