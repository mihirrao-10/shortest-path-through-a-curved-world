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

geodesic::TorusOptions torusArguments(int argc, char** argv) {
  geodesic::TorusOptions options;
  options.majorSegments = intArgument(argc, argv, "--major-segments", options.majorSegments);
  options.minorSegments = intArgument(argc, argv, "--minor-segments", options.minorSegments);
  options.majorRadius = doubleArgument(argc, argv, "--major-radius", options.majorRadius);
  options.minorRadius = doubleArgument(argc, argv, "--minor-radius", options.minorRadius);
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
      << "  generate   [torus options] --output mesh.obj\n"
      << "  solve      --mesh mesh.obj [--source 0] [--method heat|dijkstra] --output values.csv\n"
      << "  path       --mesh mesh.obj [--source 0] [--start 1] --output path.obj\n"
      << "  export-web [torus options] --output web/public/data\n\n"
      << "Torus options:\n"
      << "  --major-segments 160 --minor-segments 64\n"
      << "  --major-radius 1.28 --minor-radius 0.46 --relief 0.18 --seed 1592594996\n";
}

} // namespace

int main(int argc, char** argv) {
  using namespace geodesic;
  try {
    if (argc < 2) {
      usage();
      return EXIT_FAILURE;
    }
    const std::string command = argv[1];
    if (command == "generate") {
      const TorusOptions options = torusArguments(argc, argv);
      const std::filesystem::path output =
          argumentValue(argc, argv, "--output", "curved-torus.obj");
      TriangleMesh mesh = makeCurvedWorld(options);
      writeObj(mesh, output);
      std::cout << "wrote " << mesh.vertices().size() << " vertices and " << mesh.faces().size()
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
      options.torus = torusArguments(argc, argv);
      const std::filesystem::path output = argumentValue(argc, argv, "--output", "web/public/data");
      const WebExportReport report = exportCurvedWorld(output, options);
      std::cout << "exported " << report.vertexCount << " vertices, " << report.faceCount
                << " faces; source=" << report.sourceVertex << "\n"
                << "heat residual=" << report.heatResidual
                << " poisson residual=" << report.poissonResidual << '\n'
                << report.binaryPath << '\n'
                << report.metadataPath << '\n';
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
