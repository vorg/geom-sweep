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

const range = (start, count) =>
  Array.from({ length: count }, (_, i) => start + i);

// Area of a regular polygon inscribed in a circle
const polygonArea = (count, radius = 1) =>
  (count / 2) * radius * radius * Math.sin((Math.PI * 2) / count);

// Walls only: vertices index rings of columns
const noCaps = { capStart: false, capEnd: false };

const R = 1;
const r = 0.2;
const pappus = (area) => 2 * Math.PI * R * area * r * r;
const torus = (shape, options) =>
  sweep({ positions: circle(128, R) }, shape, {
    radius: [r, r],
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
      { radius: [0.1, 0.1] },
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

  it("scales the shape per path point", () => {
    const radii = [0.1, 0.1, 0.2, 0.2, 0.3, 0.3];
    const geometry = sweep(
      { positions: line(3), radii },
      { positions: circle(8, 1, true) },
      { radius: [2, 2], ...noCaps },
    );
    for (let i = 0; i < geometry.positions.length / 3; i++) {
      const z = geometry.positions[i * 3 + 2];
      const distance = Math.hypot(
        geometry.positions[i * 3],
        geometry.positions[i * 3 + 1],
      );
      assert.ok(close(distance, 2 * radii[Math.round(z * 2) * 2]));
    }
  });

  // Normals against the actual walls: unit and perpendicular to the
  // neighbouring vertices along the ring and along the path
  const assertPerpendicularNormals = (geometry, columnCount, epsilon) => {
    const { positions, normals } = geometry;
    const ringCount = positions.length / 3 / columnCount;
    const direction = [0, 0, 0];
    for (let i = 1; i < ringCount - 1; i++) {
      for (let j = 1; j < columnCount - 1; j++) {
        const vertex = i * columnCount + j;
        assert.ok(
          close(Math.hypot(...normals.subarray(vertex * 3, vertex * 3 + 3)), 1),
        );
        for (const [a, b] of [
          [vertex - 1, vertex + 1],
          [vertex - columnCount, vertex + columnCount],
        ]) {
          for (let k = 0; k < 3; k++) {
            direction[k] = positions[b * 3 + k] - positions[a * 3 + k];
          }
          const length = Math.hypot(...direction);
          let dot = 0;
          for (let k = 0; k < 3; k++)
            dot += normals[vertex * 3 + k] * direction[k];
          assert.ok(Math.abs(dot / length) < epsilon, `${dot / length}`);
        }
      }
    }
  };

  describe("normals", () => {
    // Smooth circle: one column per point plus the u seam
    const shape = { positions: circle(128, 1, true) };
    const columnCount = 129;

    for (const [name, path, radius] of [
      ["uniform", { positions: line(64) }, [0.2, 0.2]],
      ["elliptical", { positions: line(64) }, [0.3, 0.1]],
      [
        "tapered",
        {
          positions: line(64),
          radii: Float32Array.from({ length: 128 }, (_, i) =>
            i % 2 ? 0.1 : 0.05 + (i / 2) * 0.005,
          ),
        },
        [1, 1],
      ],
      ["curved", { positions: circle(256, 1, true) }, [0.3, 0.1]],
    ]) {
      it(`are perpendicular to ${name} walls`, () => {
        const geometry = sweep(path, shape, { radius, ...noCaps });
        assertPerpendicularNormals(geometry, columnCount, 0.01);
      });
    }

    it("are perpendicular to twisted walls", () => {
      const geometry = sweep({ positions: line(64) }, shape, {
        radius: [0.3, 0.1],
        frameOptions: { twist: Math.PI },
        ...noCaps,
      });
      assertPerpendicularNormals(geometry, columnCount, 0.01);
    });
  });

  describe("caps", () => {
    const length = 2;
    const straight = (shape, options) =>
      sweep({ positions: line(32, length) }, shape, {
        radius: [r, r],
        ...options,
      });
    const prism = (area) => area * r * r * length;

    it("closes open paths into solids", () => {
      const geometry = straight({ positions: circle(64, 1, true) });
      const { volume, openEdges, flippedNormals } = analyze(geometry);
      assert.equal(openEdges, 0);
      assert.equal(flippedNormals, 0);
      assert.ok(close(volume, prism(polygonArea(64)), 1e-3));
    });

    it("caps holes", () => {
      const count = 64;
      const geometry = straight({
        positions: Float32Array.from([...circle(count), ...circle(count, 0.5)]),
        cells: [
          [...range(0, count), 0],
          [...range(count, count), count],
        ],
      });
      const { volume, openEdges, flippedNormals } = analyze(geometry);
      assert.equal(openEdges, 0);
      assert.equal(flippedNormals, 0);
      const area = polygonArea(count) - polygonArea(count, 0.5);
      assert.ok(close(volume, prism(area), 1e-3));
    });

    it("caps nested loops: holes and islands", () => {
      // Annulus with a smaller annulus inside its hole: depths 0 to 3
      const count = 64;
      const radii = [1, 0.75, 0.5, 0.25];
      const geometry = straight({
        positions: Float32Array.from(
          radii.flatMap((radius) => [...circle(count, radius)]),
        ),
        cells: radii.map((_, i) => [...range(i * count, count), i * count]),
      });
      const { volume, openEdges, flippedNormals } = analyze(geometry);
      assert.equal(openEdges, 0);
      assert.equal(flippedNormals, 0);
      const area =
        polygonArea(count, 1) -
        polygonArea(count, 0.75) +
        polygonArea(count, 0.5) -
        polygonArea(count, 0.25);
      assert.ok(close(volume, prism(area), 1e-3));
    });

    it("caps tapered ends with x/y radii", () => {
      // Linear x radius, constant y radius: the section area grows linearly
      const radii = Float32Array.from({ length: 64 }, (_, i) =>
        i % 2 ? 0.2 : 0.1 + (0.2 * (i / 2)) / 31,
      );
      const geometry = sweep(
        { positions: line(32, length), radii },
        { positions: circle(64, 1, true) },
      );
      const { volume, openEdges, flippedNormals } = analyze(geometry);
      assert.equal(openEdges, 0);
      assert.equal(flippedNormals, 0);
      const area = polygonArea(64) * 0.2 * ((0.1 + 0.3) / 2);
      assert.ok(close(volume, area * length, 1e-3));
    });

    it("omits caps", () => {
      const shape = { positions: circle(64, 1, true) };
      const walls = straight(shape, noCaps);
      const start = straight(shape, { capEnd: false });
      // One cap vertex per shape position, the closing one included
      assert.equal(start.positions.length - walls.positions.length, 65 * 3);
      assert.ok(analyze(start).openEdges > 0);
    });

    it("skips closed paths and open shapes", () => {
      const shape = { positions: circle(64, 1, true) };
      assert.equal(
        torus(shape).positions.length,
        torus(shape, noCaps).positions.length,
      );
      const open = { positions: circle(64) };
      assert.equal(
        straight(open).positions.length,
        straight(open, noCaps).positions.length,
      );
    });

    it("maps cap uvs from the shape or a cap mapping", () => {
      const count = 16;
      const uvs = Float32Array.from({ length: count * 2 }, (_, i) => i / 100);
      const shape = { positions: circle(count, 1, true), uvs };
      // Shape uvs need one per shape vertex: the closing point repeats one
      shape.uvs = Float32Array.from([...uvs, uvs[0], uvs[1]]);
      const capUvs = (geometry) =>
        geometry.uvs.subarray(geometry.uvs.length - (count + 1) * 2);
      assertArrayClose(assert, capUvs(straight(shape)), shape.uvs);

      const mapped = capUvs(straight(shape, { capMapping: () => {} }));
      assert.ok(mapped.every((uv) => uv === 0));
    });
  });

  describe("uvs", () => {
    const shape = { positions: circle(8, 1, true) };
    // Unevenly spaced points: 0, 0.1 and 1 along z
    const path = { positions: Float32Array.of(0, 0, 0, 0, 0, 0.1, 0, 0, 1) };
    // Walls only: rings of equal column counts
    const ringVs = ({ uvs }, rings) => {
      const columnCount = uvs.length / 2 / rings;
      return Array.from(
        { length: rings },
        (_, i) => uvs[i * columnCount * 2 + 1],
      );
    };

    it("maps v by distance along the path", () => {
      const geometry = sweep(path, shape, noCaps);
      assertArrayClose(assert, ringVs(geometry, 3), [0, 0.1, 1]);
    });

    it("maps v by ring index", () => {
      const geometry = sweep(path, shape, { vMapping: "index", ...noCaps });
      assertArrayClose(assert, ringVs(geometry, 3), [0, 0.5, 1]);
    });

    it("ends closed paths on a v = 1 copy of the first ring", () => {
      const rings = 32;
      const geometry = sweep(
        { positions: circle(rings, R) },
        { positions: circle(16, 1, true) },
        { radius: [r, r], closed: true },
      );
      const vs = ringVs(geometry, rings + 1);
      assert.equal(vs[0], 0);
      assert.equal(vs.at(-1), 1);
      for (let i = 1; i < vs.length; i++) assert.ok(vs[i] > vs[i - 1]);

      const ring = geometry.positions.length / (rings + 1);
      const seam = rings * ring;
      for (const name of ["positions", "normals"]) {
        assertArrayClose(
          assert,
          geometry[name].subarray(seam, seam + ring),
          geometry[name].subarray(0, ring),
        );
      }
    });
  });

  describe("radii", () => {
    it("multiply the radius per path point", () => {
      const shape = { positions: [1, 0, 0, 0, 1, 0], cells: [[0, 1]] };
      const geometry = sweep(
        { positions: line(2), radii: [1, 2, 3, 4] },
        shape,
        { radius: [0.5, 0.25], frameOptions: { initialNormal: [0, 1, 0] } },
      );
      // Binormal = z × y = -x: shape x on -x, shape y on +y
      assertArrayClose(
        assert,
        geometry.positions.subarray(0, 12),
        [-0.5, 0, 0, 0, 0.5, 0, -1.5, 0, 1, 0, 1, 1],
      );
    });

    it("drop the closing point with the path", () => {
      const count = 16;
      const positions = circle(count, R, true);
      const radii = Float32Array.from({ length: (count + 1) * 2 }, () => r);
      const geometry = sweep(
        { positions, radii },
        { positions: circle(8, 1, true) },
      );
      assert.equal(analyze(geometry).openEdges, 0);
    });
  });

  describe("attributes", () => {
    const shapeCount = 9;
    const shape = {
      positions: circle(8, 1, true),
      ids: Uint16Array.from({ length: shapeCount }, (_, i) => i),
      vertexColors: new Float32Array(shapeCount * 4).fill(0.5),
    };
    const pathCount = 4;
    const path = {
      positions: line(pathCount),
      vertexColors: Float32Array.from(
        { length: pathCount * 4 },
        (_, i) => Math.floor(i / 4) / 10,
      ),
      offsets: [0, 0, 0],
      name: "path",
    };
    // Binormal = z × y = -x: shape (x, y) lands on (-x, y)
    const geometry = sweep(path, shape, {
      radius: [0.1, 0.1],
      frameOptions: { initialNormal: [0, 1, 0] },
    });
    const vertexCount = geometry.positions.length / 3;

    it("copies shape attributes by shape vertex", () => {
      assert.ok(geometry.ids instanceof Uint16Array);
      assert.equal(geometry.ids.length, vertexCount);
      for (let i = 0; i < vertexCount; i++) {
        const id = geometry.ids[i];
        assertArrayClose(
          assert,
          geometry.positions.subarray(i * 3, i * 3 + 2),
          [-0.1 * shape.positions[id * 3], 0.1 * shape.positions[id * 3 + 1]],
        );
      }
    });

    it("copies path attributes by path vertex, over shape ones", () => {
      assert.equal(geometry.vertexColors.length, vertexCount * 4);
      for (let i = 0; i < vertexCount; i++) {
        const pathIndex = Math.round(geometry.positions[i * 3 + 2] * 3);
        assert.ok(close(geometry.vertexColors[i * 4], pathIndex / 10));
      }
    });

    it("skips non per-vertex values", () => {
      assert.equal(geometry.offsets, undefined);
      assert.equal(geometry.name, undefined);
      assert.equal(geometry.radii, undefined);
    });
  });

  it("forwards frame options", () => {
    const shape = { positions: [1, 0, 0, 1, 0.1, 0] };
    const path = { positions: line(4) };
    const { positions } = sweep(path, shape, {
      frameOptions: { initialNormal: [1, 0, 0] },
    });
    // Binormal = tangent × normal = z × x
    assertArrayClose(assert, positions.subarray(0, 3), [0, 1, 0]);

    const twisted = sweep(path, shape, {
      frameOptions: { initialNormal: [1, 0, 0], twist: Math.PI / 2 },
    });
    assertArrayClose(assert, twisted.positions.subarray(0, 3), [0, 1, 0]);
    assert.ok(
      !close(twisted.positions.at(-6), positions.at(-6)) ||
        !close(twisted.positions.at(-5), positions.at(-5)),
    );
  });

  it("outputs orthonormal frames", () => {
    const geometry = sweep(
      {
        positions: line(16),
        radii: Float32Array.from({ length: 32 }, (_, i) =>
          i % 2 ? 0.1 : 0.1 + (i / 2) * 0.02,
        ),
      },
      { positions: circle(16, 1, true) },
      { withFrames: true },
    );
    const { tangents, normals, binormals } = geometry;
    for (let i = 0; i < tangents.length; i += 3) {
      const t = tangents.subarray(i, i + 3);
      const n = normals.subarray(i, i + 3);
      const b = binormals.subarray(i, i + 3);
      assert.ok(close(t[0] * n[0] + t[1] * n[1] + t[2] * n[2], 0));
      assert.ok(close(Math.hypot(...t), 1));
      assert.ok(close(Math.hypot(...b), 1));
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
