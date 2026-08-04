#pragma once

#include "geodesic/dijkstra.hpp"
#include "geodesic/heat_method.hpp"
#include "geodesic/path.hpp"
#include "geodesic/procedural.hpp"

#include <filesystem>
#include <string>
#include <vector>

namespace geodesic {

TriangleMesh loadObj(const std::filesystem::path& path,
                     DegeneratePolicy policy = DegeneratePolicy::Reject);
void writeObj(const TriangleMesh& mesh, const std::filesystem::path& path);
void writeScalarCsv(const Vector& values, const std::filesystem::path& path,
                    const std::string& columnName);
void writePathObj(const std::vector<Vec3>& points, const std::filesystem::path& path);

struct WebExportOptions {
  int detailLevel{5};
  Index sourceVertex{kInvalidIndex};
  std::vector<double> heatTimeMultipliers{0.25, 1.0, 4.0, 16.0, 64.0, 256.0};
};

struct WebExportReport {
  std::filesystem::path binaryPath;
  std::filesystem::path metadataPath;
  std::size_t vertexCount{0};
  std::size_t faceCount{0};
  Index sourceVertex{kInvalidIndex};
  CurvedWorldLandmarks landmarks{};
  double heatResidual{0.0};
  double poissonResidual{0.0};
  double preprocessingMilliseconds{0.0};
  double queryMilliseconds{0.0};
};

WebExportReport exportCurvedWorld(const std::filesystem::path& outputDirectory,
                                  const WebExportOptions& options = {});

} // namespace geodesic
