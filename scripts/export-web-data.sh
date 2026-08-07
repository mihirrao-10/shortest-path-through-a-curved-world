#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="${project_root}/build-native"
worlds_dir="${project_root}/web/public/data/worlds"

cmake_args=(-S "${project_root}" -B "${build_dir}" -DCMAKE_BUILD_TYPE=Release)
if [[ ! -f "${build_dir}/CMakeCache.txt" ]] && command -v ninja >/dev/null 2>&1; then
  cmake_args+=(-G Ninja)
fi
cmake "${cmake_args[@]}"
cmake --build "${build_dir}" --parallel
ctest --test-dir "${build_dir}" --output-on-failure
cmake -E remove_directory "${worlds_dir}"
"${build_dir}/geodesic_cli" export-web \
  --all \
  --resolution 64 \
  --tube-radius 0.30 \
  --relief 0.16 \
  --seed 1592594996 \
  --output "${worlds_dir}"
"${build_dir}/geodesic_benchmark" \
  --min-resolution 28 \
  --max-resolution 112 \
  --repetitions 7 \
  --host "${GEODESIC_BENCHMARK_HOST:-unspecified local host}" \
  --json "${project_root}/data/benchmarks.cpu.json"
cmake -E copy \
  "${project_root}/data/benchmarks.cpu.json" \
  "${project_root}/web/public/data/benchmarks.cpu.json"
