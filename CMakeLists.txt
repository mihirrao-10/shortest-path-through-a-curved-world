cmake_minimum_required(VERSION 3.22)

project(shortest_path_through_a_curved_world
  VERSION 1.0.0
  DESCRIPTION "Heat-method geodesic distances on triangle meshes"
  LANGUAGES CXX)

option(GEODESIC_ENABLE_CUDA "Build the optional CUDA PCG backend" OFF)
option(GEODESIC_BUILD_TESTS "Build native correctness tests" ON)
option(GEODESIC_BUILD_BENCHMARKS "Build native benchmarks" ON)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

include(FetchContent)
find_package(Eigen3 3.4 QUIET NO_MODULE)
if(NOT Eigen3_FOUND)
  message(STATUS "Eigen3 was not found locally; fetching the pinned 3.4.0 release")
  set(EIGEN_BUILD_DOC OFF CACHE BOOL "" FORCE)
  set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
  FetchContent_Declare(
    eigen
    URL https://gitlab.com/libeigen/eigen/-/archive/3.4.0/eigen-3.4.0.tar.gz
    URL_HASH SHA256=8586084f71f9bde545ee7fa6d00288b264a2b7ac3607b974e54d13e7162c1c72
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
  FetchContent_MakeAvailable(eigen)
endif()

add_library(geodesic_core
  native/src/mesh.cpp
  native/src/operators.cpp
  native/src/heat_method.cpp
  native/src/dijkstra.cpp
  native/src/path.cpp
  native/src/procedural.cpp
  native/src/io.cpp)

target_include_directories(geodesic_core PUBLIC native/include)
target_link_libraries(geodesic_core PUBLIC Eigen3::Eigen)
target_compile_features(geodesic_core PUBLIC cxx_std_20)

if(MSVC)
  target_compile_options(geodesic_core PRIVATE /W4 /permissive-)
else()
  target_compile_options(geodesic_core PRIVATE -Wall -Wextra -Wpedantic)
endif()

add_executable(geodesic_cli native/src/cli.cpp)
target_link_libraries(geodesic_cli PRIVATE geodesic_core)

if(GEODESIC_ENABLE_CUDA)
  include(CheckLanguage)
  check_language(CUDA)
  if(NOT CMAKE_CUDA_COMPILER)
    message(FATAL_ERROR "GEODESIC_ENABLE_CUDA=ON, but no CUDA compiler was found")
  endif()
  enable_language(CUDA)
  find_package(CUDAToolkit REQUIRED)

  add_library(geodesic_cuda
    native/cuda/cuda_solver.cu
    native/cuda/geometry_kernels.cu)
  target_include_directories(geodesic_cuda PUBLIC native/include)
  target_link_libraries(geodesic_cuda PUBLIC geodesic_core CUDA::cudart CUDA::cusparse CUDA::cublas)
  target_compile_definitions(geodesic_cuda PUBLIC GEODESIC_HAS_CUDA=1)
  set_target_properties(geodesic_cuda PROPERTIES
    CUDA_STANDARD 17
    CUDA_STANDARD_REQUIRED ON
    CUDA_ARCHITECTURES "70;75;80;86;89;90"
    POSITION_INDEPENDENT_CODE ON)
  target_link_libraries(geodesic_cli PRIVATE geodesic_cuda)
  target_compile_definitions(geodesic_cli PRIVATE GEODESIC_HAS_CUDA=1)
endif()

if(GEODESIC_BUILD_TESTS)
  enable_testing()
  add_executable(geodesic_tests native/tests/test_main.cpp)
  target_link_libraries(geodesic_tests PRIVATE geodesic_core)
  if(GEODESIC_ENABLE_CUDA)
    target_link_libraries(geodesic_tests PRIVATE geodesic_cuda)
    target_compile_definitions(geodesic_tests PRIVATE GEODESIC_HAS_CUDA=1)
  endif()
  add_test(NAME geodesic_tests COMMAND geodesic_tests)
endif()

if(GEODESIC_BUILD_BENCHMARKS)
  add_executable(geodesic_benchmark native/benchmarks/benchmark_main.cpp)
  target_link_libraries(geodesic_benchmark PRIVATE geodesic_core)
  target_compile_definitions(geodesic_benchmark PRIVATE
    GEODESIC_BUILD_TYPE="${CMAKE_BUILD_TYPE}")
  if(GEODESIC_ENABLE_CUDA)
    target_link_libraries(geodesic_benchmark PRIVATE geodesic_cuda)
    target_compile_definitions(geodesic_benchmark PRIVATE GEODESIC_HAS_CUDA=1)
  endif()
endif()

install(TARGETS geodesic_cli RUNTIME DESTINATION bin)
