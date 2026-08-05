#include "geodesic/dijkstra.hpp"
#include "geodesic/heat_method.hpp"
#include "geodesic/procedural.hpp"

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

using Clock = std::chrono::steady_clock;

int intArgument(int argc, char** argv, std::string_view name, int fallback) {
  for (int index = 1; index + 1 < argc; ++index) {
    if (argv[index] == name)
      return std::stoi(argv[index + 1]);
  }
  return fallback;
}

std::string stringArgument(int argc, char** argv, std::string_view name,
                           const std::string& fallback) {
  for (int index = 1; index + 1 < argc; ++index) {
    if (argv[index] == name)
      return argv[index + 1];
  }
  return fallback;
}

double elapsedMilliseconds(const Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

double mean(const std::vector<double>& values) {
  return std::accumulate(values.begin(), values.end(), 0.0) / static_cast<double>(values.size());
}

std::vector<geodesic::Index> distributedSources(std::size_t vertexCount, int count) {
  if (vertexCount < static_cast<std::size_t>(count)) {
    throw std::runtime_error("benchmark mesh has too few vertices for distinct sources");
  }
  std::vector<geodesic::Index> result;
  result.reserve(static_cast<std::size_t>(count));
  for (int sample = 0; sample < count; ++sample) {
    result.push_back(static_cast<geodesic::Index>(
        (static_cast<std::size_t>(sample) * vertexCount / static_cast<std::size_t>(count) +
         static_cast<std::size_t>(sample * 17)) %
        vertexCount));
  }
  std::vector<geodesic::Index> sorted = result;
  std::sort(sorted.begin(), sorted.end());
  if (std::adjacent_find(sorted.begin(), sorted.end()) != sorted.end()) {
    throw std::runtime_error("reused benchmark sources must be distinct");
  }
  return result;
}

geodesic::Index landmarkVertex(const geodesic::GeneratedCurvedWorld& world) {
  const geodesic::SurfacePoint& point = world.landmarks.source.point;
  const geodesic::Triangle& triangle = world.mesh.faces()[point.face].vertices;
  std::size_t local = 0;
  if (point.barycentric[1] > point.barycentric[local])
    local = 1;
  if (point.barycentric[2] > point.barycentric[local])
    local = 2;
  return triangle[local];
}

struct Record {
  int resolution{0};
  std::size_t vertices{0};
  std::size_t faces{0};
  double meshMilliseconds{0.0};
  double operatorAssemblyMilliseconds{0.0};
  double factorizationMilliseconds{0.0};
  double preprocessingMilliseconds{0.0};
  double oneHeatQueryMilliseconds{0.0};
  double meanReusedHeatQueryMilliseconds{0.0};
  double dijkstraQueryMilliseconds{0.0};
  double heatResidual{0.0};
  double poissonResidual{0.0};
};

} // namespace

int main(int argc, char** argv) {
  using namespace geodesic;
  try {
    const int minimumResolution = intArgument(argc, argv, "--min-resolution", 28);
    const int maximumResolution = intArgument(argc, argv, "--max-resolution", 112);
    const int repetitions = intArgument(argc, argv, "--repetitions", 7);
    constexpr int reusedSourceCount = 8;
    const std::filesystem::path output =
        stringArgument(argc, argv, "--json", "data/benchmarks.cpu.json");
    const std::string hostLabel = stringArgument(argc, argv, "--host", "unspecified local host");
    if (minimumResolution < 28 || maximumResolution < minimumResolution ||
        maximumResolution > 192 || repetitions < 1) {
      throw std::invalid_argument("invalid benchmark arguments");
    }

    std::vector<Record> records;
    for (int resolution = minimumResolution; resolution <= maximumResolution; resolution *= 2) {
      CurvedWorldOptions options;
      options.genus = 2;
      options.resolution = resolution;
      const auto meshStart = Clock::now();
      GeneratedCurvedWorld world = generateCurvedWorld(options);
      const double meshMilliseconds = elapsedMilliseconds(meshStart);
      HeatMethodSolver solver(world.mesh);
      const Index source = landmarkVertex(world);

      static_cast<void>(solver.compute(source));
      const auto oneQueryStart = Clock::now();
      HeatMethodResult measuredResult = solver.compute(source);
      const double oneHeatQueryMilliseconds = elapsedMilliseconds(oneQueryStart);

      std::vector<double> reusedQueryTimes;
      for (const Index reusedSource :
           distributedSources(world.mesh.vertices().size(), reusedSourceCount)) {
        const auto reusedStart = Clock::now();
        measuredResult = solver.compute(reusedSource);
        reusedQueryTimes.push_back(elapsedMilliseconds(reusedStart));
      }

      std::vector<double> dijkstraTimes;
      for (int repetition = 0; repetition < repetitions; ++repetition) {
        dijkstraTimes.push_back(edgeDijkstra(world.mesh, source).milliseconds);
      }

      records.push_back({resolution, world.mesh.vertices().size(), world.mesh.faces().size(),
                         meshMilliseconds, solver.operatorAssemblyMilliseconds(),
                         solver.factorizationMilliseconds(), solver.preprocessingMilliseconds(),
                         oneHeatQueryMilliseconds, mean(reusedQueryTimes), mean(dijkstraTimes),
                         measuredResult.heatReport.relativeResidual,
                         measuredResult.poissonReport.relativeResidual});
      const Record& record = records.back();
      std::cout << record.vertices << " vertices / " << record.faces << " faces: generate "
                << record.meshMilliseconds << " ms, assemble "
                << record.operatorAssemblyMilliseconds << " ms, factor "
                << record.factorizationMilliseconds << " ms, reused Heat Method query "
                << record.meanReusedHeatQueryMilliseconds << " ms, Dijkstra "
                << record.dijkstraQueryMilliseconds << " ms\n";
      if (resolution > maximumResolution / 2)
        break;
    }

    if (output.has_parent_path())
      std::filesystem::create_directories(output.parent_path());
    std::ofstream json(output);
    if (!json)
      throw std::runtime_error("could not open benchmark JSON output");
    json << std::setprecision(10) << "{\n  \"schema\": \"geodesic-benchmark-v3\",\n"
         << "  \"worldGenus\": 2,\n"
         << "  \"clock\": \"std::chrono::steady_clock\",\n"
         << "  \"precision\": \"float64\",\n"
         << "  \"host\": \"" << hostLabel << "\",\n"
         << "  \"compiler\": \"" << __VERSION__ << "\",\n"
         << "  \"buildType\": \"" << GEODESIC_BUILD_TYPE << "\",\n"
         << "  \"warmupQueries\": 1,\n"
         << "  \"reusedSourceCount\": " << reusedSourceCount << ",\n"
         << "  \"dijkstraRepetitions\": " << repetitions << ",\n"
         << "  \"cases\": [\n";
    for (std::size_t index = 0; index < records.size(); ++index) {
      const Record& record = records[index];
      json << "    {\"resolution\": " << record.resolution << ", \"vertices\": " << record.vertices
           << ", \"faces\": " << record.faces
           << ", \"meshMilliseconds\": " << record.meshMilliseconds
           << ", \"operatorAssemblyMilliseconds\": " << record.operatorAssemblyMilliseconds
           << ", \"factorizationMilliseconds\": " << record.factorizationMilliseconds
           << ", \"preprocessingMilliseconds\": " << record.preprocessingMilliseconds
           << ", \"oneHeatQueryMilliseconds\": " << record.oneHeatQueryMilliseconds
           << ", \"meanReusedHeatQueryMilliseconds\": " << record.meanReusedHeatQueryMilliseconds
           << ", \"dijkstraQueryMilliseconds\": " << record.dijkstraQueryMilliseconds
           << ", \"heatResidual\": " << record.heatResidual
           << ", \"poissonResidual\": " << record.poissonResidual << "}"
           << (index + 1U == records.size() ? "\n" : ",\n");
    }
    json << "  ]\n}\n";
    if (!json)
      throw std::runtime_error("failed while writing benchmark JSON");
    std::cout << "wrote " << output << '\n';
    return EXIT_SUCCESS;
  } catch (const std::exception& error) {
    std::cerr << "benchmark error: " << error.what() << '\n';
    return EXIT_FAILURE;
  }
}
