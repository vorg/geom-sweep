import { avec2, avec3, avec4, vec3, mat4 } from "pex-math";
import {
  computeCapUvs,
  computeColumns,
  computeProfile,
  copyAttributes,
  getVertexAttributes,
  stitchRings,
} from "geom-extrude";
import computeFrenetSerretFrames from "frenet-serret-frames";
import typedArrayConstructor from "typed-array-constructor";

const TEMP_POSITION_MAT4 = mat4.create();
const TEMP_NORMAL_MAT4 = mat4.create();
const TEMP_VEC3 = vec3.create();

const PATH_ATTRIBUTE_SIZES = {
  positions: 3,
  tangents: 3,
  normals: 3,
  binormals: 3,
  radii: 2,
};

const FRAME_ATTRIBUTES = ["tangents", "normals", "binormals"];

// Never copied: sweep generates them
const GENERATED_ATTRIBUTES = ["positions", ...FRAME_ATTRIBUTES, "uvs", "cells"];

// Distance along the polyline over its length: closed ones include the way back
const computeRingDistances = (path, ringCount, count) => {
  const distances = new Float32Array(count);
  for (let i = 1; i < count; i++) {
    distances[i] =
      distances[i - 1] +
      avec3.distance(
        path.positions,
        (i - 1) % ringCount,
        path.positions,
        i % ringCount,
      );
  }
  const length = distances[count - 1] || 1;
  for (let i = 0; i < count; i++) distances[i] /= length;
  return distances;
};

const mat4SetColumn = (m, column, vectors, i, w) =>
  avec4.set4(
    m,
    column,
    vectors[i * 3],
    vectors[i * 3 + 1],
    vectors[i * 3 + 2],
    w,
  );

const setRingTransform = (path, radius, i) => {
  // Normal matrix translation stays the identity one
  mat4SetColumn(TEMP_NORMAL_MAT4, 0, path.binormals, i, 0);
  mat4SetColumn(TEMP_NORMAL_MAT4, 1, path.normals, i, 0);
  mat4SetColumn(TEMP_NORMAL_MAT4, 2, path.tangents, i, 0);
  mat4.set(TEMP_POSITION_MAT4, TEMP_NORMAL_MAT4);
  mat4SetColumn(TEMP_POSITION_MAT4, 3, path.positions, i, 1);

  const rx = radius[0] * (path.radii?.[i * 2] ?? 1);
  const ry = radius[1] * (path.radii?.[i * 2 + 1] ?? 1);
  avec4.scale(TEMP_POSITION_MAT4, 0, rx);
  avec4.scale(TEMP_POSITION_MAT4, 1, ry);
  // Normals: scaled by the other radius rather than divided by their own,
  // perpendicular to walls stretched by x/y radii, even a zero one
  avec4.scale(TEMP_NORMAL_MAT4, 0, ry);
  avec4.scale(TEMP_NORMAL_MAT4, 1, rx);
};

const setPosition = (out, vertex, shapePositions, shapeIndex) => {
  avec3.set(out.positions, vertex, shapePositions, shapeIndex);
  avec3.multMat4(out.positions, vertex, TEMP_POSITION_MAT4, 0);
};

const copyPathAttributes = (
  { out, pathAttributes, ringSourceIndices },
  sourceIndex,
  vertexOffset,
  count,
) => {
  if (!pathAttributes.length) return;
  ringSourceIndices.fill(sourceIndex, 0, count);
  copyAttributes(out, pathAttributes, vertexOffset, count, ringSourceIndices);
};

// Tilt along the tangent to stay perpendicular to the walls between the
// previous and next rings, eg. tapered or twisted
const tiltNormal = (out, vertex, previous, next, tangents, i) => {
  avec3.set(TEMP_VEC3, 0, out.positions, next);
  avec3.sub(TEMP_VEC3, 0, out.positions, previous);
  const along = avec3.dot(tangents, i, TEMP_VEC3, 0);
  if (along) {
    avec3.addScaled(
      out.normals,
      vertex,
      tangents,
      i,
      -avec3.dot(out.normals, vertex, TEMP_VEC3, 0) / along,
    );
  }
  avec3.normalize(out.normals, vertex);
};

// Tangent orthogonal to the normal, binormal = tangent × normal
const setFrame = (out, vertex, tangents, i) => {
  avec3.set(out.tangents, vertex, tangents, i);
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
};

// Own object per polyline: computing frames never writes to the path geometry
const gatherPath = (geometry, vertexCount, cell, closed, frameOptions) => {
  const { positions } = geometry;
  const indices = cell ?? Array.from({ length: vertexCount }, (_, i) => i);

  // Repeated first index or position
  const isClosing =
    indices.length > 1 &&
    avec3.equals(positions, indices[0], positions, indices.at(-1));
  const isClosed = closed === "auto" ? isClosing : closed;
  const ringCount = isClosing && isClosed ? indices.length - 1 : indices.length;
  const sourceIndices = Uint32Array.from(indices).subarray(0, ringCount);

  const path = {};
  for (const [name, size] of Object.entries(PATH_ATTRIBUTE_SIZES)) {
    const source = geometry[name];
    if (source?.length !== vertexCount * size) continue;

    path[name] = new source.constructor(ringCount * size);
    copyAttributes(path, [{ name, source, size }], 0, ringCount, sourceIndices);
  }

  if (FRAME_ATTRIBUTES.some((name) => !path[name])) {
    // Given tangents are kept: frames are built around them
    delete path.normals;
    delete path.binormals;
    computeFrenetSerretFrames(path, { ...frameOptions, closed: isClosed });
  }

  return { path, isClosed, ringCount, sourceIndices };
};

// Closed paths and open shapes have no ends to cap
const getCaps = ({ isClosed, ringCount }, hasCapCells, capStart, capEnd) =>
  isClosed || !hasCapCells
    ? []
    : [
        capStart && { ring: 0, side: -1 },
        capEnd && { ring: ringCount - 1, side: 1 },
      ].filter(Boolean);

const writeWalls = (context, polyline, vertexOffset) => {
  const { out, shapePositions, columns, radius, shapeAttributes } = context;
  const { path, ringCount, wallRingCount, sourceIndices } = polyline;
  const columnCount = columns.shapeIndices.length;
  const vs = computeRingDistances(path, ringCount, wallRingCount);

  for (let ring = 0; ring < wallRingCount; ring++) {
    const i = ring % ringCount;
    const ringOffset = vertexOffset + ring * columnCount;
    setRingTransform(path, radius, i);

    for (let j = 0; j < columnCount; j++) {
      const vertex = ringOffset + j;

      setPosition(out, vertex, shapePositions, columns.shapeIndices[j]);
      avec3.set(out.normals, vertex, columns.normals, j);
      avec3.multMat4(out.normals, vertex, TEMP_NORMAL_MAT4, 0);

      avec2.set2(out.uvs, vertex, columns.u[j], vs[ring]);
    }

    copyAttributes(
      out,
      shapeAttributes,
      ringOffset,
      columnCount,
      columns.shapeIndices,
    );
    copyPathAttributes(context, sourceIndices[i], ringOffset, columnCount);
  }
};

// Needs every ring positioned: tilting reads the neighbour rings
const writeWallFrames = (
  { out, columns, withFrames },
  { path, ringCount, isClosed },
  vertexOffset,
) => {
  const columnCount = columns.shapeIndices.length;
  const lastRing = ringCount - 1;

  for (let i = 0; i < ringCount; i++) {
    const previous = isClosed ? (i + lastRing) % ringCount : Math.max(i - 1, 0);
    const next = isClosed ? (i + 1) % ringCount : Math.min(i + 1, lastRing);

    for (let j = 0; j < columnCount; j++) {
      const vertex = vertexOffset + i * columnCount + j;
      tiltNormal(
        out,
        vertex,
        vertexOffset + previous * columnCount + j,
        vertexOffset + next * columnCount + j,
        path.tangents,
        i,
      );
      if (withFrames) setFrame(out, vertex, path.tangents, i);
    }
  }

  if (!isClosed) return;

  // The v seam ring shares the first ring frames
  const start = vertexOffset * 3;
  for (const name of FRAME_ATTRIBUTES) {
    out[name]?.copyWithin(
      start + ringCount * columnCount * 3,
      start,
      start + columnCount * 3,
    );
  }
};

const writeCap = (
  context,
  polyline,
  { ring, side },
  vertexOffset,
  cellOffset,
) => {
  const {
    out,
    shapePositions,
    shapeCount,
    profile,
    radius,
    withFrames,
    capUvs,
  } = context;
  const { path, sourceIndices } = polyline;
  setRingTransform(path, radius, ring);

  for (let k = 0; k < shapeCount; k++) {
    const vertex = vertexOffset + k;
    setPosition(out, vertex, shapePositions, k);
    // Given path frames may not be unit length
    avec3.set(out.normals, vertex, path.tangents, ring);
    avec3.normalize(out.normals, vertex);
    avec3.scale(out.normals, vertex, side);
    avec2.set(out.uvs, vertex, capUvs, k);
    // Cap tangents lie in the cap plane
    if (withFrames) setFrame(out, vertex, path.binormals, ring);
  }

  // The frame mirrors the shape: its counter-clockwise triangles face
  // against the tangent, so only the end cap flips
  const [b, c] = side > 0 ? [2, 1] : [1, 2];
  const { cells } = profile;
  let index = cellOffset;
  for (let k = 0; k < cells.length; k += 3) {
    out.cells[index++] = vertexOffset + cells[k];
    out.cells[index++] = vertexOffset + cells[k + b];
    out.cells[index++] = vertexOffset + cells[k + c];
  }

  copyAttributes(out, context.shapeAttributes, vertexOffset, shapeCount);
  copyPathAttributes(context, sourceIndices[ring], vertexOffset, shapeCount);

  return index;
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
    frameOptions,
    withFrames = false,
  } = {
    ...options,
  };

  const { positions: shapePositions } = shape;
  const shapeCount = shapePositions.length / 3;
  const profile = computeProfile(
    {
      ...shape,
      cells: shape.cells ?? [Array.from({ length: shapeCount }, (_, i) => i)],
    },
    { closed: closedShape },
  );
  const columns = computeColumns(
    shapePositions,
    profile.loops,
    profile.normal,
    creaseAngle,
  );
  const columnCount = columns.shapeIndices.length;

  // Every path cell is a polyline swept separately
  const pathVertexCount = geometry.positions.length / 3;
  const polylines = (geometry.cells?.length ? geometry.cells : [null]).map(
    (cell) => {
      const polyline = gatherPath(
        geometry,
        pathVertexCount,
        cell,
        closed,
        frameOptions,
      );
      return {
        ...polyline,
        // Closed paths end on a copy of their first ring: the v seam
        wallRingCount: polyline.ringCount + (polyline.isClosed ? 1 : 0),
        caps: getCaps(polyline, profile.cells.length > 0, capStart, capEnd),
      };
    },
  );

  let size = 0;
  let cellCount = 0;
  for (const { wallRingCount, caps } of polylines) {
    size += wallRingCount * columnCount + caps.length * shapeCount;
    cellCount +=
      (wallRingCount - 1) * columns.cells.length * 3 +
      caps.length * profile.cells.length;
  }

  // Path attributes win over shape attributes of the same name
  const pathAttributes = getVertexAttributes(geometry, pathVertexCount, [
    ...GENERATED_ATTRIBUTES,
    "radii",
  ]);
  const shapeAttributes = getVertexAttributes(
    shape,
    shapeCount,
    GENERATED_ATTRIBUTES,
  ).filter(({ name }) =>
    pathAttributes.every((attribute) => attribute.name !== name),
  );
  for (const { name, source, size: attributeSize } of [
    ...pathAttributes,
    ...shapeAttributes,
  ]) {
    out[name] ||= new source.constructor(size * attributeSize);
  }

  out.positions ||= new Float32Array(size * 3);
  out.normals ||= new Float32Array(size * 3);
  out.uvs ||= new Float32Array(size * 2);
  if (withFrames) {
    out.tangents ||= new Float32Array(size * 3);
    out.binormals ||= new Float32Array(size * 3);
  }
  out.cells ||= new (typedArrayConstructor(size))(cellCount);

  const hasCaps = polylines.some(({ caps }) => caps.length);
  const context = {
    out,
    shapePositions,
    shapeCount,
    profile,
    columns,
    radius,
    withFrames,
    pathAttributes,
    shapeAttributes,
    // Source path vertex of every vertex in a ring or cap
    ringSourceIndices: new Uint32Array(Math.max(columnCount, shapeCount)),
    capUvs:
      hasCaps &&
      ((!capMapping && shape.uvs) ||
        computeCapUvs(shapePositions, profile, capMapping)),
  };

  let vertexOffset = 0;
  let cellOffset = 0;
  for (const polyline of polylines) {
    writeWalls(context, polyline, vertexOffset);
    writeWallFrames(context, polyline, vertexOffset);
    cellOffset = stitchRings(out.cells, columns, {
      ringCount: polyline.wallRingCount,
      vertexOffset,
      cellOffset,
    });
    vertexOffset += polyline.wallRingCount * columnCount;

    for (const cap of polyline.caps) {
      cellOffset = writeCap(context, polyline, cap, vertexOffset, cellOffset);
      vertexOffset += shapeCount;
    }
  }

  return out;
}

export default sweep;
