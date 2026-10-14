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

describe("sweep", () => {
  it("sweeps a closed shape along a closed path into a torus", () => {
    const R = 1;
    const r = 0.2;
    const geometry = sweep({ positions: circle(128, R) }, circle(64), {
      radius: r,
      closed: true,
    });
    const { volume, openEdges, flippedNormals } = analyze(geometry);
    assert.equal(openEdges, 0);
    assert.equal(flippedNormals, 0);
    // Pappus: 2πR · πr²
    assert.ok(close(volume, 2 * Math.PI * R * Math.PI * r * r, 1e-2));
  });

  it("follows the path", () => {
    const geometry = sweep({ positions: line(5, 2) }, circle(8), {
      radius: 0.1,
    });
    let maxZ = -Infinity;
    for (let i = 0; i < geometry.positions.length; i += 3) {
      assert.ok(
        Math.hypot(geometry.positions[i], geometry.positions[i + 1]) <=
          0.1 + 1e-6,
      );
      maxZ = Math.max(maxZ, geometry.positions[i + 2]);
    }
    assert.ok(close(maxZ, 2));
  });

  it("supports flat and nested arrays", () => {
    const path = line(4);
    const shape = circle(6);
    const flat = sweep({ positions: path }, shape, { radius: 0.5 });
    const nested = sweep({ positions: toNested(path) }, toNested(shape), {
      radius: 0.5,
    });
    assertArrayClose(assert, nested.positions, flat.positions);
  });

  it("scales the shape per path point", () => {
    const radius = [
      [0.1, 0.1],
      [0.2, 0.2],
      [0.3, 0.3],
    ];
    const geometry = sweep({ positions: line(3) }, circle(8), { radius });
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
    const geometry = sweep({ positions: line(3) }, circle(8), {
      withFrames: true,
    });
    const count = geometry.positions.length;
    assert.equal(geometry.tangents.length, count);
    assert.equal(geometry.binormals.length, count);
  });
});
