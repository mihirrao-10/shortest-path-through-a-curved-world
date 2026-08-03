#pragma once

#include <Eigen/Core>
#include <Eigen/Geometry>
#include <Eigen/Sparse>

#include <array>
#include <cstdint>
#include <limits>
#include <string>
#include <vector>

namespace geodesic {

using Index = std::uint32_t;
inline constexpr Index kInvalidIndex = std::numeric_limits<Index>::max();
using Vec3 = Eigen::Vector3d;
using Triangle = std::array<Index, 3>;
using SparseMatrix = Eigen::SparseMatrix<double, Eigen::ColMajor, int>;
using Vector = Eigen::VectorXd;

struct SolveReport {
  bool converged{false};
  int iterations{0};
  double relativeResidual{std::numeric_limits<double>::infinity()};
  double milliseconds{0.0};
  std::string method;
};

} // namespace geodesic
