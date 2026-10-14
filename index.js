import { avec2, avec3, vec2, vec3, mat4 } from "pex-math";
import computeFrenetSerretFrames from "frenet-serret-frames";
import typedArrayConstructor from "typed-array-constructor";
import {
  computeCapUvs,
  computeColumns,
  computeProfile,
  stitchRings,
} from "geom-extrude";

const TEMP_MAT4 = mat4.create();
const TEMP_RADIUS_VEC2 = vec2.create();
const TEMP_VEC3 = vec3.create();

const FRAME_ATTRIBUTES = ["positions", "tangents", "normals", "binormals"];

const toFlatArray = (array) =>
  array[0]?.length ? new Float32Array(array.flat()) : array;

// A copy: computing frames never writes to the path geometry
const getPath = (geometry, closed) => {
  const path = {};
  for (const name of FRAME_ATTRIBUTES) {
    if (geometry[name]) path[name] = toFlatArray(geometry[name]);
  }

  const count = path.positions.length / 3;
  const isClosing =
    count > 1 && avec3.equals(path.positions, 0, path.positions, count - 1);
  if (isClosing && closed !== false) {
    for (const name of Object.keys(path)) {
      path[name] = path[name].slice(0, (count - 1) * 3);
    }
  }

  return { path, closed: closed === "auto" ? isClosing : closed };
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

  if (radius) {
    // TODO: support geometry.radius?
    // TODO: there is ambiguity between [r, r] and [rx, ry]
    const r = radius.length ? radius[i] : radius;
    TEMP_RADIUS_VEC2[0] = r[0] !== undefined ? r[0] : r;
    TEMP_RADIUS_VEC2[1] = r[1] !== undefined ? r[1] : TEMP_RADIUS_VEC2[0];
  } else {
    vec2.set(TEMP_RADIUS_VEC2, [1, 1]);
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

function sweep(geometry, shape, options, out = {}) {
  const {
    radius = 1,
    closed = "auto",
    closedShape = "auto",
    capStart = true,
    capEnd = true,
    capMapping,
    frameOptions,
    withFrames = false,
  } = {
    ...options,
  };

  const { path, closed: isClosed } = getPath(geometry, closed);

  if (!path.binormals || path.binormals.length !== path.positions.length) {
    delete path.normals;
    delete path.binormals;
    computeFrenetSerretFrames(path, { ...frameOptions, closed: isClosed });
  }

  const shapePositions = toFlatArray(shape.positions);
  const profile = computeProfile(
    {
      ...shape,
      positions: shapePositions,
      cells: shape.cells ?? [
        Array.from({ length: shapePositions.length / 3 }, (_, i) => i),
      ],
    },
    { closed: closedShape },
  );
  const columns = computeColumns(shapePositions, profile.loops, profile.normal);

  const ringCount = path.positions.length / 3;
  const lastRing = ringCount - 1;
  const columnCount = columns.shapeIndices.length;
  const stitchCount = isClosed ? ringCount : ringCount - 1;
  const wallVertexCount = ringCount * columnCount;
  const wallCellCount = (columns.cells.length / 2) * stitchCount * 6;

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

  for (let i = 0; i < ringCount; i++) {
    setRingTransform(path, radius, i);

    for (let j = 0; j < columnCount; j++) {
      const vertex = i * columnCount + j;

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
      avec2.set2(out.uvs, vertex, columns.u[j], i / stitchCount);
    }
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

  stitchRings(out.cells, columns, { ringCount, closed: isClosed });

  if (caps.length) {
    const capUvs =
      (!capMapping && shape.uvs && toFlatArray(shape.uvs)) ||
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

      vertexOffset += shapeCount;
    }
  }

  return out;
}

export default sweep;
