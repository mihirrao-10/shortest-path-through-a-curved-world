#include "geodesic/cuda_solver.hpp"

#include <cublas_v2.h>
#include <cuda_runtime.h>
#include <cusparse.h>

#include <Eigen/SparseCore>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace geodesic {
namespace {

using Clock = std::chrono::steady_clock;

double elapsedMilliseconds(const Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

void checkCuda(cudaError_t status, const char* expression) {
  if (status != cudaSuccess) {
    throw std::runtime_error(std::string("CUDA failure in ") + expression + ": " +
                             cudaGetErrorString(status));
  }
}

void checkSparse(cusparseStatus_t status, const char* expression) {
  if (status != CUSPARSE_STATUS_SUCCESS) {
    throw std::runtime_error(std::string("cuSPARSE failure in ") + expression + " (status " +
                             std::to_string(static_cast<int>(status)) + ")");
  }
}

void checkBlas(cublasStatus_t status, const char* expression) {
  if (status != CUBLAS_STATUS_SUCCESS) {
    throw std::runtime_error(std::string("cuBLAS failure in ") + expression + " (status " +
                             std::to_string(static_cast<int>(status)) + ")");
  }
}

#define CUDA_CHECK(expression) checkCuda((expression), #expression)
#define CUSPARSE_CHECK(expression) checkSparse((expression), #expression)
#define CUBLAS_CHECK(expression) checkBlas((expression), #expression)

__global__ void setZeroKernel(double* values, int count) {
  const int index = blockIdx.x * blockDim.x + threadIdx.x;
  if (index < count) {
    values[index] = 0.0;
  }
}

__global__ void jacobiKernel(const double* inverseDiagonal, const double* residual,
                             double* preconditioned, int count) {
  const int index = blockIdx.x * blockDim.x + threadIdx.x;
  if (index < count) {
    preconditioned[index] = inverseDiagonal[index] * residual[index];
  }
}

__global__ void updateSolutionResidualKernel(double* solution, double* residual,
                                             const double* direction, const double* matrixDirection,
                                             double alpha, int count) {
  const int index = blockIdx.x * blockDim.x + threadIdx.x;
  if (index < count) {
    solution[index] += alpha * direction[index];
    residual[index] -= alpha * matrixDirection[index];
  }
}

__global__ void updateDirectionKernel(double* direction, const double* preconditioned, double beta,
                                      int count) {
  const int index = blockIdx.x * blockDim.x + threadIdx.x;
  if (index < count) {
    direction[index] = preconditioned[index] + beta * direction[index];
  }
}

int blockCount(int count) {
  constexpr int threads = 256;
  return (count + threads - 1) / threads;
}

} // namespace

struct CudaPcgSolver::Impl {
  CudaSolveOptions options;
  SparseMatrix hostMatrix;
  int dimension{0};
  int nonzeros{0};
  int* rowOffsets{nullptr};
  int* columnIndices{nullptr};
  double* values{nullptr};
  double* inverseDiagonal{nullptr};
  double* rhs{nullptr};
  double* solution{nullptr};
  double* residual{nullptr};
  double* preconditioned{nullptr};
  double* direction{nullptr};
  double* matrixDirection{nullptr};
  void* sparseBuffer{nullptr};
  std::size_t sparseBufferBytes{0};
  cusparseHandle_t sparseHandle{nullptr};
  cublasHandle_t blasHandle{nullptr};
  cusparseSpMatDescr_t matrixDescriptor{nullptr};
  cusparseDnVecDescr_t directionDescriptor{nullptr};
  cusparseDnVecDescr_t matrixDirectionDescriptor{nullptr};
  double preprocessingMs{0.0};

  explicit Impl(const SparseMatrix& matrix, CudaSolveOptions solveOptions)
      : options(solveOptions), hostMatrix(matrix) {
    if (matrix.rows() != matrix.cols() || matrix.rows() <= 0) {
      throw std::invalid_argument("CUDA PCG requires a non-empty square matrix");
    }
    if (!(options.tolerance > 0.0) || options.maxIterations <= 0) {
      throw std::invalid_argument("invalid CUDA PCG options");
    }
    if (!cudaDeviceAvailable()) {
      throw std::runtime_error("no CUDA device is available");
    }

    const auto start = Clock::now();
    Eigen::SparseMatrix<double, Eigen::RowMajor, int> rowMajor = matrix;
    rowMajor.makeCompressed();
    dimension = static_cast<int>(rowMajor.rows());
    nonzeros = static_cast<int>(rowMajor.nonZeros());
    std::vector<double> hostInverseDiagonal(static_cast<std::size_t>(dimension), 0.0);
    for (int row = 0; row < dimension; ++row) {
      const double diagonal = rowMajor.coeff(row, row);
      if (!(diagonal > 0.0) || !std::isfinite(diagonal)) {
        throw std::invalid_argument("CUDA PCG Jacobi preconditioner requires a positive diagonal");
      }
      hostInverseDiagonal[static_cast<std::size_t>(row)] = 1.0 / diagonal;
    }

    CUDA_CHECK(cudaMalloc(reinterpret_cast<void**>(&rowOffsets),
                          static_cast<std::size_t>(dimension + 1) * sizeof(int)));
    CUDA_CHECK(cudaMalloc(reinterpret_cast<void**>(&columnIndices),
                          static_cast<std::size_t>(nonzeros) * sizeof(int)));
    CUDA_CHECK(cudaMalloc(reinterpret_cast<void**>(&values),
                          static_cast<std::size_t>(nonzeros) * sizeof(double)));
    CUDA_CHECK(cudaMalloc(reinterpret_cast<void**>(&inverseDiagonal),
                          static_cast<std::size_t>(dimension) * sizeof(double)));
    CUDA_CHECK(cudaMalloc(reinterpret_cast<void**>(&rhs),
                          static_cast<std::size_t>(dimension) * sizeof(double)));
    CUDA_CHECK(cudaMalloc(reinterpret_cast<void**>(&solution),
                          static_cast<std::size_t>(dimension) * sizeof(double)));
    CUDA_CHECK(cudaMalloc(reinterpret_cast<void**>(&residual),
                          static_cast<std::size_t>(dimension) * sizeof(double)));
    CUDA_CHECK(cudaMalloc(reinterpret_cast<void**>(&preconditioned),
                          static_cast<std::size_t>(dimension) * sizeof(double)));
    CUDA_CHECK(cudaMalloc(reinterpret_cast<void**>(&direction),
                          static_cast<std::size_t>(dimension) * sizeof(double)));
    CUDA_CHECK(cudaMalloc(reinterpret_cast<void**>(&matrixDirection),
                          static_cast<std::size_t>(dimension) * sizeof(double)));
    CUDA_CHECK(cudaMemcpy(rowOffsets, rowMajor.outerIndexPtr(),
                          static_cast<std::size_t>(dimension + 1) * sizeof(int),
                          cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(columnIndices, rowMajor.innerIndexPtr(),
                          static_cast<std::size_t>(nonzeros) * sizeof(int),
                          cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(values, rowMajor.valuePtr(),
                          static_cast<std::size_t>(nonzeros) * sizeof(double),
                          cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(inverseDiagonal, hostInverseDiagonal.data(),
                          static_cast<std::size_t>(dimension) * sizeof(double),
                          cudaMemcpyHostToDevice));

    CUSPARSE_CHECK(cusparseCreate(&sparseHandle));
    CUBLAS_CHECK(cublasCreate(&blasHandle));
    CUSPARSE_CHECK(cusparseCreateCsr(&matrixDescriptor, dimension, dimension, nonzeros, rowOffsets,
                                     columnIndices, values, CUSPARSE_INDEX_32I, CUSPARSE_INDEX_32I,
                                     CUSPARSE_INDEX_BASE_ZERO, CUDA_R_64F));
    CUSPARSE_CHECK(cusparseCreateDnVec(&directionDescriptor, dimension, direction, CUDA_R_64F));
    CUSPARSE_CHECK(
        cusparseCreateDnVec(&matrixDirectionDescriptor, dimension, matrixDirection, CUDA_R_64F));
    const double one = 1.0;
    const double zero = 0.0;
    CUSPARSE_CHECK(cusparseSpMV_bufferSize(sparseHandle, CUSPARSE_OPERATION_NON_TRANSPOSE, &one,
                                           matrixDescriptor, directionDescriptor, &zero,
                                           matrixDirectionDescriptor, CUDA_R_64F,
                                           CUSPARSE_SPMV_ALG_DEFAULT, &sparseBufferBytes));
    CUDA_CHECK(cudaMalloc(&sparseBuffer, sparseBufferBytes));
    CUDA_CHECK(cudaDeviceSynchronize());
    preprocessingMs = elapsedMilliseconds(start);
  }

  ~Impl() {
    if (directionDescriptor != nullptr) {
      cusparseDestroyDnVec(directionDescriptor);
    }
    if (matrixDirectionDescriptor != nullptr) {
      cusparseDestroyDnVec(matrixDirectionDescriptor);
    }
    if (matrixDescriptor != nullptr) {
      cusparseDestroySpMat(matrixDescriptor);
    }
    if (sparseHandle != nullptr) {
      cusparseDestroy(sparseHandle);
    }
    if (blasHandle != nullptr) {
      cublasDestroy(blasHandle);
    }
    cudaFree(sparseBuffer);
    cudaFree(matrixDirection);
    cudaFree(direction);
    cudaFree(preconditioned);
    cudaFree(residual);
    cudaFree(solution);
    cudaFree(rhs);
    cudaFree(inverseDiagonal);
    cudaFree(values);
    cudaFree(columnIndices);
    cudaFree(rowOffsets);
  }

  void multiply() {
    const double one = 1.0;
    const double zero = 0.0;
    CUSPARSE_CHECK(cusparseSpMV(
        sparseHandle, CUSPARSE_OPERATION_NON_TRANSPOSE, &one, matrixDescriptor, directionDescriptor,
        &zero, matrixDirectionDescriptor, CUDA_R_64F, CUSPARSE_SPMV_ALG_DEFAULT, sparseBuffer));
  }
};

bool cudaDeviceAvailable() noexcept {
  int count = 0;
  const cudaError_t status = cudaGetDeviceCount(&count);
  if (status != cudaSuccess) {
    cudaGetLastError();
    return false;
  }
  return count > 0;
}

CudaPcgSolver::CudaPcgSolver(const SparseMatrix& matrix, CudaSolveOptions options)
    : impl_(std::make_unique<Impl>(matrix, options)) {}

CudaPcgSolver::~CudaPcgSolver() = default;
CudaPcgSolver::CudaPcgSolver(CudaPcgSolver&&) noexcept = default;
CudaPcgSolver& CudaPcgSolver::operator=(CudaPcgSolver&&) noexcept = default;

CudaSolveResult CudaPcgSolver::solve(const Vector& hostRhs) {
  if (hostRhs.size() != impl_->dimension || !hostRhs.allFinite()) {
    throw std::invalid_argument("CUDA PCG right-hand side has invalid dimensions or values");
  }
  constexpr int threads = 256;
  CudaSolveResult result;
  result.solution.resize(impl_->dimension);

  auto transferStart = Clock::now();
  CUDA_CHECK(cudaMemcpy(impl_->rhs, hostRhs.data(),
                        static_cast<std::size_t>(impl_->dimension) * sizeof(double),
                        cudaMemcpyHostToDevice));
  CUDA_CHECK(cudaDeviceSynchronize());
  result.transferMilliseconds += elapsedMilliseconds(transferStart);

  const auto kernelStart = Clock::now();
  setZeroKernel<<<blockCount(impl_->dimension), threads>>>(impl_->solution, impl_->dimension);
  CUDA_CHECK(cudaMemcpy(impl_->residual, impl_->rhs,
                        static_cast<std::size_t>(impl_->dimension) * sizeof(double),
                        cudaMemcpyDeviceToDevice));
  jacobiKernel<<<blockCount(impl_->dimension), threads>>>(impl_->inverseDiagonal, impl_->residual,
                                                          impl_->preconditioned, impl_->dimension);
  CUDA_CHECK(cudaMemcpy(impl_->direction, impl_->preconditioned,
                        static_cast<std::size_t>(impl_->dimension) * sizeof(double),
                        cudaMemcpyDeviceToDevice));
  CUDA_CHECK(cudaGetLastError());

  if (impl_->options.warmup) {
    impl_->multiply();
    CUDA_CHECK(cudaDeviceSynchronize());
  }

  double rhsNorm = 0.0;
  CUBLAS_CHECK(cublasDnrm2(impl_->blasHandle, impl_->dimension, impl_->rhs, 1, &rhsNorm));
  const double absoluteTolerance = impl_->options.tolerance * std::max(rhsNorm, 1.0);
  double rho = 0.0;
  CUBLAS_CHECK(cublasDdot(impl_->blasHandle, impl_->dimension, impl_->residual, 1,
                          impl_->preconditioned, 1, &rho));
  double residualNorm = rhsNorm;
  int iteration = 0;
  bool converged = residualNorm <= absoluteTolerance;

  for (; iteration < impl_->options.maxIterations && !converged; ++iteration) {
    impl_->multiply();
    double denominator = 0.0;
    CUBLAS_CHECK(cublasDdot(impl_->blasHandle, impl_->dimension, impl_->direction, 1,
                            impl_->matrixDirection, 1, &denominator));
    if (!(denominator > 0.0) || !std::isfinite(denominator) || !std::isfinite(rho)) {
      break;
    }
    const double alpha = rho / denominator;
    updateSolutionResidualKernel<<<blockCount(impl_->dimension), threads>>>(
        impl_->solution, impl_->residual, impl_->direction, impl_->matrixDirection, alpha,
        impl_->dimension);
    CUBLAS_CHECK(
        cublasDnrm2(impl_->blasHandle, impl_->dimension, impl_->residual, 1, &residualNorm));
    converged = residualNorm <= absoluteTolerance;
    if (converged) {
      ++iteration;
      break;
    }
    jacobiKernel<<<blockCount(impl_->dimension), threads>>>(
        impl_->inverseDiagonal, impl_->residual, impl_->preconditioned, impl_->dimension);
    double nextRho = 0.0;
    CUBLAS_CHECK(cublasDdot(impl_->blasHandle, impl_->dimension, impl_->residual, 1,
                            impl_->preconditioned, 1, &nextRho));
    if (!std::isfinite(nextRho) || std::abs(rho) <= 1e-300) {
      break;
    }
    const double beta = nextRho / rho;
    updateDirectionKernel<<<blockCount(impl_->dimension), threads>>>(
        impl_->direction, impl_->preconditioned, beta, impl_->dimension);
    rho = nextRho;
    CUDA_CHECK(cudaGetLastError());
  }
  CUDA_CHECK(cudaDeviceSynchronize());
  result.kernelMilliseconds = elapsedMilliseconds(kernelStart);

  transferStart = Clock::now();
  CUDA_CHECK(cudaMemcpy(result.solution.data(), impl_->solution,
                        static_cast<std::size_t>(impl_->dimension) * sizeof(double),
                        cudaMemcpyDeviceToHost));
  result.transferMilliseconds += elapsedMilliseconds(transferStart);
  result.report.relativeResidual = relativeResidual(impl_->hostMatrix, result.solution, hostRhs);
  result.report.converged =
      converged && result.report.relativeResidual <= impl_->options.tolerance * 20.0;
  result.report.iterations = iteration;
  result.report.milliseconds = result.kernelMilliseconds;
  result.report.method = "CUDA double PCG + Jacobi (cuSPARSE SpMV)";
  return result;
}

std::vector<CudaSolveResult>
CudaPcgSolver::solveBatched(const std::vector<Vector>& rightHandSides) {
  std::vector<CudaSolveResult> results;
  results.reserve(rightHandSides.size());
  for (const Vector& rhsValue : rightHandSides) {
    results.push_back(solve(rhsValue));
  }
  return results;
}

double CudaPcgSolver::preprocessingMilliseconds() const noexcept {
  return impl_->preprocessingMs;
}

} // namespace geodesic
