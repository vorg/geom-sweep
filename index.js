import { avec2, avec3, vec2, vec3, mat4 } from "pex-math";
import computeFrenetSerretFrames from "frenet-serret-frames";
import typedArrayConstructor from "typed-array-constructor";
import { computeColumns, computeProfile, stitchRings } from "geom-extrude";

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

function sweep(geometry, shape, options, out = {}) {
  const {
    radius = 1,
    closed = "auto",
    closedShape = "auto",
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
  const { normal, loops } = computeProfile(
    {
      ...shape,
      positions: shapePositions,
      cells: shape.cells ?? [
        Array.from({ length: shapePositions.length / 3 }, (_, i) => i),
      ],
    },
    { closed: closedShape },
  );
  const columns = computeColumns(shapePositions, loops, normal);

  const ringCount = path.positions.length / 3;
  const columnCount = columns.shapeIndices.length;
  const stitchCount = isClosed ? ringCount : ringCount - 1;
  const size = ringCount * columnCount;

  out.positions ||= new Float32Array(size * 3);
  out.normals ||= new Float32Array(size * 3);
  out.uvs ||= new Float32Array(size * 2);
  if (withFrames) {
    out.tangents ||= new Float32Array(size * 3);
    out.binormals ||= new Float32Array(size * 3);
  }
  out.cells ||= new (typedArrayConstructor(size))(
    (columns.cells.length / 2) * stitchCount * 6,
  );

  for (let i = 0; i < ringCount; i++) {
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

    for (let j = 0; j < columnCount; j++) {
      const vertex = i * columnCount + j;

      // Positions
      avec3.set(TEMP_VEC3, 0, shapePositions, columns.shapeIndices[j]);
      TEMP_VEC3[0] *= TEMP_RADIUS_VEC2[0];
      TEMP_VEC3[1] *= TEMP_RADIUS_VEC2[1];
      vec3.multMat4(TEMP_VEC3, TEMP_MAT4);
      avec3.add(TEMP_VEC3, 0, path.positions, i);
      avec3.set(out.positions, vertex, TEMP_VEC3, 0);

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
  const lastRing = ringCount - 1;
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

  return out;
}

export default sweep;
