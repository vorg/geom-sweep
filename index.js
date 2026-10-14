import { avec2, avec3, vec2, vec3, mat4 } from "pex-math";
import computeFrenetSerretFrames from "frenet-serret-frames";
import typedArrayConstructor from "typed-array-constructor";
import {
  computeCapUvs,
  computeColumns,
  computeProfile,
  copyAttributes,
  getVertexAttributes,
  stitchRings,
} from "geom-extrude";

const TEMP_MAT4 = mat4.create();
const TEMP_RADIUS_VEC2 = vec2.create();
const TEMP_VEC3 = vec3.create();

const PATH_ATTRIBUTES = [
  "positions",
  "tangents",
  "normals",
  "binormals",
  "radii",
];

// Never copied: sweep generates them
const GENERATED_ATTRIBUTES = [
  "positions",
  "normals",
  "tangents",
  "binormals",
  "uvs",
  "cells",
];

// Own object: computing frames never writes to the path geometry. Follows
// the first polyline of the path cells, if any, other ones are ignored.
const gatherPath = (geometry, closed) => {
  const vertexCount = geometry.positions.length / 3;
  const cell = geometry.cells?.[0]?.length ? geometry.cells[0] : null;
  const count = cell ? cell.length : vertexCount;
  const first = cell ? cell[0] : 0;
  const last = cell ? cell[count - 1] : count - 1;

  // Repeated first index or position
  const isClosing =
    count > 1 &&
    avec3.equals(geometry.positions, first, geometry.positions, last);
  const pathCount = isClosing && closed !== false ? count - 1 : count;
  const sourceIndices = Uint32Array.from({ length: pathCount }, (_, i) =>
    cell ? cell[i] : i,
  );

  const path = {};
  for (const name of PATH_ATTRIBUTES) {
    const source = geometry[name];
    if (!source) continue;

    const size = source.length / vertexCount;
    if (!cell) {
      path[name] =
        pathCount === count ? source : source.slice(0, pathCount * size);
      continue;
    }
    path[name] = new source.constructor(pathCount * size);
    for (let i = 0; i < pathCount; i++) {
      for (let k = 0; k < size; k++) {
        path[name][i * size + k] = source[sourceIndices[i] * size + k];
      }
    }
  }

  return {
    path,
    closed: closed === "auto" ? isClosing : closed,
    sourceIndices,
  };
};

const setRingTransform = (path, radius, i) => {
  TEMP_MAT4[0] = path.binormals[i * 3];
  TEMP_MAT4[1] = path.binormals[i * 3 + 1];
  TEMP_MAT4[2] = path.binormals[i * 3 + 2];

  TEMP_MAT4[4] = path.normals[i * 3];
  TEMP_MAT4[5] = path.normals[i * 3 + 1];
  TEMP_MAT4[6] = path.normals[i * 3 + 2];

  TEMP_MAT4[8] = path.tangents[i * 3];
  TEMP_MAT4[9] = path.tangents[i * 3 + 1];
  TEMP_MAT4[10] = path.tangents[i * 3 + 2];

  vec2.set(TEMP_RADIUS_VEC2, radius);
  if (path.radii) {
    TEMP_RADIUS_VEC2[0] *= path.radii[i * 2];
    TEMP_RADIUS_VEC2[1] *= path.radii[i * 2 + 1];
  }
};

const setPosition = (out, vertex, shapePositions, shapeIndex, path, i) => {
  avec3.set(TEMP_VEC3, 0, shapePositions, shapeIndex);
  TEMP_VEC3[0] *= TEMP_RADIUS_VEC2[0];
  TEMP_VEC3[1] *= TEMP_RADIUS_VEC2[1];
  vec3.multMat4(TEMP_VEC3, TEMP_MAT4);
  avec3.add(TEMP_VEC3, 0, path.positions, i);
  avec3.set(out.positions, vertex, TEMP_VEC3, 0);
};

const computeRingVs = (path, count, vMapping) => {
  const pathCount = path.positions.length / 3;
  const vs = new Float32Array(count);
  for (let i = 1; i < count; i++) {
    vs[i] =
      vs[i - 1] +
      (vMapping === "index"
        ? 1
        : avec3.distance(
            path.positions,
            (i - 1) % pathCount,
            path.positions,
            i % pathCount,
          ));
  }
  const total = vs[count - 1] || 1;
  for (let i = 0; i < count; i++) vs[i] /= total;
  return vs;
};

function sweep(geometry, shape, options, out = {}) {
  const {
    radius = [1, 1],
    closed = "auto",
    closedShape = "auto",
    capStart = true,
    capEnd = true,
    capMapping,
    creaseAngle,
    vMapping = "length",
    frameOptions,
    withFrames = false,
  } = {
    ...options,
  };

  const {
    path,
    closed: isClosed,
    sourceIndices,
  } = gatherPath(geometry, closed);

  const hasPerVertexAttribute = (name) =>
    path[name]?.length === path.positions.length;
  if (!["tangents", "normals", "binormals"].every(hasPerVertexAttribute)) {
    // Given tangents are kept: frames are built around them
    if (!hasPerVertexAttribute("tangents")) delete path.tangents;
    delete path.normals;
    delete path.binormals;
    computeFrenetSerretFrames(path, { ...frameOptions, closed: isClosed });
  }

  const { positions: shapePositions } = shape;
  const profile = computeProfile(
    {
      ...shape,
      cells: shape.cells ?? [
        Array.from({ length: shapePositions.length / 3 }, (_, i) => i),
      ],
    },
    { closed: closedShape },
  );
  const columns = computeColumns(
    shapePositions,
    profile.loops,
    profile.normal,
    creaseAngle,
  );

  const ringCount = path.positions.length / 3;
  const lastRing = ringCount - 1;
  // Closed paths end on a copy of their first ring: the v seam
  const wallRingCount = ringCount + (isClosed ? 1 : 0);
  const columnCount = columns.shapeIndices.length;
  const wallVertexCount = wallRingCount * columnCount;
  const wallCellCount = (columns.cells.length / 2) * (wallRingCount - 1) * 6;

  // Closed paths and open shapes have no ends to cap
  const caps =
    isClosed || !profile.cells.length
      ? []
      : [
          capStart && { ring: 0, side: -1 },
          capEnd && { ring: lastRing, side: 1 },
        ].filter(Boolean);
  const shapeCount = shapePositions.length / 3;
  const size = wallVertexCount + shapeCount * caps.length;

  // Path attributes win over shape attributes of the same name
  const pathAttributes = getVertexAttributes(
    geometry,
    geometry.positions.length / 3,
    [...GENERATED_ATTRIBUTES, "radii"],
  );
  const shapeAttributes = getVertexAttributes(
    shape,
    shapeCount,
    GENERATED_ATTRIBUTES,
  ).filter(({ name }) => !pathAttributes.some((path) => path.name === name));
  for (const { name, source, size: attributeSize } of [
    ...pathAttributes,
    ...shapeAttributes,
  ]) {
    out[name] ||= new source.constructor(size * attributeSize);
  }
  // Source path vertex of every vertex in a ring or cap
  const ringSourceIndices = new Uint32Array(Math.max(columnCount, shapeCount));

  out.positions ||= new Float32Array(size * 3);
  out.normals ||= new Float32Array(size * 3);
  out.uvs ||= new Float32Array(size * 2);
  if (withFrames) {
    out.tangents ||= new Float32Array(size * 3);
    out.binormals ||= new Float32Array(size * 3);
  }
  out.cells ||= new (typedArrayConstructor(size))(
    wallCellCount + profile.cells.length * caps.length,
  );

  const vs = computeRingVs(path, wallRingCount, vMapping);

  for (let ring = 0; ring < wallRingCount; ring++) {
    const i = ring % ringCount;
    setRingTransform(path, radius, i);

    for (let j = 0; j < columnCount; j++) {
      const vertex = ring * columnCount + j;

      setPosition(
        out,
        vertex,
        shapePositions,
        columns.shapeIndices[j],
        path,
        i,
      );

      // Normals: scaled by the other radius rather than divided by their own,
      // perpendicular to walls stretched by x/y radii, even a zero one
      avec3.set(TEMP_VEC3, 0, columns.normals, j);
      TEMP_VEC3[0] *= TEMP_RADIUS_VEC2[1];
      TEMP_VEC3[1] *= TEMP_RADIUS_VEC2[0];
      vec3.multMat4(TEMP_VEC3, TEMP_MAT4);
      avec3.set(out.normals, vertex, TEMP_VEC3, 0);

      // UVs
      avec2.set2(out.uvs, vertex, columns.u[j], vs[ring]);
    }

    const ringOffset = ring * columnCount;
    copyAttributes(
      out,
      shapeAttributes,
      ringOffset,
      columnCount,
      columns.shapeIndices,
    );
    ringSourceIndices.fill(sourceIndices[i]);
    copyAttributes(
      out,
      pathAttributes,
      ringOffset,
      columnCount,
      ringSourceIndices,
    );
  }

  // Tilt normals along the tangent to stay perpendicular to the walls between
  // rings, eg. tapered or twisted
  for (let i = 0; i < ringCount; i++) {
    const previous = i > 0 ? i - 1 : isClosed ? lastRing : i;
    const next = i < lastRing ? i + 1 : isClosed ? 0 : i;

    for (let j = 0; j < columnCount; j++) {
      const vertex = i * columnCount + j;

      avec3.set(TEMP_VEC3, 0, out.positions, next * columnCount + j);
      avec3.sub(TEMP_VEC3, 0, out.positions, previous * columnCount + j);
      const along = avec3.dot(path.tangents, i, TEMP_VEC3, 0);
      if (along) {
        avec3.addScaled(
          out.normals,
          vertex,
          path.tangents,
          i,
          -avec3.dot(out.normals, vertex, TEMP_VEC3, 0) / along,
        );
      }
      avec3.normalize(out.normals, vertex);

      if (withFrames) {
        // Orthogonal to the tilted normal
        avec3.set(out.tangents, vertex, path.tangents, i);
        avec3.addScaled(
          out.tangents,
          vertex,
          out.normals,
          vertex,
          -avec3.dot(out.tangents, vertex, out.normals, vertex),
        );
        avec3.normalize(out.tangents, vertex);
        avec3.set(out.binormals, vertex, out.tangents, vertex);
        avec3.cross(out.binormals, vertex, out.normals, vertex);
      }
    }
  }

  if (isClosed) {
    const seam = ringCount * columnCount * 3;
    for (const name of ["normals", "tangents", "binormals"]) {
      out[name]?.copyWithin(seam, 0, columnCount * 3);
    }
  }

  stitchRings(out.cells, columns, { ringCount: wallRingCount });

  if (caps.length) {
    const capUvs =
      (!capMapping && shape.uvs) ||
      computeCapUvs(shapePositions, profile, capMapping);
    let vertexOffset = wallVertexCount;
    let cellIndex = wallCellCount;

    for (const { ring, side } of caps) {
      setRingTransform(path, radius, ring);

      for (let k = 0; k < shapeCount; k++) {
        const vertex = vertexOffset + k;
        setPosition(out, vertex, shapePositions, k, path, ring);
        avec3.set(out.normals, vertex, path.tangents, ring);
        avec3.scale(out.normals, vertex, side);
        avec2.set(out.uvs, vertex, capUvs, k);

        if (withFrames) {
          // Cap tangents lie in the cap plane
          avec3.set(out.tangents, vertex, path.binormals, ring);
          avec3.set(out.binormals, vertex, out.tangents, vertex);
          avec3.cross(out.binormals, vertex, out.normals, vertex);
        }
      }

      // The frame mirrors the shape: its counter-clockwise triangles face
      // against the tangent, so only the end cap flips
      const { cells } = profile;
      for (let k = 0; k < cells.length; k += 3) {
        out.cells[cellIndex++] = vertexOffset + cells[k];
        out.cells[cellIndex++] = vertexOffset + cells[k + (side > 0 ? 2 : 1)];
        out.cells[cellIndex++] = vertexOffset + cells[k + (side > 0 ? 1 : 2)];
      }

      copyAttributes(out, shapeAttributes, vertexOffset, shapeCount);
      ringSourceIndices.fill(sourceIndices[ring]);
      copyAttributes(
        out,
        pathAttributes,
        vertexOffset,
        shapeCount,
        ringSourceIndices,
      );

      vertexOffset += shapeCount;
    }
  }

  return out;
}

export default sweep;
