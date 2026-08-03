#include "geodesic/cuda_solver.hpp"

#include <cuda_runtime.h>

#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

namespace geodesic {
namespace {

using Clock = std::chrono::steady_clock;

double elapsedMilliseconds(const Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

void cudaCheck(cudaError_t status, const char* expression) {
  if (status != cudaSuccess) {
    throw std::runtime_error(std::string("CUDA geometry failure in ") + expression + ": " +
                             cudaGetErrorString(status));
  }
}

#define CUDA_GEOMETRY_CHECK(expression) cudaCheck((expression), #expression)

__global__ void faceGeometryKernel(const double* positions, const std::uint32_t* indices,
                                   double* normals, double* areas, int faceCount) {
  const int face = blockIdx.x * blockDim.x + threadIdx.x;
  if (face >= faceCount) {
    return;
  }
  const std::uint32_t i0 = indices[3 * face];
  const std::uint32_t i1 = indices[3 * face + 1];
  const std::uint32_t i2 = indices[3 * face + 2];
  const double ax = positions[3 * i1] - positions[3 * i0];
  const double ay = positions[3 * i1 + 1] - positions[3 * i0 + 1];
  const double az = positions[3 * i1 + 2] - positions[3 * i0 + 2];
  const double bx = positions[3 * i2] - positions[3 * i0];
  const double by = positions[3 * i2 + 1] - positions[3 * i0 + 1];
  const double bz = positions[3 * i2 + 2] - positions[3 * i0 + 2];
  const double nx = ay * bz - az * by;
  const double ny = az * bx - ax * bz;
  const double nz = ax * by - ay * bx;
  const double norm = sqrt(nx * nx + ny * ny + nz * nz);
  areas[face] = 0.5 * norm;
  if (norm > 1e-30) {
    normals[3 * face] = nx / norm;
    normals[3 * face + 1] = ny / norm;
    normals[3 * face + 2] = nz / norm;
  } else {
    normals[3 * face] = 0.0;
    normals[3 * face + 1] = 0.0;
    normals[3 * face + 2] = 0.0;
  }
}

__global__ void normalizeNegativeKernel(const double* input, double* output, int count,
                                        double epsilon) {
  const int index = blockIdx.x * blockDim.x + threadIdx.x;
  if (index >= count) {
    return;
  }
  const double x = input[3 * index];
  const double y = input[3 * index + 1];
  const double z = input[3 * index + 2];
  const double norm = sqrt(x * x + y * y + z * z);
  if (norm > epsilon) {
    output[3 * index] = -x / norm;
    output[3 * index + 1] = -y / norm;
    output[3 * index + 2] = -z / norm;
  } else {
    output[3 * index] = 0.0;
    output[3 * index + 1] = 0.0;
    output[3 * index + 2] = 0.0;
  }
}

int blocks(int count) {
  return (count + 255) / 256;
}

} // namespace

CudaFaceGeometryResult cudaComputeFaceGeometry(const TriangleMesh& mesh) {
  if (!cudaDeviceAvailable()) {
    throw std::runtime_error("no CUDA device is available");
  }
  const int vertexCount = static_cast<int>(mesh.vertices().size());
  const int faceCount = static_cast<int>(mesh.faces().size());
  std::vector<double> positions(static_cast<std::size_t>(vertexCount) * 3U);
  std::vector<std::uint32_t> indices(static_cast<std::size_t>(faceCount) * 3U);
  for (int vertex = 0; vertex < vertexCount; ++vertex) {
    for (int axis = 0; axis < 3; ++axis) {
      positions[static_cast<std::size_t>(3 * vertex + axis)] =
          mesh.vertices()[static_cast<std::size_t>(vertex)].position[axis];
    }
  }
  for (int face = 0; face < faceCount; ++face) {
    for (int local = 0; local < 3; ++local) {
      indices[static_cast<std::size_t>(3 * face + local)] =
          mesh.faces()[static_cast<std::size_t>(face)].vertices[static_cast<std::size_t>(local)];
    }
  }

  double* devicePositions = nullptr;
  std::uint32_t* deviceIndices = nullptr;
  double* deviceNormals = nullptr;
  double* deviceAreas = nullptr;
  CUDA_GEOMETRY_CHECK(
      cudaMalloc(reinterpret_cast<void**>(&devicePositions), positions.size() * sizeof(double)));
  CUDA_GEOMETRY_CHECK(
      cudaMalloc(reinterpret_cast<void**>(&deviceIndices), indices.size() * sizeof(std::uint32_t)));
  CUDA_GEOMETRY_CHECK(cudaMalloc(reinterpret_cast<void**>(&deviceNormals),
                                 static_cast<std::size_t>(faceCount) * 3U * sizeof(double)));
  CUDA_GEOMETRY_CHECK(cudaMalloc(reinterpret_cast<void**>(&deviceAreas),
                                 static_cast<std::size_t>(faceCount) * sizeof(double)));

  CudaFaceGeometryResult result;
  result.normals.resize(static_cast<std::size_t>(faceCount));
  result.areas.resize(static_cast<std::size_t>(faceCount));
  std::vector<double> normals(static_cast<std::size_t>(faceCount) * 3U);
  auto start = Clock::now();
  CUDA_GEOMETRY_CHECK(cudaMemcpy(devicePositions, positions.data(),
                                 positions.size() * sizeof(double), cudaMemcpyHostToDevice));
  CUDA_GEOMETRY_CHECK(cudaMemcpy(deviceIndices, indices.data(),
                                 indices.size() * sizeof(std::uint32_t), cudaMemcpyHostToDevice));
  CUDA_GEOMETRY_CHECK(cudaDeviceSynchronize());
  result.transferMilliseconds = elapsedMilliseconds(start);

  start = Clock::now();
  faceGeometryKernel<<<blocks(faceCount), 256>>>(devicePositions, deviceIndices, deviceNormals,
                                                 deviceAreas, faceCount);
  CUDA_GEOMETRY_CHECK(cudaGetLastError());
  CUDA_GEOMETRY_CHECK(cudaDeviceSynchronize());
  result.kernelMilliseconds = elapsedMilliseconds(start);

  start = Clock::now();
  CUDA_GEOMETRY_CHECK(cudaMemcpy(normals.data(), deviceNormals, normals.size() * sizeof(double),
                                 cudaMemcpyDeviceToHost));
  CUDA_GEOMETRY_CHECK(cudaMemcpy(result.areas.data(), deviceAreas,
                                 result.areas.size() * sizeof(double), cudaMemcpyDeviceToHost));
  result.transferMilliseconds += elapsedMilliseconds(start);
  for (int face = 0; face < faceCount; ++face) {
    result.normals[static_cast<std::size_t>(face)] =
        Vec3(normals[static_cast<std::size_t>(3 * face)],
             normals[static_cast<std::size_t>(3 * face + 1)],
             normals[static_cast<std::size_t>(3 * face + 2)]);
  }
  cudaFree(deviceAreas);
  cudaFree(deviceNormals);
  cudaFree(deviceIndices);
  cudaFree(devicePositions);
  return result;
}

std::vector<Vec3> cudaNormalizeNegative(const std::vector<Vec3>& vectors, double epsilon) {
  if (!cudaDeviceAvailable()) {
    throw std::runtime_error("no CUDA device is available");
  }
  if (!(epsilon > 0.0) || !std::isfinite(epsilon)) {
    throw std::invalid_argument("normalization epsilon must be positive and finite");
  }
  std::vector<double> input(vectors.size() * 3U);
  std::vector<double> output(vectors.size() * 3U);
  for (std::size_t i = 0; i < vectors.size(); ++i) {
    input[3U * i] = vectors[i].x();
    input[3U * i + 1U] = vectors[i].y();
    input[3U * i + 2U] = vectors[i].z();
  }
  double* deviceInput = nullptr;
  double* deviceOutput = nullptr;
  CUDA_GEOMETRY_CHECK(
      cudaMalloc(reinterpret_cast<void**>(&deviceInput), input.size() * sizeof(double)));
  CUDA_GEOMETRY_CHECK(
      cudaMalloc(reinterpret_cast<void**>(&deviceOutput), output.size() * sizeof(double)));
  CUDA_GEOMETRY_CHECK(
      cudaMemcpy(deviceInput, input.data(), input.size() * sizeof(double), cudaMemcpyHostToDevice));
  normalizeNegativeKernel<<<blocks(static_cast<int>(vectors.size())), 256>>>(
      deviceInput, deviceOutput, static_cast<int>(vectors.size()), epsilon);
  CUDA_GEOMETRY_CHECK(cudaGetLastError());
  CUDA_GEOMETRY_CHECK(cudaMemcpy(output.data(), deviceOutput, output.size() * sizeof(double),
                                 cudaMemcpyDeviceToHost));
  cudaFree(deviceOutput);
  cudaFree(deviceInput);
  std::vector<Vec3> result(vectors.size());
  for (std::size_t i = 0; i < vectors.size(); ++i) {
    result[i] = Vec3(output[3U * i], output[3U * i + 1U], output[3U * i + 2U]);
  }
  return result;
}

} // namespace geodesic
