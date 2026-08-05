#include "geodesic/mesh.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <sstream>
#include <unordered_map>
#include <unordered_set>

namespace geodesic {
namespace {

std::uint64_t directedKey(Index a, Index b) {
  return (static_cast<std::uint64_t>(a) << 32U) | static_cast<std::uint64_t>(b);
}

std::uint64_t undirectedKey(Index a, Index b) {
  if (b < a) {
    std::swap(a, b);
  }
  return directedKey(a, b);
}

std::string faceMessage(std::size_t face, const std::string& message) {
  std::ostringstream stream;
  stream << "face " << face << ": " << message;
  return stream.str();
}

} // namespace

TriangleMesh TriangleMesh::build(const std::vector<Vec3>& positions,
                                 const std::vector<Triangle>& triangles, DegeneratePolicy policy,
                                 double areaEpsilon) {
  if (positions.empty()) {
    throw MeshError("mesh has no vertices");
  }
  if (triangles.empty()) {
    throw MeshError("mesh has no faces");
  }
  if (!(areaEpsilon > 0.0) || !std::isfinite(areaEpsilon)) {
    throw MeshError("area epsilon must be positive and finite");
  }

  TriangleMesh mesh;
  mesh.vertices_.reserve(positions.size());
  for (std::size_t i = 0; i < positions.size(); ++i) {
    if (!positions[i].allFinite()) {
      throw MeshError("vertex " + std::to_string(i) + " is not finite");
    }
    mesh.vertices_.push_back(Vertex{positions[i], kInvalidIndex});
  }

  std::unordered_map<std::uint64_t, Index> directed;
  std::unordered_map<std::uint64_t, Index> undirected;
  directed.reserve(triangles.size() * 3U);
  undirected.reserve(triangles.size() * 3U);

  for (std::size_t inputFace = 0; inputFace < triangles.size(); ++inputFace) {
    const Triangle triangle = triangles[inputFace];
    for (const Index vertex : triangle) {
      if (vertex >= mesh.vertices_.size()) {
        throw MeshError(faceMessage(inputFace, "vertex index is out of range"));
      }
    }
    if (triangle[0] == triangle[1] || triangle[1] == triangle[2] || triangle[2] == triangle[0]) {
      if (policy == DegeneratePolicy::Skip) {
        ++mesh.skippedDegenerateFaces_;
        continue;
      }
      throw MeshError(faceMessage(inputFace, "repeated vertex creates a degenerate triangle"));
    }

    const Vec3& a = positions[triangle[0]];
    const Vec3& b = positions[triangle[1]];
    const Vec3& c = positions[triangle[2]];
    const double doubledArea = (b - a).cross(c - a).norm();
    if (!std::isfinite(doubledArea) || doubledArea <= 2.0 * areaEpsilon) {
      if (policy == DegeneratePolicy::Skip) {
        ++mesh.skippedDegenerateFaces_;
        continue;
      }
      throw MeshError(faceMessage(inputFace, "area is below the degeneracy threshold"));
    }

    const Index faceIndex = static_cast<Index>(mesh.faces_.size());
    const Index firstHalfedge = static_cast<Index>(mesh.halfedges_.size());
    mesh.faces_.push_back(Face{firstHalfedge, triangle});
    for (Index local = 0; local < 3U; ++local) {
      mesh.halfedges_.push_back(Halfedge{triangle[local], kInvalidIndex,
                                         firstHalfedge + ((local + 1U) % 3U), kInvalidIndex,
                                         faceIndex});
    }

    for (Index local = 0; local < 3U; ++local) {
      const Index halfedge = firstHalfedge + local;
      const Index origin = triangle[local];
      const Index destination = triangle[(local + 1U) % 3U];
      const auto [_, inserted] = directed.emplace(directedKey(origin, destination), halfedge);
      if (!inserted) {
        throw MeshError(faceMessage(
            inputFace,
            "duplicate directed edge; orientation is inconsistent or edge is non-manifold"));
      }

      const auto reverse = directed.find(directedKey(destination, origin));
      if (reverse != directed.end()) {
        const Index twin = reverse->second;
        if (mesh.halfedges_[twin].twin != kInvalidIndex) {
          throw MeshError(faceMessage(inputFace, "more than two faces share an edge"));
        }
        mesh.halfedges_[halfedge].twin = twin;
        mesh.halfedges_[twin].twin = halfedge;
      }

      const std::uint64_t key = undirectedKey(origin, destination);
      const auto existing = undirected.find(key);
      Index edgeIndex = kInvalidIndex;
      if (existing == undirected.end()) {
        edgeIndex = static_cast<Index>(mesh.edges_.size());
        mesh.edges_.push_back(Edge{halfedge});
        undirected.emplace(key, edgeIndex);
      } else {
        edgeIndex = existing->second;
        const Index representative = mesh.edges_[edgeIndex].halfedge;
        if (mesh.halfedges_[representative].twin != halfedge) {
          throw MeshError(faceMessage(inputFace, "non-manifold edge incidence"));
        }
      }
      mesh.halfedges_[halfedge].edge = edgeIndex;
      if (mesh.vertices_[origin].halfedge == kInvalidIndex) {
        mesh.vertices_[origin].halfedge = halfedge;
      }
    }
  }

  if (mesh.faces_.empty()) {
    throw MeshError("all input faces were degenerate");
  }

  mesh.vertexNeighbors_.resize(mesh.vertices_.size());
  mesh.vertexFaces_.resize(mesh.vertices_.size());
  for (Index face = 0; face < mesh.faces_.size(); ++face) {
    const Triangle& triangle = mesh.faces_[face].vertices;
    for (Index local = 0; local < 3U; ++local) {
      const Index vertex = triangle[local];
      mesh.vertexFaces_[vertex].push_back(face);
      mesh.vertexNeighbors_[vertex].push_back(triangle[(local + 1U) % 3U]);
      mesh.vertexNeighbors_[vertex].push_back(triangle[(local + 2U) % 3U]);
    }
  }
  for (std::vector<Index>& neighbors : mesh.vertexNeighbors_) {
    std::sort(neighbors.begin(), neighbors.end());
    neighbors.erase(std::unique(neighbors.begin(), neighbors.end()), neighbors.end());
  }

  std::string reason;
  if (!mesh.validateManifold(&reason)) {
    throw MeshError("halfedge validation failed: " + reason);
  }
  return mesh;
}

std::array<Index, 3> TriangleMesh::faceHalfedges(Index face) const {
  if (face >= faces_.size()) {
    throw MeshError("face index is out of range");
  }
  const Index h0 = faces_[face].halfedge;
  const Index h1 = halfedges_[h0].next;
  const Index h2 = halfedges_[h1].next;
  return {h0, h1, h2};
}

std::vector<Index> TriangleMesh::oneRing(Index vertex) const {
  if (vertex >= vertices_.size()) {
    throw MeshError("vertex index is out of range");
  }
  return vertexNeighbors_[vertex];
}

std::vector<Index> TriangleMesh::incidentFaces(Index vertex) const {
  if (vertex >= vertices_.size()) {
    throw MeshError("vertex index is out of range");
  }
  return vertexFaces_[vertex];
}

bool TriangleMesh::isBoundaryEdge(Index edge) const {
  if (edge >= edges_.size()) {
    throw MeshError("edge index is out of range");
  }
  return halfedges_[edges_[edge].halfedge].twin == kInvalidIndex;
}

bool TriangleMesh::isBoundaryVertex(Index vertex) const {
  if (vertex >= vertices_.size()) {
    throw MeshError("vertex index is out of range");
  }
  for (const Halfedge& halfedge : halfedges_) {
    if (halfedge.origin == vertex || halfedges_[halfedge.next].origin == vertex) {
      if (halfedge.twin == kInvalidIndex) {
        return true;
      }
    }
  }
  return false;
}

bool TriangleMesh::hasBoundary() const {
  for (Index edge = 0; edge < edges_.size(); ++edge) {
    if (isBoundaryEdge(edge)) {
      return true;
    }
  }
  return false;
}

bool TriangleMesh::validateManifold(std::string* reason) const {
  const auto fail = [&](const std::string& message) {
    if (reason != nullptr) {
      *reason = message;
    }
    return false;
  };
  if (halfedges_.size() != faces_.size() * 3U) {
    return fail("each triangle must own exactly three halfedges");
  }
  for (Index face = 0; face < faces_.size(); ++face) {
    const auto cycle = faceHalfedges(face);
    if (halfedges_[cycle[2]].next != cycle[0]) {
      return fail("face halfedge cycle does not close");
    }
    for (const Index halfedge : cycle) {
      if (halfedges_[halfedge].face != face || halfedges_[halfedge].edge >= edges_.size() ||
          halfedges_[halfedge].origin >= vertices_.size()) {
        return fail("halfedge incidence is invalid");
      }
      const Index twin = halfedges_[halfedge].twin;
      if (twin != kInvalidIndex) {
        if (twin >= halfedges_.size() || halfedges_[twin].twin != halfedge) {
          return fail("twin relation is not symmetric");
        }
        const Index destination = halfedges_[halfedges_[halfedge].next].origin;
        const Index twinDestination = halfedges_[halfedges_[twin].next].origin;
        if (halfedges_[twin].origin != destination ||
            twinDestination != halfedges_[halfedge].origin) {
          return fail("twins do not have opposite orientation");
        }
      }
    }
  }
  for (Index vertex = 0; vertex < vertices_.size(); ++vertex) {
    const Index halfedge = vertices_[vertex].halfedge;
    if (halfedge == kInvalidIndex || vertexFaces_[vertex].empty()) {
      return fail("mesh contains an isolated vertex");
    }
    if (halfedge >= halfedges_.size() || halfedges_[halfedge].origin != vertex) {
      return fail("vertex-to-halfedge incidence is invalid");
    }

    // A two-manifold vertex has a link that is exactly one cycle (interior) or
    // one path (boundary). Edge incidence alone cannot detect a bow-tie vertex,
    // whose incident triangles form two otherwise valid but disconnected fans.
    std::unordered_map<Index, std::vector<Index>> link;
    std::unordered_set<std::uint64_t> linkEdges;
    for (const Index face : vertexFaces_[vertex]) {
      const Triangle& triangle = faces_[face].vertices;
      std::array<Index, 2> opposite{};
      std::size_t count = 0;
      for (const Index candidate : triangle) {
        if (candidate != vertex) {
          opposite[count++] = candidate;
        }
      }
      if (count != 2U) {
        return fail("vertex link contains a malformed incident face");
      }
      const std::uint64_t key = undirectedKey(opposite[0], opposite[1]);
      if (!linkEdges.insert(key).second) {
        return fail("vertex link contains a duplicate edge");
      }
      link[opposite[0]].push_back(opposite[1]);
      link[opposite[1]].push_back(opposite[0]);
    }

    std::size_t degreeOne = 0;
    for (const auto& [_, adjacent] : link) {
      if (adjacent.size() == 1U) {
        ++degreeOne;
      } else if (adjacent.size() != 2U) {
        return fail("vertex link is not a path or cycle");
      }
    }
    if (degreeOne != 0U && degreeOne != 2U) {
      return fail("vertex link has invalid boundary incidence");
    }

    std::vector<Index> stack{link.begin()->first};
    std::unordered_set<Index> visited;
    while (!stack.empty()) {
      const Index current = stack.back();
      stack.pop_back();
      if (!visited.insert(current).second) {
        continue;
      }
      for (const Index next : link.at(current)) {
        stack.push_back(next);
      }
    }
    if (visited.size() != link.size()) {
      return fail("vertex link contains disconnected triangle fans");
    }
  }
  return true;
}

Vec3 TriangleMesh::faceNormal(Index face) const {
  if (face >= faces_.size()) {
    throw MeshError("face index is out of range");
  }
  const Triangle& triangle = faces_[face].vertices;
  const Vec3 normal = (vertices_[triangle[1]].position - vertices_[triangle[0]].position)
                          .cross(vertices_[triangle[2]].position - vertices_[triangle[0]].position);
  const double norm = normal.norm();
  if (!(norm > 0.0) || !std::isfinite(norm)) {
    throw MeshError("cannot normalize a degenerate face");
  }
  return normal / norm;
}

Vec3 TriangleMesh::vertexNormal(Index vertex) const {
  if (vertex >= vertices_.size()) {
    throw MeshError("vertex index is out of range");
  }
  Vec3 sum = Vec3::Zero();
  for (const Index face : incidentFaces(vertex)) {
    const Triangle& triangle = faces_[face].vertices;
    sum += (vertices_[triangle[1]].position - vertices_[triangle[0]].position)
               .cross(vertices_[triangle[2]].position - vertices_[triangle[0]].position);
  }
  const double norm = sum.norm();
  if (norm > 0.0) {
    return sum / norm;
  }
  return Vec3::Zero();
}

double TriangleMesh::faceArea(Index face) const {
  if (face >= faces_.size()) {
    throw MeshError("face index is out of range");
  }
  const Triangle& triangle = faces_[face].vertices;
  return 0.5 * (vertices_[triangle[1]].position - vertices_[triangle[0]].position)
                   .cross(vertices_[triangle[2]].position - vertices_[triangle[0]].position)
                   .norm();
}

double TriangleMesh::edgeLength(Index edge) const {
  if (edge >= edges_.size()) {
    throw MeshError("edge index is out of range");
  }
  const Index halfedge = edges_[edge].halfedge;
  const Index a = halfedges_[halfedge].origin;
  const Index b = halfedges_[halfedges_[halfedge].next].origin;
  return (vertices_[a].position - vertices_[b].position).norm();
}

double TriangleMesh::meanEdgeLength() const {
  if (edges_.empty()) {
    throw MeshError("mesh has no edges");
  }
  double total = 0.0;
  for (Index edge = 0; edge < edges_.size(); ++edge) {
    total += edgeLength(edge);
  }
  return total / static_cast<double>(edges_.size());
}

Index TriangleMesh::adjacentFaceAcross(Index face, Index localOppositeVertex) const {
  if (face >= faces_.size() || localOppositeVertex >= 3U) {
    throw MeshError("face or local vertex index is out of range");
  }
  const auto cycle = faceHalfedges(face);
  const Index edgeHalfedge = cycle[(localOppositeVertex + 1U) % 3U];
  const Index twin = halfedges_[edgeHalfedge].twin;
  return twin == kInvalidIndex ? kInvalidIndex : halfedges_[twin].face;
}

} // namespace geodesic
