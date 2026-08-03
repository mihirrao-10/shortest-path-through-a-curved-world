#pragma once

#include "geodesic/types.hpp"

#include <stdexcept>
#include <string>
#include <vector>

namespace geodesic {

enum class DegeneratePolicy { Reject, Skip };

class MeshError : public std::runtime_error {
public:
  using std::runtime_error::runtime_error;
};

class TriangleMesh {
public:
  struct Vertex {
    Vec3 position{Vec3::Zero()};
    Index halfedge{kInvalidIndex};
  };

  struct Halfedge {
    Index origin{kInvalidIndex};
    Index twin{kInvalidIndex};
    Index next{kInvalidIndex};
    Index edge{kInvalidIndex};
    Index face{kInvalidIndex};
  };

  struct Edge {
    Index halfedge{kInvalidIndex};
  };

  struct Face {
    Index halfedge{kInvalidIndex};
    Triangle vertices{};
  };

  static TriangleMesh build(const std::vector<Vec3>& positions,
                            const std::vector<Triangle>& triangles,
                            DegeneratePolicy policy = DegeneratePolicy::Reject,
                            double areaEpsilon = 1e-14);

  [[nodiscard]] const std::vector<Vertex>& vertices() const noexcept {
    return vertices_;
  }
  [[nodiscard]] const std::vector<Halfedge>& halfedges() const noexcept {
    return halfedges_;
  }
  [[nodiscard]] const std::vector<Edge>& edges() const noexcept {
    return edges_;
  }
  [[nodiscard]] const std::vector<Face>& faces() const noexcept {
    return faces_;
  }
  [[nodiscard]] std::size_t skippedDegenerateFaces() const noexcept {
    return skippedDegenerateFaces_;
  }

  [[nodiscard]] std::array<Index, 3> faceHalfedges(Index face) const;
  [[nodiscard]] std::vector<Index> oneRing(Index vertex) const;
  [[nodiscard]] std::vector<Index> incidentFaces(Index vertex) const;
  [[nodiscard]] bool isBoundaryEdge(Index edge) const;
  [[nodiscard]] bool isBoundaryVertex(Index vertex) const;
  [[nodiscard]] bool hasBoundary() const;
  [[nodiscard]] bool validateManifold(std::string* reason = nullptr) const;

  [[nodiscard]] Vec3 faceNormal(Index face) const;
  [[nodiscard]] Vec3 vertexNormal(Index vertex) const;
  [[nodiscard]] double faceArea(Index face) const;
  [[nodiscard]] double edgeLength(Index edge) const;
  [[nodiscard]] double meanEdgeLength() const;
  [[nodiscard]] Index adjacentFaceAcross(Index face, Index localOppositeVertex) const;

private:
  std::vector<Vertex> vertices_;
  std::vector<Halfedge> halfedges_;
  std::vector<Edge> edges_;
  std::vector<Face> faces_;
  std::vector<std::vector<Index>> vertexNeighbors_;
  std::vector<std::vector<Index>> vertexFaces_;
  std::size_t skippedDegenerateFaces_{0};
};

} // namespace geodesic
