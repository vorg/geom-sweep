import { describe, it } from "node:test";
import assert from "node:assert/strict";

import sweep from "../index.js";
import { analyze, assertArrayClose, close } from "./helpers.js";

const circle = (count, radius = 1, closed = false) =>
  Float32Array.from({ length: (count + (closed ? 1 : 0)) * 3 }, (_, i) => {
    const t = ((Math.floor(i / 3) % count) / count) * Math.PI * 2;
    return [radius * Math.cos(t), radius * Math.sin(t), 0][i % 3];
  });

const line = (count, length = 1) =>
  Float32Array.from({ length: count * 3 }, (_, i) =>
    i % 3 === 2 ? (Math.floor(i / 3) / (count - 1)) * length : 0,
  );

const toNested = (flat) =>
  Array.from({ length: flat.length / 3 }, (_, i) =>
    Array.from(flat.subarray(i * 3, i * 3 + 3)),
  );

const range = (start, count) =>
  Array.from({ length: count }, (_, i) => start + i);

// Area of a regular polygon inscribed in a circle
const polygonArea = (count, radius = 1) =>
  (count / 2) * radius * radius * Math.sin((Math.PI * 2) / count);

const R = 1;
const r = 0.2;
const pappus = (area) => 2 * Math.PI * R * area * r * r;
const torus = (shape, options) =>
  sweep({ positions: circle(128, R) }, shape, {
    radius: r,
    closed: true,
    ...options,
  });

const assertSolid = (geometry, area) => {
  const { volume, openEdges, flippedNormals } = analyze(geometry);
  assert.equal(openEdges, 0);
  assert.equal(flippedNormals, 0);
  assert.ok(close(volume, pappus(area), 1e-2), `${volume} ${pappus(area)}`);
};

describe("sweep", () => {
  it("sweeps a closed shape along a closed path into a torus", () => {
    assertSolid(torus({ positions: circle(64, 1, true) }), polygonArea(64));
  });

  it("closes shapes by option", () => {
    assertSolid(
      torus({ positions: circle(64) }, { closedShape: true }),
      polygonArea(64),
    );
  });

  it("keeps open shapes open", () => {
    const { openEdges } = analyze(torus({ positions: circle(64) }));
    assert.ok(openEdges > 0);
  });

  it("sweeps holes", () => {
    const count = 64;
    const shape = {
      positions: Float32Array.from([...circle(count), ...circle(count, 0.5)]),
      cells: [
        [...range(0, count), 0],
        [...range(count, count), count],
      ],
    };
    assertSolid(torus(shape), polygonArea(count) - polygonArea(count, 0.5));
  });

  it("sweeps the boundary of triangle shapes", () => {
    const count = 32;
    const shape = {
      positions: Float32Array.from([0, 0, 0, ...circle(count)]),
      cells: Uint16Array.from(
        range(0, count).flatMap((i) => [0, i + 1, ((i + 1) % count) + 1]),
      ),
    };
    assertSolid(torus(shape), polygonArea(count));
  });

  it("closes paths ending on their first position", () => {
    const shape = { positions: circle(16, 1, true) };
    const closing = sweep({ positions: circle(32, R, true) }, shape);
    const closed = sweep({ positions: circle(32, R) }, shape, { closed: true });
    assertArrayClose(assert, closing.positions, closed.positions);
    assert.deepEqual(closing.cells, closed.cells);
  });

  it("doesn't write to the path geometry", () => {
    const path = { positions: line(4) };
    sweep(path, { positions: circle(8, 1, true) });
    assert.deepEqual(Object.keys(path), ["positions"]);
  });

  it("follows the path", () => {
    const geometry = sweep(
      { positions: line(5, 2) },
      { positions: circle(8, 1, true) },
      { radius: 0.1 },
    );
    let maxZ = -Infinity;
    for (let i = 0; i < geometry.positions.length; i += 3) {
      const distance = Math.hypot(
        geometry.positions[i],
        geometry.positions[i + 1],
      );
      assert.ok(distance <= 0.1 + 1e-6);
      maxZ = Math.max(maxZ, geometry.positions[i + 2]);
    }
    assert.ok(close(maxZ, 2));
  });

  it("supports flat and nested arrays", () => {
    const path = line(4);
    const shape = circle(6, 1, true);
    const flat = sweep({ positions: path }, { positions: shape });
    const nested = sweep(
      { positions: toNested(path) },
      { positions: toNested(shape) },
    );
    assertArrayClose(assert, nested.positions, flat.positions);
  });

  it("scales the shape per path point", () => {
    const radius = [
      [0.1, 0.1],
      [0.2, 0.2],
      [0.3, 0.3],
    ];
    const geometry = sweep(
      { positions: line(3) },
      { positions: circle(8, 1, true) },
      { radius },
    );
    for (let i = 0; i < geometry.positions.length / 3; i++) {
      const z = geometry.positions[i * 3 + 2];
      const distance = Math.hypot(
        geometry.positions[i * 3],
        geometry.positions[i * 3 + 1],
      );
      assert.ok(close(distance, radius[Math.round(z * 2)][0]));
    }
  });

  it("outputs frames", () => {
    const geometry = sweep(
      { positions: line(3) },
      { positions: circle(8, 1, true) },
      { withFrames: true },
    );
    const count = geometry.positions.length;
    assert.equal(geometry.tangents.length, count);
    assert.equal(geometry.binormals.length, count);
  });
});
