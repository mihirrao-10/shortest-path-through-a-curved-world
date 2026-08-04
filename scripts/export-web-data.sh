#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="${project_root}/build-native"

cmake -S "${project_root}" -B "${build_dir}" -DCMAKE_BUILD_TYPE=Release
cmake --build "${build_dir}" --parallel
"${build_dir}/geodesic_cli" export-web \
  --major-segments 160 \
  --minor-segments 64 \
  --major-radius 1.28 \
  --minor-radius 0.46 \
  --relief 0.18 \
  --seed 1592594996 \
  --output "${project_root}/web/public/data"
"${build_dir}/geodesic_benchmark" \
  --min-major-segments 20 \
  --max-major-segments 320 \
  --repetitions 7 \
  --host "${GEODESIC_BENCHMARK_HOST:-unspecified local host}" \
  --json "${project_root}/data/benchmarks.cpu.json"
cmake -E copy \
  "${project_root}/data/benchmarks.cpu.json" \
  "${project_root}/web/public/data/benchmarks.cpu.json"
