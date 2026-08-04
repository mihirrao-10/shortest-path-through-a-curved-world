cmake_minimum_required(VERSION 3.22)

project(shortest_path_through_a_curved_world
  VERSION 1.0.0
  DESCRIPTION "Heat-method geodesic distances on triangle meshes"
  LANGUAGES CXX)

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

if(GEODESIC_BUILD_TESTS)
  enable_testing()
  add_executable(geodesic_tests native/tests/test_main.cpp)
  target_link_libraries(geodesic_tests PRIVATE geodesic_core)
  add_test(NAME geodesic_tests COMMAND geodesic_tests)
  add_test(
    NAME focused_cpu_source_guard
    COMMAND ${CMAKE_COMMAND}
      -DGEODESIC_SOURCE_ROOT=${CMAKE_CURRENT_SOURCE_DIR}
      -P ${CMAKE_CURRENT_SOURCE_DIR}/scripts/validate-focused-cpu.cmake)
endif()

if(GEODESIC_BUILD_BENCHMARKS)
  add_executable(geodesic_benchmark native/benchmarks/benchmark_main.cpp)
  target_link_libraries(geodesic_benchmark PRIVATE geodesic_core)
  target_compile_definitions(geodesic_benchmark PRIVATE
    GEODESIC_BUILD_TYPE="${CMAKE_BUILD_TYPE}")
endif()

install(TARGETS geodesic_cli RUNTIME DESTINATION bin)
