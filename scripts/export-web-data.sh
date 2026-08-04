#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="${project_root}/build-native"

cmake -S "${project_root}" -B "${build_dir}" -DCMAKE_BUILD_TYPE=Release
cmake --build "${build_dir}" --parallel
"${build_dir}/geodesic_cli" export-web --detail 5 --output "${project_root}/web/public/data"
"${build_dir}/geodesic_benchmark" \
  --min-detail 2 \
  --max-detail 6 \
  --repetitions 7 \
  --host "${GEODESIC_BENCHMARK_HOST:-unspecified local host}" \
  --json "${project_root}/data/benchmarks.json"
cmake -E copy \
  "${project_root}/data/benchmarks.json" \
  "${project_root}/web/public/data/benchmarks.json"
