#pragma once

#include "geodesic/mesh.hpp"
#include "geodesic/types.hpp"

#include <memory>
#include <vector>

namespace geodesic {

struct CudaSolveOptions {
  double tolerance{1e-10};
  int maxIterations{5000};
  bool warmup{true};
};

struct CudaSolveResult {
  Vector solution;
  SolveReport report;
  double transferMilliseconds{0.0};
  double kernelMilliseconds{0.0};
};

struct CudaFaceGeometryResult {
  std::vector<Vec3> normals;
  std::vector<double> areas;
  double transferMilliseconds{0.0};
  double kernelMilliseconds{0.0};
};

bool cudaDeviceAvailable() noexcept;

// A reusable double-precision PCG solve. Matrix storage, cuSPARSE descriptors,
// Jacobi preconditioner, and work buffers remain resident across RHS queries.
class CudaPcgSolver {
public:
  explicit CudaPcgSolver(const SparseMatrix& matrix, CudaSolveOptions options = {});
  ~CudaPcgSolver();
  CudaPcgSolver(CudaPcgSolver&&) noexcept;
  CudaPcgSolver& operator=(CudaPcgSolver&&) noexcept;
  CudaPcgSolver(const CudaPcgSolver&) = delete;
  CudaPcgSolver& operator=(const CudaPcgSolver&) = delete;

  CudaSolveResult solve(const Vector& rhs);
  std::vector<CudaSolveResult> solveBatched(const std::vector<Vector>& rightHandSides);
  [[nodiscard]] double preprocessingMilliseconds() const noexcept;

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

CudaFaceGeometryResult cudaComputeFaceGeometry(const TriangleMesh& mesh);
std::vector<Vec3> cudaNormalizeNegative(const std::vector<Vec3>& vectors, double epsilon = 1e-12);

} // namespace geodesic
