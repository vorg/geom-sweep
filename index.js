import { avec2, avec3, vec3, mat4 } from "pex-math";
import computeFrenetSerretFrames from "frenet-serret-frames";
import typedArrayConstructor from "typed-array-constructor";

const TEMP_MAT4 = mat4.create();
const TEMP_VEC3 = vec3.create();

function sweep(geometry, shapePath, options, out = {}) {
  let {
    radius = 1,
    closed = false,
    closedShape = true,
    caps = false,
    initialNormal = null,
    withFrames = false,
  } = {
    ...options,
  };
  closedShape &&= !(shapePath.length === 2);
  caps &&= !closed;

  const isFlatArray = !geometry.positions[0]?.length;
  const isShapeFlatArray = !shapePath[0]?.length;

  if (!isFlatArray) {
    geometry = { ...geometry };
    geometry.positions &&= new Float32Array(geometry.positions.flat());
    geometry.normals &&= new Float32Array(geometry.normals.flat());
    geometry.tangents &&= new Float32Array(geometry.tangents.flat());
    geometry.binormals &&= new Float32Array(geometry.binormals.flat());
  }

  if (
    !geometry.binormals ||
    geometry.binormals.length !== geometry.positions.length
  ) {
    computeFrenetSerretFrames(geometry, { closed, initialNormal });
  }

  const pathLength = geometry.positions.length / 3;
  const numSegments = shapePath.length / (isShapeFlatArray ? 3 : 1);
  const numFaces = closedShape ? numSegments : numSegments - 1;
  const numFrameFaces = closed ? pathLength : pathLength - 1;

  const size = numSegments * pathLength + (caps ? 2 : 0);

  out.positions ||= new Float32Array(size * 3);
  out.normals ||= new Float32Array(size * 3);
  out.uvs ||= new Float32Array(size * 2);
  if (withFrames) {
    out.tangents ||= new Float32Array(size * 3);
    out.binormals ||= new Float32Array(size * 3);
  }
  const cellsSize =
    numFrameFaces * numFaces * 6 + (caps ? 2 : 0) * numSegments * 3;
  out.cells ||= new (typedArrayConstructor(size))(cellsSize);

  for (let i = 0; i < pathLength; i++) {
    TEMP_MAT4[0] = geometry.binormals[i * 3];
    TEMP_MAT4[1] = geometry.binormals[i * 3 + 1];
    TEMP_MAT4[2] = geometry.binormals[i * 3 + 2];

    TEMP_MAT4[4] = geometry.normals[i * 3];
    TEMP_MAT4[5] = geometry.normals[i * 3 + 1];
    TEMP_MAT4[6] = geometry.normals[i * 3 + 2];

    TEMP_MAT4[8] = geometry.tangents[i * 3];
    TEMP_MAT4[9] = geometry.tangents[i * 3 + 1];
    TEMP_MAT4[10] = geometry.tangents[i * 3 + 2];

    for (let j = 0; j < numSegments; j++) {
      const aIndex = i * numSegments + j;

      // Positions
      if (isShapeFlatArray) {
        avec3.set(TEMP_VEC3, 0, shapePath, j);
      } else {
        TEMP_VEC3[0] = shapePath[j][0];
        TEMP_VEC3[1] = shapePath[j][1];
        TEMP_VEC3[2] = 0;
      }

      if (radius) {
        // TODO: there is ambiguity between [r, r] and [rx, ry]
        const r = radius.length ? radius[i] : radius;
        const rx = r[0] !== undefined ? r[0] : r;
        const ry = r[1] !== undefined ? r[1] : rx;
        TEMP_VEC3[0] *= rx;
        TEMP_VEC3[1] *= ry;
      }
      vec3.multMat4(TEMP_VEC3, TEMP_MAT4);
      avec3.add(TEMP_VEC3, 0, geometry.positions, i);
      avec3.set(out.positions, aIndex, TEMP_VEC3, 0);

      // Normals
      avec3.sub(TEMP_VEC3, 0, geometry.positions, i);
      vec3.normalize(TEMP_VEC3);
      avec3.set(out.normals, aIndex, TEMP_VEC3, 0);

      // UVs
      avec2.set2(out.uvs, aIndex, j / numFaces, i / numFrameFaces);

      if (withFrames) {
        // Tangents
        avec3.set3(
          out.tangents,
          aIndex,
          TEMP_MAT4[8],
          TEMP_MAT4[9],
          TEMP_MAT4[10],
        );

        // Binormals
        avec3.set(out.binormals, aIndex, out.tangents, aIndex);
        avec3.cross(out.binormals, aIndex, out.normals, aIndex);
      }

      // Cells
      if (j < numFaces) {
        const a = i * numSegments + ((j + 1) % numSegments) + numSegments;
        const b = i * numSegments + ((j + 1) % numSegments);
        const c = i * numSegments + j;
        const d = i * numSegments + j + numSegments;
        const cellIndex = i * numFaces * 2 + j * 2;

        if (i < pathLength - 1) {
          avec3.set3(out.cells, cellIndex, a, b, c);
          avec3.set3(out.cells, cellIndex + 1, a, c, d);
        } else if (closed) {
          avec3.set3(out.cells, cellIndex, a % size, b % size, c % size);
          avec3.set3(out.cells, cellIndex + 1, a % size, c % size, d % size);
        }
      }
    }
  }

  if (caps) {
    const firstPosition = geometry.positions.slice(0, 3);
    const lastPosition = geometry.positions.slice(-3);
    const firstTangent = geometry.tangents.slice(0, 3);
    const lastTangent = geometry.tangents.slice(-3);

    const a = size - 2;
    const b = size - 1;

    avec3.set(out.positions, a, firstPosition, 0);
    avec3.set(out.positions, b, lastPosition, 0);
    avec3.set(out.normals, a, vec3.scale(vec3.copy(firstTangent), -1), 0);
    avec3.set(out.normals, b, vec3.scale(vec3.copy(lastTangent), -1), 0);
    // avec2.set2(out.uvs, a, 0, 0);
    avec2.set2(out.uvs, b, 1, 1);

    const startIndex = numFrameFaces * numFaces * 2;
    const segmentIndex = pathLength * numSegments;
    for (let j = 0; j < numSegments; j++) {
      const cellIndex = startIndex + j * 2;

      avec3.set3(out.cells, cellIndex, j, (j + 1) % numSegments, a);
      avec3.set3(
        out.cells,
        cellIndex + 1,
        b,
        segmentIndex - numSegments + ((j + 1) % numSegments),
        segmentIndex - numSegments + j,
      );
    }
  }

  return out;
}

export default sweep;
