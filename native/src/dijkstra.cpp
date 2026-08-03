#include "geodesic/dijkstra.hpp"

#include <chrono>
#include <cmath>
#include <limits>
#include <queue>
#include <stdexcept>
#include <utility>

namespace geodesic {

DijkstraResult edgeDijkstra(const TriangleMesh& mesh, Index sourceVertex) {
  if (sourceVertex >= mesh.vertices().size()) {
    throw std::invalid_argument("Dijkstra source vertex is out of range");
  }
  const auto start = std::chrono::steady_clock::now();
  const std::size_t count = mesh.vertices().size();
  DijkstraResult result;
  result.distance =
      Vector::Constant(static_cast<Eigen::Index>(count), std::numeric_limits<double>::infinity());
  result.predecessor.assign(count, kInvalidIndex);

  using QueueEntry = std::pair<double, Index>;
  std::priority_queue<QueueEntry, std::vector<QueueEntry>, std::greater<>> queue;
  result.distance[static_cast<int>(sourceVertex)] = 0.0;
  result.predecessor[sourceVertex] = sourceVertex;
  queue.emplace(0.0, sourceVertex);

  while (!queue.empty()) {
    const auto [distance, vertex] = queue.top();
    queue.pop();
    if (distance != result.distance[static_cast<int>(vertex)]) {
      continue;
    }
    for (const Index neighbor : mesh.oneRing(vertex)) {
      const double edgeLength =
          (mesh.vertices()[vertex].position - mesh.vertices()[neighbor].position).norm();
      const double candidate = distance + edgeLength;
      if (candidate < result.distance[static_cast<int>(neighbor)]) {
        result.distance[static_cast<int>(neighbor)] = candidate;
        result.predecessor[neighbor] = vertex;
        queue.emplace(candidate, neighbor);
      }
    }
  }

  result.milliseconds =
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
  return result;
}

std::vector<Index> reconstructVertexPath(const DijkstraResult& result, Index startVertex,
                                         Index sourceVertex) {
  if (startVertex >= result.predecessor.size() || sourceVertex >= result.predecessor.size()) {
    throw std::invalid_argument("Dijkstra path endpoint is out of range");
  }
  std::vector<Index> path;
  path.reserve(result.predecessor.size());
  Index current = startVertex;
  for (std::size_t step = 0; step <= result.predecessor.size(); ++step) {
    path.push_back(current);
    if (current == sourceVertex) {
      return path;
    }
    const Index next = result.predecessor[current];
    if (next == kInvalidIndex || next == current) {
      break;
    }
    current = next;
  }
  throw std::runtime_error("Dijkstra predecessor chain did not reach the source");
}

} // namespace geodesic
