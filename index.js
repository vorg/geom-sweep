import { avec3, vec3 } from "pex-math";
import computePathTangents from "path-tangents";
import computeFrenetSerretFrames from "frenet-serret-frames";

function avec2Set(a, i, b, j) {
  a[i * 2] = b[j * 2];
  a[i * 2 + 1] = b[j * 2 + 1];
}

function sweep(path, shapePath, options) {
  const dist = vec3.distance(path[0], path[path.length - 1]);

  let {
    closed = dist < Number.EPSILON || true,
    closedShape = true,
    caps = false,
    initialNormal = null,
    radius = 1,
    pathTangents,
    frames,
  } = {
    ...options,
  };
  const isClosed = closed;
  closedShape &&= !(shapePath.length === 2);
  caps &&= !isClosed;

  pathTangents ||= computePathTangents(path, isClosed);
  frames ||= computeFrenetSerretFrames(path, pathTangents, {
    closed: isClosed,
    initialNormal,
  });

  const numSegments = shapePath.length;
  const numFaces = closedShape ? shapePath.length : shapePath.length - 1;
  const numFrameFaces = isClosed ? frames.length : frames.length - 1;

  const size = numSegments * frames.length + (caps ? 2 : 0);

  const positions = new Float32Array(size * 3);
  const normals = new Float32Array(size * 3);
  const tangents = new Float32Array(size * 3);
  const uvs = new Float32Array(size * 2);
  const cells = new Uint32Array(
    numFrameFaces * numFaces * 6 + (caps ? 2 : 0) * numSegments * 3
  );

  // let segmentIndex = 0;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];

    // prettier-ignore
    const m = [
      ...frame.binormal, 0,
      ...frame.normal, 0,
      ...frame.tangent, 0,
      0, 0, 0, 1
    ]

    for (let j = 0; j < shapePath.length; j++) {
      let p = vec3.copy(shapePath[j]);
      p = [p[0], p[1], 0];
      if (radius) {
        // TODO: there is ambiguity between [r, r] and [rx, ry]
        const r = radius.length ? radius[i] : radius;
        const rx = r[0] !== undefined ? r[0] : r;
        const ry = r[1] !== undefined ? r[1] : rx;
        p[0] *= rx;
        p[1] *= ry;
      }

      vec3.add(vec3.multMat4(p, m), frame.position);
      const uv = [j / numFaces, i / numFrameFaces];
      const n = vec3.normalize(vec3.sub(vec3.copy(p), frame.position));

      const aIndex = i * shapePath.length + j;
      avec3.set(positions, aIndex, p, 0);
      avec3.set(normals, aIndex, n, 0);
      avec3.set(tangents, aIndex, frame.tangent, 0);
      avec2Set(uvs, aIndex, uv, 0);

      // Cells
      if (j < numFaces) {
        const a = i * numSegments + ((j + 1) % numSegments) + numSegments;
        const b = i * numSegments + ((j + 1) % numSegments);
        const c = i * numSegments + j;
        const d = i * numSegments + j + numSegments;
        const cellIndex = i * numFaces * 2 + j * 2;

        if (i < frames.length - 1) {
          avec3.set3(cells, cellIndex, a, b, c);
          avec3.set3(cells, cellIndex + 1, a, c, d);
        } else if (isClosed) {
          avec3.set3(cells, cellIndex, a % size, b % size, c % size);
          avec3.set3(cells, cellIndex + 1, a % size, c % size, d % size);
        }
      }
    }
  }

  if (caps) {
    const fStart = frames[0];
    const fEnd = frames[frames.length - 1];

    avec3.set(positions, size - 2, fStart.position, 0);
    avec3.set(positions, size - 1, fEnd.position, 0);
    avec3.set(normals, size - 2, vec3.scale(vec3.copy(fStart.tangent), -1), 0);
    avec3.set(normals, size - 1, vec3.scale(vec3.copy(fEnd.tangent), -1), 0);
    avec2Set(uvs, size - 2, [0, 0], 0);
    avec2Set(uvs, size - 1, [1, 1], 0);

    const startIndex = numFrameFaces * numFaces * 2;
    const segmentIndex = frames.length * numSegments;
    for (let j = 0; j < numSegments; j++) {
      const cellIndex = startIndex + j * 2;

      avec3.set3(cells, cellIndex, j, (j + 1) % numSegments, size - 2);
      avec3.set3(
        cells,
        cellIndex + 1,
        size - 1,
        segmentIndex - numSegments + ((j + 1) % numSegments),
        segmentIndex - numSegments + j
      );
    }
  }

  return {
    positions,
    normals,
    uvs,
    cells,

    tangents,
    frames,
  };
}

export default sweep;
