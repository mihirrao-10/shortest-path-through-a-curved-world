#pragma once

#include "geodesic/mesh.hpp"

#include <array>
#include <vector>

namespace geodesic {

struct FaceGeometry {
  double area{0.0};
  Vec3 unitNormal{Vec3::Zero()};
  std::array<Vec3, 3> barycentricGradients{};
  std::array<double, 3> cotangents{};
};

struct DiscreteOperators {
  // L is the symmetric positive-semidefinite stiffness matrix approximating -Delta.
  SparseMatrix laplacian;
  Vector lumpedMass;
  std::vector<FaceGeometry> faceGeometry;
  double meanEdgeLength{0.0};
  double suggestedTimeStep{0.0};
  std::size_t negativeCotangentContributions{0};
};

DiscreteOperators assembleOperators(const TriangleMesh& mesh, double timeScale = 1.0,
                                    double epsilon = 1e-14);

std::vector<Vec3> faceGradient(const TriangleMesh& mesh, const std::vector<FaceGeometry>& geometry,
                               const Vector& scalar);

// Returns b_i = integral grad(basis_i) dot field dA.  With L approximating
// -Delta, L * phi = b when field approximates grad(phi).
Vector gradientLoad(const TriangleMesh& mesh, const std::vector<FaceGeometry>& geometry,
                    const std::vector<Vec3>& field);

double relativeResidual(const SparseMatrix& matrix, const Vector& x, const Vector& rhs);

} // namespace geodesic
