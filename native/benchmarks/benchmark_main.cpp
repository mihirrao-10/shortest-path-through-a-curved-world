#include "geodesic/dijkstra.hpp"
#include "geodesic/heat_method.hpp"
#include "geodesic/procedural.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <numeric>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {

using Clock = std::chrono::steady_clock;

int intArgument(int argc, char** argv, std::string_view name, int fallback) {
  for (int index = 1; index + 1 < argc; ++index) {
    if (argv[index] == name) {
      return std::stoi(argv[index + 1]);
    }
  }
  return fallback;
}

std::string stringArgument(int argc, char** argv, std::string_view name,
                           const std::string& fallback) {
  for (int index = 1; index + 1 < argc; ++index) {
    if (argv[index] == name) {
      return argv[index + 1];
    }
  }
  return fallback;
}

double elapsedMilliseconds(const Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

double mean(const std::vector<double>& values) {
  return std::accumulate(values.begin(), values.end(), 0.0) / static_cast<double>(values.size());
}

std::vector<geodesic::Index> distributedSources(const geodesic::TriangleMesh& mesh, int count) {
  std::vector<geodesic::Index> result;
  result.reserve(static_cast<std::size_t>(count));
  const double twoPi = 2.0 * std::acos(-1.0);
  for (int sample = 0; sample < count; ++sample) {
    const double angle = twoPi * static_cast<double>(sample) / static_cast<double>(count);
    const geodesic::Vec3 direction(std::cos(angle), std::sin(angle), 0.0);
    geodesic::Index best = 0;
    double bestScore = -std::numeric_limits<double>::infinity();
    for (geodesic::Index vertex = 0; vertex < mesh.vertices().size(); ++vertex) {
      const geodesic::Vec3& position = mesh.vertices()[vertex].position;
      const double radial = std::hypot(position.x(), position.y());
      const double score = position.dot(direction) + 0.12 * radial - 0.04 * std::abs(position.z());
      if (score > bestScore) {
        bestScore = score;
        best = vertex;
      }
    }
    result.push_back(best);
  }
  std::vector<geodesic::Index> sorted = result;
  std::sort(sorted.begin(), sorted.end());
  if (std::adjacent_find(sorted.begin(), sorted.end()) != sorted.end()) {
    throw std::runtime_error("reused benchmark sources must be distinct");
  }
  return result;
}

struct Record {
  int detailLevel{0};
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
    const int minimum = intArgument(argc, argv, "--min-detail", 2);
    const int maximum = intArgument(argc, argv, "--max-detail", 5);
    const int repetitions = intArgument(argc, argv, "--repetitions", 5);
    constexpr int reusedSourceCount = 8;
    const std::filesystem::path output =
        stringArgument(argc, argv, "--json", "data/benchmarks.json");
    const std::string hostLabel = stringArgument(argc, argv, "--host", "unspecified local host");
    if (minimum < 1 || maximum < minimum || maximum > 8 || repetitions < 1) {
      throw std::invalid_argument("invalid benchmark arguments");
    }

    std::vector<Record> records;
    for (int detailLevel = minimum; detailLevel <= maximum; ++detailLevel) {
      const auto meshStart = Clock::now();
      TriangleMesh mesh = makeCurvedWorld(CurvedWorldOptions{detailLevel});
      const double meshMilliseconds = elapsedMilliseconds(meshStart);
      HeatMethodSolver solver(mesh);
      const Index source = selectCurvedWorldLandmarks(mesh).source;

      static_cast<void>(solver.compute(source));

      const auto oneQueryStart = Clock::now();
      HeatMethodResult measuredResult = solver.compute(source);
      const double oneHeatQueryMilliseconds = elapsedMilliseconds(oneQueryStart);

      std::vector<double> reusedQueryTimes;
      for (const Index reusedSource : distributedSources(mesh, reusedSourceCount)) {
        const auto reusedStart = Clock::now();
        measuredResult = solver.compute(reusedSource);
        reusedQueryTimes.push_back(elapsedMilliseconds(reusedStart));
      }

      std::vector<double> dijkstraTimes;
      dijkstraTimes.reserve(static_cast<std::size_t>(repetitions));
      for (int repetition = 0; repetition < repetitions; ++repetition) {
        dijkstraTimes.push_back(edgeDijkstra(mesh, source).milliseconds);
      }

      records.push_back(Record{
          detailLevel, mesh.vertices().size(), mesh.faces().size(), meshMilliseconds,
          solver.operatorAssemblyMilliseconds(), solver.factorizationMilliseconds(),
          solver.preprocessingMilliseconds(), oneHeatQueryMilliseconds, mean(reusedQueryTimes),
          mean(dijkstraTimes), measuredResult.heatReport.relativeResidual,
          measuredResult.poissonReport.relativeResidual});
      const Record& record = records.back();
      std::cout << record.vertices << " vertices / " << record.faces << " faces: assemble "
                << record.operatorAssemblyMilliseconds << " ms, factor "
                << record.factorizationMilliseconds << " ms, one Heat Method query "
                << record.oneHeatQueryMilliseconds << " ms, reused query mean "
                << record.meanReusedHeatQueryMilliseconds << " ms, Dijkstra "
                << record.dijkstraQueryMilliseconds << " ms\n";
    }

    if (output.has_parent_path()) {
      std::filesystem::create_directories(output.parent_path());
    }
    std::ofstream json(output);
    if (!json) {
      throw std::runtime_error("could not open benchmark JSON output");
    }
    json << std::setprecision(10) << "{\n  \"schema\": \"geodesic-benchmark-v2\",\n"
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
      json << "    {\"detailLevel\": " << record.detailLevel
           << ", \"vertices\": " << record.vertices << ", \"faces\": " << record.faces
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
    if (!json) {
      throw std::runtime_error("failed while writing benchmark JSON");
    }
    std::cout << "wrote " << output << '\n';
    return EXIT_SUCCESS;
  } catch (const std::exception& error) {
    std::cerr << "benchmark error: " << error.what() << '\n';
    return EXIT_FAILURE;
  }
}
