#include "geodesic/operators.hpp"

#include <Eigen/SparseCore>

#include <cmath>
#include <stdexcept>
#include <vector>

namespace geodesic {

DiscreteOperators assembleOperators(const TriangleMesh& mesh, double timeScale, double epsilon) {
  if (!(timeScale > 0.0) || !std::isfinite(timeScale)) {
    throw std::invalid_argument("time scale must be positive and finite");
  }
  if (!(epsilon > 0.0) || !std::isfinite(epsilon)) {
    throw std::invalid_argument("operator epsilon must be positive and finite");
  }

  const int vertexCount = static_cast<int>(mesh.vertices().size());
  DiscreteOperators result;
  result.lumpedMass = Vector::Zero(vertexCount);
  result.faceGeometry.resize(mesh.faces().size());
  std::vector<Eigen::Triplet<double, int>> triplets;
  triplets.reserve(mesh.faces().size() * 12U);

  for (Index face = 0; face < mesh.faces().size(); ++face) {
    const Triangle& triangle = mesh.faces()[face].vertices;
    const Vec3& p0 = mesh.vertices()[triangle[0]].position;
    const Vec3& p1 = mesh.vertices()[triangle[1]].position;
    const Vec3& p2 = mesh.vertices()[triangle[2]].position;
    const Vec3 cross = (p1 - p0).cross(p2 - p0);
    const double doubledArea = cross.norm();
    if (!std::isfinite(doubledArea) || doubledArea <= 2.0 * epsilon) {
      throw MeshError("degenerate face reached operator assembly");
    }

    FaceGeometry geometry;
    geometry.area = 0.5 * doubledArea;
    geometry.unitNormal = cross / doubledArea;
    geometry.barycentricGradients[0] = geometry.unitNormal.cross(p2 - p1) / doubledArea;
    geometry.barycentricGradients[1] = geometry.unitNormal.cross(p0 - p2) / doubledArea;
    geometry.barycentricGradients[2] = geometry.unitNormal.cross(p1 - p0) / doubledArea;

    const std::array<Vec3, 3> fromCorner{p1 - p0, p2 - p1, p0 - p2};
    const std::array<Vec3, 3> toOther{p2 - p0, p0 - p1, p1 - p2};
    for (int local = 0; local < 3; ++local) {
      geometry.cotangents[static_cast<std::size_t>(local)] =
          fromCorner[static_cast<std::size_t>(local)].dot(
              toOther[static_cast<std::size_t>(local)]) /
          doubledArea;
      if (!std::isfinite(geometry.cotangents[static_cast<std::size_t>(local)])) {
        throw MeshError("non-finite cotangent weight");
      }
      if (geometry.cotangents[static_cast<std::size_t>(local)] < 0.0) {
        ++result.negativeCotangentContributions;
      }
      result.lumpedMass[static_cast<int>(triangle[static_cast<std::size_t>(local)])] +=
          geometry.area / 3.0;
    }

    // Each triangle contributes 0.5*cot(opposite angle) * (e_i-e_j)(e_i-e_j)^T.
    for (int opposite = 0; opposite < 3; ++opposite) {
      const int localI = (opposite + 1) % 3;
      const int localJ = (opposite + 2) % 3;
      const int i = static_cast<int>(triangle[static_cast<std::size_t>(localI)]);
      const int j = static_cast<int>(triangle[static_cast<std::size_t>(localJ)]);
      const double weight = 0.5 * geometry.cotangents[static_cast<std::size_t>(opposite)];
      triplets.emplace_back(i, i, weight);
      triplets.emplace_back(j, j, weight);
      triplets.emplace_back(i, j, -weight);
      triplets.emplace_back(j, i, -weight);
    }
    result.faceGeometry[face] = geometry;
  }

  for (int vertex = 0; vertex < vertexCount; ++vertex) {
    if (!(result.lumpedMass[vertex] > epsilon) || !std::isfinite(result.lumpedMass[vertex])) {
      throw MeshError("isolated vertex or non-positive lumped mass at vertex " +
                      std::to_string(vertex));
    }
  }

  result.laplacian.resize(vertexCount, vertexCount);
  result.laplacian.setFromTriplets(triplets.begin(), triplets.end(), std::plus<double>());
  result.laplacian.makeCompressed();
  result.meanEdgeLength = mesh.meanEdgeLength();
  result.suggestedTimeStep = timeScale * result.meanEdgeLength * result.meanEdgeLength;
  return result;
}

std::vector<Vec3> faceGradient(const TriangleMesh& mesh, const std::vector<FaceGeometry>& geometry,
                               const Vector& scalar) {
  if (scalar.size() != static_cast<Eigen::Index>(mesh.vertices().size()) ||
      geometry.size() != mesh.faces().size()) {
    throw std::invalid_argument("gradient input dimensions do not match the mesh");
  }
  std::vector<Vec3> result(mesh.faces().size(), Vec3::Zero());
  for (Index face = 0; face < mesh.faces().size(); ++face) {
    const Triangle& triangle = mesh.faces()[face].vertices;
    for (int local = 0; local < 3; ++local) {
      result[face] += scalar[static_cast<int>(triangle[static_cast<std::size_t>(local)])] *
                      geometry[face].barycentricGradients[static_cast<std::size_t>(local)];
    }
  }
  return result;
}

Vector gradientLoad(const TriangleMesh& mesh, const std::vector<FaceGeometry>& geometry,
                    const std::vector<Vec3>& field) {
  if (geometry.size() != mesh.faces().size() || field.size() != mesh.faces().size()) {
    throw std::invalid_argument("divergence input dimensions do not match the mesh");
  }
  Vector result = Vector::Zero(static_cast<Eigen::Index>(mesh.vertices().size()));
  for (Index face = 0; face < mesh.faces().size(); ++face) {
    const Triangle& triangle = mesh.faces()[face].vertices;
    for (int local = 0; local < 3; ++local) {
      result[static_cast<int>(triangle[static_cast<std::size_t>(local)])] +=
          geometry[face].area *
          geometry[face].barycentricGradients[static_cast<std::size_t>(local)].dot(field[face]);
    }
  }
  return result;
}

double relativeResidual(const SparseMatrix& matrix, const Vector& x, const Vector& rhs) {
  if (matrix.cols() != x.size() || matrix.rows() != rhs.size()) {
    throw std::invalid_argument("residual dimensions do not match");
  }
  const double denominator = std::max(rhs.norm(), 1e-30);
  return (matrix * x - rhs).norm() / denominator;
}

} // namespace geodesic
