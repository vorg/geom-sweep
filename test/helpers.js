import { avec3 } from "pex-math";

const key = (positions, i) =>
  `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`;

const triangleNormal = (positions, a, b, c) => {
  const ab = [0, 0, 0];
  const ac = [0, 0, 0];
  avec3.set(ab, 0, positions, b);
  avec3.sub(ab, 0, positions, a);
  avec3.set(ac, 0, positions, c);
  avec3.sub(ac, 0, positions, a);
  avec3.cross(ab, 0, ac, 0);
  return ab;
};

export const area = ({ positions, cells }) => {
  let sum = 0;
  for (let i = 0; i < cells.length; i += 3) {
    const n = triangleNormal(positions, cells[i], cells[i + 1], cells[i + 2]);
    sum += avec3.length(n, 0) / 2;
  }
  return sum;
};

/**
 * Signed volume (positive when outward), edges without an opposite twin (welded
 * by position since walls and caps don't share vertices), and vertex normals
 * disagreeing with their triangle winding.
 */
export const analyze = ({ positions, normals, cells }) => {
  let volume = 0;
  let flippedNormals = 0;
  const edges = new Set();

  for (let i = 0; i < cells.length; i += 3) {
    const triangle = [cells[i], cells[i + 1], cells[i + 2]];
    const [a, b, c] = triangle;

    const n = triangleNormal(positions, a, b, c);
    volume += avec3.dot(positions, a, n, 0) / 6;
    for (const vertex of triangle) {
      if (avec3.dot(normals, vertex, n, 0) <= 0) flippedNormals++;
    }

    for (let j = 0; j < 3; j++) {
      edges.add(
        `${key(positions, triangle[j])}|${key(positions, triangle[(j + 1) % 3])}`,
      );
    }
  }

  let openEdges = 0;
  for (const edge of edges) {
    const [from, to] = edge.split("|");
    if (!edges.has(`${to}|${from}`)) openEdges++;
  }

  return { volume, openEdges, flippedNormals };
};

export const bounds = ({ positions }) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3], positions[i]);
    max[i % 3] = Math.max(max[i % 3], positions[i]);
  }
  return { min, max };
};

export const close = (a, b, epsilon = 1e-5) => Math.abs(a - b) < epsilon;

export const assertArrayClose = (assert, actual, expected, epsilon) => {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) {
    assert.ok(
      close(actual[i], expected[i], epsilon),
      `index ${i}: ${actual[i]} !== ${expected[i]}`,
    );
  }
};
