#include "geodesic/io.hpp"
#include "geodesic/procedural.hpp"

#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>

namespace {

std::string argumentValue(int argc, char** argv, std::string_view name,
                          const std::string& fallback = {}) {
  for (int i = 2; i + 1 < argc; ++i) {
    if (argv[i] == name) {
      return argv[i + 1];
    }
  }
  return fallback;
}

int intArgument(int argc, char** argv, std::string_view name, int fallback) {
  const std::string value = argumentValue(argc, argv, name);
  return value.empty() ? fallback : std::stoi(value);
}

double doubleArgument(int argc, char** argv, std::string_view name, double fallback) {
  const std::string value = argumentValue(argc, argv, name);
  return value.empty() ? fallback : std::stod(value);
}

bool hasFlag(int argc, char** argv, std::string_view name) {
  for (int index = 2; index < argc; ++index) {
    if (argv[index] == name)
      return true;
  }
  return false;
}

geodesic::CurvedWorldOptions curvedWorldArguments(int argc, char** argv) {
  geodesic::CurvedWorldOptions options;
  options.genus = intArgument(argc, argv, "--genus", options.genus);
  options.resolution = intArgument(argc, argv, "--resolution", options.resolution);
  options.tubeRadius = doubleArgument(argc, argv, "--tube-radius", options.tubeRadius);
  options.relief = doubleArgument(argc, argv, "--relief", options.relief);
  const std::string seed = argumentValue(argc, argv, "--seed");
  if (!seed.empty()) {
    options.seed = static_cast<std::uint32_t>(std::stoul(seed));
  }
  return options;
}

void usage() {
  std::cout
      << "Heat Method geodesics on triangle meshes\n\n"
      << "Commands:\n"
      << "  generate   [world options] --output mesh.obj\n"
      << "  solve      --mesh mesh.obj [--source 0] [--method heat|dijkstra] --output values.csv\n"
      << "  path       --mesh mesh.obj [--source 0] [--start 1] --output path.obj\n"
      << "  export-web [world options] [--all] --output web/public/data/worlds\n\n"
      << "Curved-world options:\n"
      << "  --genus 2 --resolution 64 --tube-radius 0.30 --relief 0.16\n"
      << "  --seed 1592594996\n"
      << "Only genus 1, 2, and 3 are supported. --all exports all three plus a manifest.\n";
}

} // namespace

int main(int argc, char** argv) {
  using namespace geodesic;
  try {
    if (argc < 2) {
      usage();
      return EXIT_FAILURE;
    }
    if (std::string_view(argv[1]) == "--help" || std::string_view(argv[1]) == "-h" ||
        hasFlag(argc, argv, "--help") || hasFlag(argc, argv, "-h")) {
      usage();
      return EXIT_SUCCESS;
    }
    const std::string command = argv[1];
    if (command == "generate") {
      const CurvedWorldOptions options = curvedWorldArguments(argc, argv);
      const std::filesystem::path output =
          argumentValue(argc, argv, "--output", "curved-world.obj");
      GeneratedCurvedWorld world = generateCurvedWorld(options);
      writeObj(world.mesh, output);
      std::cout << "wrote genus " << world.topology.recoveredGenus << " with "
                << world.mesh.vertices().size() << " vertices and " << world.mesh.faces().size()
                << " faces to " << output << '\n';
    } else if (command == "solve") {
      const std::string meshPath = argumentValue(argc, argv, "--mesh");
      if (meshPath.empty()) {
        throw std::invalid_argument("solve requires --mesh");
      }
      TriangleMesh mesh = loadObj(meshPath);
      const Index source = static_cast<Index>(intArgument(argc, argv, "--source", 0));
      const std::string method = argumentValue(argc, argv, "--method", "heat");
      const std::filesystem::path output = argumentValue(argc, argv, "--output", "distance.csv");
      if (method == "heat") {
        HeatMethodSolver solver(mesh);
        HeatMethodResult result = solver.compute(source);
        writeScalarCsv(result.distance, output, "heat_distance");
        std::cout << "heat residual=" << result.heatReport.relativeResidual
                  << " poisson residual=" << result.poissonReport.relativeResidual << '\n';
      } else if (method == "dijkstra") {
        DijkstraResult result = edgeDijkstra(mesh, source);
        writeScalarCsv(result.distance, output, "edge_dijkstra_distance");
        std::cout << "Dijkstra query=" << result.milliseconds << " ms\n";
      } else {
        throw std::invalid_argument("--method must be heat or dijkstra");
      }
      std::cout << "wrote " << output << '\n';
    } else if (command == "path") {
      const std::string meshPath = argumentValue(argc, argv, "--mesh");
      if (meshPath.empty()) {
        throw std::invalid_argument("path requires --mesh");
      }
      TriangleMesh mesh = loadObj(meshPath);
      const Index source = static_cast<Index>(intArgument(argc, argv, "--source", 0));
      const Index startVertex = static_cast<Index>(intArgument(argc, argv, "--start", 1));
      if (startVertex >= mesh.vertices().size()) {
        throw std::invalid_argument("path start vertex is out of range");
      }
      HeatMethodSolver solver(mesh);
      HeatMethodResult heat = solver.compute(source);
      const auto faces = mesh.incidentFaces(startVertex);
      if (faces.empty()) {
        throw std::runtime_error("path start vertex is isolated");
      }
      const Triangle& triangle = mesh.faces()[faces.front()].vertices;
      std::array<double, 3> barycentric{0.0, 0.0, 0.0};
      for (int local = 0; local < 3; ++local) {
        if (triangle[static_cast<std::size_t>(local)] == startVertex) {
          barycentric[static_cast<std::size_t>(local)] = 1.0;
        }
      }
      PathResult path = traceDistanceGradient(mesh, solver.operators().faceGeometry, heat.distance,
                                              source, SurfacePoint{faces.front(), barycentric});
      if (!path.reachedSource) {
        throw std::runtime_error("path extraction failed: " + path.termination);
      }
      const std::filesystem::path output = argumentValue(argc, argv, "--output", "path.obj");
      writePathObj(path.points, output);
      std::cout << "wrote " << path.points.size() << " path points to " << output << " ("
                << path.termination << ")\n";
    } else if (command == "export-web") {
      WebExportOptions options;
      options.world = curvedWorldArguments(argc, argv);
      const std::filesystem::path output =
          argumentValue(argc, argv, "--output", "web/public/data/worlds");
      if (hasFlag(argc, argv, "--all")) {
        const std::vector<WebExportReport> reports = exportAllCurvedWorlds(output, options);
        for (const WebExportReport& report : reports) {
          std::cout << "exported genus " << report.genus << ": " << report.vertexCount
                    << " vertices, " << report.faceCount
                    << " faces, chi=" << report.eulerCharacteristic << '\n';
        }
        std::cout << output / "manifest.json" << '\n';
      } else {
        const WebExportReport report = exportCurvedWorld(output, options);
        std::cout << "exported genus " << report.genus << ": " << report.vertexCount
                  << " vertices, " << report.faceCount << " faces; source=" << report.sourceVertex
                  << "\n"
                  << "heat residual=" << report.heatResidual
                  << " poisson residual=" << report.poissonResidual << '\n'
                  << report.binaryPath << '\n'
                  << report.metadataPath << '\n';
      }
    } else {
      usage();
      return EXIT_FAILURE;
    }
    return EXIT_SUCCESS;
  } catch (const std::exception& error) {
    std::cerr << "error: " << error.what() << '\n';
    return EXIT_FAILURE;
  }
}
