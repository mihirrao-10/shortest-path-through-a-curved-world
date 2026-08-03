#include "geodesic/dijkstra.hpp"
#include "geodesic/heat_method.hpp"
#include "geodesic/procedural.hpp"

#ifdef GEODESIC_HAS_CUDA
#include "geodesic/cuda_solver.hpp"
#endif

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <numeric>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {

int intArgument(int argc, char** argv, std::string_view name, int fallback) {
  for (int i = 1; i + 1 < argc; ++i) {
    if (argv[i] == name) {
      return std::stoi(argv[i + 1]);
    }
  }
  return fallback;
}

std::string stringArgument(int argc, char** argv, std::string_view name,
                           const std::string& fallback) {
  for (int i = 1; i + 1 < argc; ++i) {
    if (argv[i] == name) {
      return argv[i + 1];
    }
  }
  return fallback;
}

bool hasFlag(int argc, char** argv, std::string_view name) {
  for (int i = 1; i < argc; ++i) {
    if (argv[i] == name) {
      return true;
    }
  }
  return false;
}

double mean(const std::vector<double>& values) {
  return std::accumulate(values.begin(), values.end(), 0.0) / static_cast<double>(values.size());
}

struct Record {
  int subdivisions{0};
  std::size_t vertices{0};
  std::size_t faces{0};
  double meshMilliseconds{0.0};
  double preprocessingMilliseconds{0.0};
  double queryMilliseconds{0.0};
  double dijkstraMilliseconds{0.0};
  double heatResidual{0.0};
  double poissonResidual{0.0};
};

} // namespace

int main(int argc, char** argv) {
  using namespace geodesic;
  try {
    const int minimum = intArgument(argc, argv, "--min-subdiv", 2);
    const int maximum = intArgument(argc, argv, "--max-subdiv", 5);
    const int repetitions = intArgument(argc, argv, "--repetitions", 5);
    const std::filesystem::path output =
        stringArgument(argc, argv, "--json", "data/benchmarks.cpu.json");
    const std::string hostLabel = stringArgument(argc, argv, "--host", "unspecified local host");
    if (minimum < 0 || maximum < minimum || maximum > 8 || repetitions < 1) {
      throw std::invalid_argument("invalid benchmark arguments");
    }

    std::vector<Record> records;
    for (int subdivision = minimum; subdivision <= maximum; ++subdivision) {
      const auto meshStart = std::chrono::steady_clock::now();
      TriangleMesh mesh = makeCurvedWorld(PlanetOptions{subdivision});
      const double meshMilliseconds =
          std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - meshStart)
              .count();
      HeatMethodSolver solver(mesh);
      const Index source = static_cast<Index>(mesh.vertices().size() / 3U);

      // One unmeasured query warms instruction/data caches.
      static_cast<void>(solver.compute(source));
      std::vector<double> queryTimes;
      std::vector<double> dijkstraTimes;
      HeatMethodResult finalResult;
      for (int repetition = 0; repetition < repetitions; ++repetition) {
        finalResult = solver.compute(source);
        queryTimes.push_back(finalResult.heatReport.milliseconds +
                             finalResult.poissonReport.milliseconds);
        dijkstraTimes.push_back(edgeDijkstra(mesh, source).milliseconds);
      }
      records.push_back(Record{
          subdivision, mesh.vertices().size(), mesh.faces().size(), meshMilliseconds,
          solver.preprocessingMilliseconds(), mean(queryTimes), mean(dijkstraTimes),
          finalResult.heatReport.relativeResidual, finalResult.poissonReport.relativeResidual});
      const Record& record = records.back();
      std::cout << record.vertices << " vertices / " << record.faces << " faces: preprocess "
                << record.preprocessingMilliseconds << " ms, Heat Method query "
                << record.queryMilliseconds << " ms, Dijkstra " << record.dijkstraMilliseconds
                << " ms\n";
    }

    if (output.has_parent_path()) {
      std::filesystem::create_directories(output.parent_path());
    }
    std::ofstream json(output);
    if (!json) {
      throw std::runtime_error("could not open benchmark JSON output");
    }
    json << std::setprecision(10) << "{\n  \"schema\": \"geodesic-benchmark-v1\",\n"
         << "  \"clock\": \"std::chrono::steady_clock\",\n"
         << "  \"precision\": \"float64\",\n"
         << "  \"host\": \"" << hostLabel << "\",\n"
         << "  \"compiler\": \"" << __VERSION__ << "\",\n"
         << "  \"buildType\": \"" << GEODESIC_BUILD_TYPE << "\",\n"
         << "  \"repetitions\": " << repetitions << ",\n"
         << "  \"warmupQueries\": 1,\n"
         << "  \"gpu\": {\"available\": false, \"measured\": false},\n"
         << "  \"cases\": [\n";
    for (std::size_t i = 0; i < records.size(); ++i) {
      const Record& record = records[i];
      json << "    {\"subdivisions\": " << record.subdivisions
           << ", \"vertices\": " << record.vertices << ", \"faces\": " << record.faces
           << ", \"meshMilliseconds\": " << record.meshMilliseconds
           << ", \"preprocessingMilliseconds\": " << record.preprocessingMilliseconds
           << ", \"queryMilliseconds\": " << record.queryMilliseconds
           << ", \"dijkstraMilliseconds\": " << record.dijkstraMilliseconds
           << ", \"heatResidual\": " << record.heatResidual
           << ", \"poissonResidual\": " << record.poissonResidual << "}"
           << (i + 1U == records.size() ? "\n" : ",\n");
    }
    json << "  ]\n}\n";
    if (!json) {
      throw std::runtime_error("failed while writing benchmark JSON");
    }

    if (hasFlag(argc, argv, "--gpu")) {
#ifdef GEODESIC_HAS_CUDA
      if (!cudaDeviceAvailable()) {
        std::cout << "GPU benchmark requested, but no CUDA device is available.\n";
      } else {
        std::cout << "CUDA device detected; solver agreement is covered by the CUDA test target.\n";
      }
#else
      std::cout << "GPU benchmark requested, but this is a CPU-only build.\n";
#endif
    }
    std::cout << "wrote " << output << '\n';
    return EXIT_SUCCESS;
  } catch (const std::exception& error) {
    std::cerr << "benchmark error: " << error.what() << '\n';
    return EXIT_FAILURE;
  }
}
