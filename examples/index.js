import sweep from "../index.js";

import * as gpu from "pex-gpu";
import { avec3, mat4 } from "pex-math";
import createGUI from "pex-gui";
import { perspective as createCamera, orbiter as createOrbiter } from "pex-cam";
import computeFrenetSerretFrames from "frenet-serret-frames";
import {
  annulus,
  annulusPath,
  circlePath,
  crossPath,
  disc,
  squarePath,
  starPath,
} from "primitive-geometry";
import edges from "geom-edges";
import splinePoints from "spline-points";

const toItems = (names) => names.map((name, value) => ({ name, value }));

// Shapes merged with their cells offset: polylines or flat triangles
const merge = (...shapes) => {
  let offset = 0;
  const cells = [];
  for (const shape of shapes) {
    const isFlat = typeof shape.cells[0] === "number";
    for (const cell of shape.cells) {
      cells.push(isFlat ? cell + offset : Array.from(cell, (i) => i + offset));
    }
    offset += shape.positions.length / 3;
  }
  return {
    positions: Float32Array.from(
      shapes.flatMap(({ positions }) => [...positions]),
    ),
    cells: typeof cells[0] === "number" ? Uint32Array.from(cells) : cells,
  };
};

// All in the XY plane, swept along the path tangent
const SHAPES = {
  circle: () => circlePath({ closed: true }),
  square: () => squarePath({ closed: true }),
  star: () => starPath({ closed: true }),
  cross: () => crossPath({ closed: true }),
  "annulus (hole)": () => annulusPath({ closed: true }),
  "nested annulus": () =>
    merge(
      annulusPath({ closed: true }),
      annulusPath({ closed: true, radius: 0.15, innerRadius: 0.075 }),
    ),
  "nested annulus (triangles)": () =>
    merge(annulus(), annulus({ radius: 0.15, innerRadius: 0.075 })),
  "disc (triangles)": () => disc(),
  "star (open)": () => starPath(),
  "arc (open)": () => circlePath({ theta: Math.PI }),
};

const PATHS = {
  circle: {
    loop: true,
    points: () =>
      Array.from({ length: 50 }, (_, i) => {
        const t = (i / 50) * 2 * Math.PI;
        return [Math.cos(t), Math.sin(t), 0];
      }),
  },
  knot: {
    loop: true,
    points: () =>
      Array.from({ length: 64 }, (_, i) => {
        const t = (Math.PI * 2 * i) / 64;
        return [
          (10 * (Math.cos(t) + Math.cos(3 * t)) +
            Math.cos(2 * t) +
            Math.cos(4 * t)) /
            10,
          (6 * Math.sin(t) + 10 * Math.sin(3 * t)) / 10,
          (4 * Math.sin(3 * t) * Math.sin((5 * t) / 2) +
            4 * Math.sin(4 * t) -
            2 * Math.sin(6 * t)) /
            10,
        ];
      }),
  },
  helix: {
    loop: false,
    points: () =>
      Array.from({ length: 48 }, (_, i) => {
        const t = (Math.PI * 6 * i) / 47;
        return [Math.cos(t), (i / 47) * 2 - 1, Math.sin(t)];
      }),
  },
};

const CLOSED = ["auto", true, false];

const FRAME_MODES = ["bishop", "frenet"];

const State = {
  closed: 0,
  closedShape: 0,
  capStart: true,
  capEnd: true,
  withFrames: true,
  frameMode: 0,
  twist: 0,
  // primitive-geometry shapes fit a unit square
  radius: 0.2,

  taper: false,
  smoothPath: true,
  shape: 2,
  shapes: Object.keys(SHAPES),
  path: 2,
  paths: Object.keys(PATHS),

  frame: 0,
  frames: ["none", "path", "swept"],
  mode: 0,
  shadings: ["simple lighting", "normals", "standard derivative", "uvs"],
  wireframe: false,
};

const ctx = await gpu.createContext();

const camera = createCamera({
  fov: Math.PI / 3,
  aspect: ctx.width / ctx.height,
  near: 0.1,
  far: 100,
  position: [0, 0, 4],
});
createOrbiter({ camera, element: ctx.canvas });

const projection = mat4.create();

const shader = /* wgsl */ `
struct Uniforms {
  projection: mat4x4f,
  view: mat4x4f,
  mode: f32,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexIn {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
}
struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
}

@vertex
fn vertexMain(input: VertexIn) -> VertexOut {
  var output: VertexOut;
  output.worldPosition = input.position;
  output.normal = input.normal;
  output.uv = input.uv;
  output.position = uniforms.projection * uniforms.view * vec4f(input.position, 1.0);
  return output;
}

@fragment
fn fragmentMain(input: VertexOut, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4f {
  let normal = normalize(input.normal);
  var color = normal * 0.5 + 0.5;
  if (uniforms.mode == 0.0) {
    let lambert = max((dot(normal, normalize(vec3f(1.0, -1.0, 1.0))) + 0.1) / 1.1, 0.0);
    color = pow(vec3f(0.1) + lambert * pow(color, vec3f(2.2)), vec3f(1.0 / 2.2));
  } else if (uniforms.mode == 2.0) {
    // Face normal from the triangle winding: disagrees with flipped normals.
    // WebGPU framebuffer y points down, reversing dpdy compared to WebGL.
    let faceNormal = normalize(cross(dpdy(input.worldPosition), dpdx(input.worldPosition)));
    color = faceNormal * 0.5 + 0.5;
  } else if (uniforms.mode == 3.0) {
    color = vec3f(input.uv, 0.0);
  }
  // Back faces show through open shapes and inside-out solids
  if (!frontFacing) {
    color = mix(color, vec3f(1.0, 0.0, 0.0), 0.6);
  }
  return vec4f(color, 1.0);
}
`;

const lineShader = /* wgsl */ `
struct Uniforms {
  projection: mat4x4f,
  view: mat4x4f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
}

@vertex
fn vertexMain(@location(0) position: vec3f, @location(1) color: vec3f) -> VertexOut {
  var output: VertexOut;
  output.color = color;
  output.position = uniforms.projection * uniforms.view * vec4f(position, 1.0);
  return output;
}

@fragment
fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  return vec4f(input.color, 1.0);
}
`;

const wireframeShader = /* wgsl */ `
struct Uniforms {
  projection: mat4x4f,
  view: mat4x4f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vertexMain(@location(0) position: vec3f) -> @builtin(position) vec4f {
  return uniforms.projection * uniforms.view * vec4f(position, 1.0);
}

@fragment
fn fragmentMain() -> @location(0) vec4f {
  return vec4f(1.0);
}
`;

const pass = { clearValue: [0.2, 0.2, 0.2, 1], depthClearValue: 1 };

const drawMesh = gpu.defineCommand({
  label: "drawMesh",
  pipeline: {
    shader,
    depthWriteEnabled: true,
    cullMode: "none",
    // Pushed back so the lines win the depth test: WebGPU only biases
    // triangles
    depthBias: 1,
    depthBiasSlopeScale: 1,
  },
  uniforms: { projection, view: camera.viewMatrix, mode: State.mode },
});

const linePipeline = {
  shader: lineShader,
  topology: "line-list",
  depthWriteEnabled: true,
};
const lineUniforms = { projection, view: camera.viewMatrix };
const drawWireframe = gpu.defineCommand({
  label: "drawWireframe",
  pipeline: { ...linePipeline, shader: wireframeShader },
  uniforms: lineUniforms,
});
const drawFrames = gpu.defineCommand({
  label: "drawFrames",
  pipeline: linePipeline,
  uniforms: lineUniforms,
});

const FRAME_COLORS = {
  tangents: [1, 0, 0],
  normals: [0, 1, 0],
  binormals: [0, 0, 1],
};

const getFrameLines = ({ positions, ...frames }, scale) => {
  const count = positions.length / 3;
  const lines = new Float32Array(count * 6 * 3);
  const colors = new Float32Array(count * 6 * 3);
  let vertex = 0;
  for (const [name, color] of Object.entries(FRAME_COLORS)) {
    if (!frames[name]) continue;
    for (let i = 0; i < count; i++) {
      avec3.set(lines, vertex, positions, i);
      avec3.set(lines, vertex + 1, positions, i);
      avec3.addScaled(lines, vertex + 1, frames[name], i, scale);
      avec3.set(colors, vertex, color, 0);
      avec3.set(colors, vertex + 1, color, 0);
      vertex += 2;
    }
  }
  return {
    position: lines.subarray(0, vertex * 3),
    color: colors.subarray(0, vertex * 3),
  };
};

const createVertexBuffers = (data) =>
  Object.fromEntries(
    Object.entries(data).map(([name, array]) => [
      name,
      gpu.createBuffer(ctx, { usage: "vertex", data: array }),
    ]),
  );

const disposeBuffers = (cmd) => {
  for (const buffer of [...Object.values(cmd.attributes ?? {}), cmd.indices]) {
    buffer?.[Symbol.dispose]();
  }
  cmd.attributes = undefined;
  cmd.indices = undefined;
};

const updateGeometry = () => {
  const { loop, points } = PATHS[State.paths[State.path]];
  const smoothPath = State.smoothPath
    ? splinePoints(points(), { segmentLength: 0.1, closed: loop })
    : points();
  // Closed by repeating the first point, as "auto" expects
  const path = loop ? [...smoothPath, smoothPath[0]] : smoothPath;

  const geometry = {
    positions: new Float32Array(path.flat()),
  };
  // x radius oscillating from 0 to 1 along the path, y radius constant
  if (State.taper) {
    geometry.radii = Float32Array.from({ length: path.length * 2 }, (_, i) =>
      i % 2 ? 1 : 0.5 + 0.5 * Math.sin((i / 2 / path.length) * Math.PI * 4),
    );
  }
  const closed = CLOSED[State.closed];
  const frameOptions = {
    mode: FRAME_MODES[State.frameMode],
    twist: State.twist,
    initialNormal: State.paths[State.path] === "circle" ? [0, 0, 1] : null,
  };

  console.time("Sweeping time");
  const sweptGeometry = sweep(geometry, SHAPES[State.shapes[State.shape]](), {
    radius: [State.radius, State.radius],
    closed,
    closedShape: CLOSED[State.closedShape],
    capStart: State.capStart,
    capEnd: State.capEnd,
    withFrames: State.withFrames,
    frameOptions,
  });
  console.timeEnd("Sweeping time");
  console.log(sweptGeometry);

  // Wireframe shares the mesh position buffer
  disposeBuffers(drawMesh);
  drawWireframe.indices?.[Symbol.dispose]();
  disposeBuffers(drawFrames);

  drawMesh.attributes = createVertexBuffers({
    position: sweptGeometry.positions,
    normal: sweptGeometry.normals,
    uv: sweptGeometry.uvs,
  });
  drawMesh.indices = gpu.createBuffer(ctx, {
    usage: "index",
    data: sweptGeometry.cells,
  });

  drawWireframe.attributes = { position: drawMesh.attributes.position };
  drawWireframe.indices = gpu.createBuffer(ctx, {
    usage: "index",
    data: Uint32Array.from(edges(sweptGeometry.cells).flat()),
  });

  // sweep doesn't write frames to the path: compute them for display, from
  // the same points and options, the repeated first point dropped if closed
  if (State.frames[State.frame] !== "none") {
    const isClosed = closed === "auto" ? loop : closed;
    const frames =
      State.frames[State.frame] === "swept"
        ? sweptGeometry
        : computeFrenetSerretFrames(
            {
              positions: new Float32Array(
                (loop && isClosed ? smoothPath : path).flat(),
              ),
            },
            { ...frameOptions, closed: isClosed },
          );
    drawFrames.attributes = createVertexBuffers(
      // As long as the swept shape radius
      getFrameLines(frames, State.radius * 0.5),
    );
  }
};

updateGeometry();

const gui = createGUI(ctx);
gui.addColumn("Sweep Options");
gui.addRadioList(
  "closed",
  State,
  "closed",
  toItems(CLOSED.map(String)),
  updateGeometry,
);
gui.addRadioList(
  "closedShape",
  State,
  "closedShape",
  toItems(CLOSED.map(String)),
  updateGeometry,
);
gui.addParam("capStart", State, "capStart", undefined, updateGeometry);
gui.addParam("capEnd", State, "capEnd", undefined, updateGeometry);
gui.addParam("withFrames", State, "withFrames", undefined, updateGeometry);
gui.addRadioList(
  "frameOptions.mode",
  State,
  "frameMode",
  toItems(FRAME_MODES),
  updateGeometry,
);
gui.addParam(
  "frameOptions.twist",
  State,
  "twist",
  { min: -Math.PI * 2, max: Math.PI * 2 },
  updateGeometry,
);
gui.addParam("radius", State, "radius", { min: 0, max: 1 }, updateGeometry);

gui.addColumn("Example Options");
gui.addRadioList(
  "Shape",
  State,
  "shape",
  toItems(State.shapes),
  updateGeometry,
);
gui.addRadioList("Path", State, "path", toItems(State.paths), updateGeometry);
gui.addParam("taper", State, "taper", undefined, updateGeometry);
gui.addParam("smoothPath", State, "smoothPath", undefined, updateGeometry);

gui.addColumn("Rendering");
gui.addRadioList(
  "Frames",
  State,
  "frame",
  toItems(State.frames),
  updateGeometry,
);
gui.addRadioList("Mode", State, "mode", toItems(State.shadings));
gui.addParam("wireframe", State, "wireframe");

window.addEventListener("resize", () => {
  gpu.resize(ctx, window.innerWidth, window.innerHeight);
});

window.addEventListener("keydown", ({ key }) => {
  if (key === "g") gui.enabled = !gui.enabled;
});

gpu.frame(ctx, () => {
  mat4.perspectiveZO(
    projection,
    camera.fov,
    ctx.width / ctx.height,
    camera.near,
    camera.far,
  );
  drawMesh.uniforms.mode = State.mode;

  gpu.submit(ctx, { pass }, () => {
    gpu.submit(ctx, drawMesh);
    if (State.wireframe) gpu.submit(ctx, drawWireframe);
    if (State.frames[State.frame] !== "none") gpu.submit(ctx, drawFrames);
    gui.draw();
  });
});
