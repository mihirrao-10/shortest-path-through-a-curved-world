#pragma once

#include "geodesic/mesh.hpp"

#include <vector>

namespace geodesic {

struct DijkstraResult {
  Vector distance;
  std::vector<Index> predecessor;
  double milliseconds{0.0};
};

DijkstraResult edgeDijkstra(const TriangleMesh& mesh, Index sourceVertex);
std::vector<Index> reconstructVertexPath(const DijkstraResult& result, Index startVertex,
                                         Index sourceVertex);

} // namespace geodesic
