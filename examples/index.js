import sweep from "../index.js";

import createContext from "pex-context";
import { avec3, avec4, mat4 } from "pex-math";
import createGUI from "pex-gui";
import { perspective as createCamera, orbiter as createOrbiter } from "pex-cam";
import splinePoints from "spline-points";

const State = {
  closed: false,
  closedShape: true,
  caps: false,
  withFrames: true,
  radius: 0.1,

  taper: false,
  smoothPath: true,
  typedArray: true,
  shape: 0,
  shapes: ["square", "star"],
  path: 1,
  paths: ["circle", "knot"],

  frame: 0,
  frames: ["none", "path", "swept"],
  mode: 2,
  shadings: ["normals", "simple lighting", "standard derivative", "uvs"],
};

const ctx = createContext({
  type: "webgl",
  element: document.querySelector("main"),
  pixelRatio: devicePixelRatio,
});
const camera = createCamera({
  fov: Math.PI / 3,
  aspect: ctx.gl.drawingBufferWidth / ctx.gl.drawingBufferHeight,
  near: 0.1,
  far: 100,
  position: [0, 0, 4],
});
const orbiter = createOrbiter({ camera });

let cmdOptions = {};
let cmdLineOptions = {};

const segmentLength = 1 / 10;

const updateGeometry = () => {
  // Shape
  let shape = [];

  if (State.shapes[State.shape] === "square") {
    shape = [
      [1, 1, 0],
      [-1, 1, 0],
      [-1, -1, 0],
      [1, -1, 0],
    ];
  } else if (State.shapes[State.shape] === "star") {
    const starBranchCount = 5;
    for (let i = 0; i < starBranchCount * 2; i++) {
      const r = (2 * ((i % 2) + 1)) / 2;
      const t = (Math.PI * 2 * i) / (starBranchCount * 2);

      shape.push([r * Math.sin(t), r * Math.cos(t), 0]);
    }
  }

  // Path
  let path = [];

  if (State.paths[State.path] === "circle") {
    for (let i = 0; i < 50; i++) {
      path.push([
        Math.cos((i / 50) * 2 * Math.PI),
        Math.sin((i / 50) * 2 * Math.PI),
        0,
      ]);
      // path.push([
      //   0.3 * Math.sin((i / 10) * 4 * Math.PI),
      //   2 * (i / 10 - 0.5),
      //   0.3 * Math.cos((i / 10) * 4 * Math.PI),
      // ]);
    }
  } else if (State.paths[State.path] === "knot") {
    const n = 64;
    for (var i = 0; i < n; i++) {
      const t = (Math.PI * 2 * i) / n;
      const x =
        10 * (Math.cos(t) + Math.cos(3 * t)) +
        Math.cos(2 * t) +
        Math.cos(4 * t);
      const y = 6 * Math.sin(t) + 10 * Math.sin(3 * t);
      const z =
        4 * Math.sin(3 * t) * Math.sin((5 * t) / 2) +
        4 * Math.sin(4 * t) -
        2 * Math.sin(6 * t);
      path.push([x * segmentLength, y * segmentLength, z * segmentLength]);
    }
  }

  const smoothPath = State.smoothPath
    ? splinePoints(path, { segmentLength, closed: true })
    : path;
  const radius = State.taper
    ? smoothPath.map((p, i, points) => [
        State.radius / 2 +
          (State.radius / 2) * Math.sin((i / points.length) * Math.PI * 4),
        State.radius,
      ])
    : State.radius;

  const geometry = {
    positions: State.typedArray
      ? new Float32Array(smoothPath.flat())
      : smoothPath,
  };
  console.time("Sweeping time");
  const sweptGeometry = sweep(geometry, shape, {
    ...State,
    radius,
    initialNormal: State.paths[State.path] === "circle" && [0, 0, 1],
  });
  console.timeEnd("Sweeping time");
  console.log(sweptGeometry);

  cmdOptions = {
    attributes: {
      aPosition: ctx.vertexBuffer(sweptGeometry.positions),
      aNormal: ctx.vertexBuffer(sweptGeometry.normals),
      aUv: ctx.vertexBuffer(sweptGeometry.uvs),
    },
    indices: ctx.indexBuffer(sweptGeometry.cells),
  };

  // Frame lines
  if (State.frames[State.frame] !== "none") {
    const g = State.frames[State.frame] === "swept" ? sweptGeometry : geometry;
    const size = g.positions.length / 3;
    const tnbBuffer = new Float32Array(size * 3 * 6);
    const colorBuffer = new Float32Array(size * 4 * 6);
    const frameScale = State.radius * 2;
    for (let i = 0; i < size; i++) {
      avec3.set(tnbBuffer, i * 6 + 2, g.positions, i);
      avec3.set(tnbBuffer, i * 6 + 3, g.positions, i);
      avec3.addScaled(tnbBuffer, i * 6 + 3, g.normals, i, frameScale);

      if (g.tangents) {
        avec3.set(tnbBuffer, i * 6, g.positions, i);
        avec3.set(tnbBuffer, i * 6 + 1, g.positions, i);
        avec3.addScaled(tnbBuffer, i * 6 + 1, g.tangents, i, frameScale);
      }
      if (g.binormals) {
        avec3.set(tnbBuffer, i * 6 + 4, g.positions, i);
        avec3.set(tnbBuffer, i * 6 + 5, g.positions, i);
        avec3.addScaled(tnbBuffer, i * 6 + 5, g.binormals, i, frameScale);
      }

      avec4.set(colorBuffer, i * 6 + 0, [1, 0, 0, 1], 0);
      avec4.set(colorBuffer, i * 6 + 1, [0.5, 0, 0, 1], 0);
      avec4.set(colorBuffer, i * 6 + 2, [0, 1, 0, 1], 0);
      avec4.set(colorBuffer, i * 6 + 3, [0, 0.5, 0, 1], 0);
      avec4.set(colorBuffer, i * 6 + 4, [0, 0, 1, 1], 0);
      avec4.set(colorBuffer, i * 6 + 5, [0, 0, 0.5, 1], 0);
    }
    cmdLineOptions = {
      attributes: {
        aPosition: ctx.vertexBuffer(tnbBuffer),
        aColor: ctx.vertexBuffer(colorBuffer),
      },
      count: size * 6,
    };
  }
};

updateGeometry();

const gui = createGUI(ctx);
gui.addColumn("Sweep Options");
gui.addParam("closed", State, "closed", undefined, updateGeometry);
gui.addParam("closedShape", State, "closedShape", undefined, updateGeometry);
gui.addParam("caps", State, "caps", undefined, updateGeometry);
gui.addParam("withFrames", State, "withFrames", undefined, updateGeometry);
gui.addParam("radius", State, "radius", { min: 0, max: 0.5 }, updateGeometry);

gui.addColumn("Example Options");
gui.addRadioList(
  "Shape",
  State,
  "shape",
  State.shapes.map((name, value) => ({ name, value })),
  updateGeometry
);
gui.addRadioList(
  "Path",
  State,
  "path",
  State.paths.map((name, value) => ({ name, value })),
  updateGeometry
);
gui.addParam("taper", State, "taper", undefined, updateGeometry);
gui.addParam("smoothPath", State, "smoothPath", undefined, updateGeometry);
gui.addParam("typedArray", State, "typedArray", undefined, updateGeometry);

gui.addColumn("Rendering");
gui.addRadioList(
  "Frames",
  State,
  "frame",
  State.frames.map((name, value) => ({ name, value })),
  updateGeometry
);
gui.addRadioList(
  "Mode",
  State,
  "mode",
  State.shadings.map((name, value) => ({ name, value }))
);

const modelMatrix = mat4.create();

const drawMesh = {
  pipeline: ctx.pipeline({
    depthTest: true,
    // cullFace: true,
    vert: /* glsl */ `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;

uniform mat4 uProjectionMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uModelMatrix;
uniform mat4 uInvViewMatrix;

varying vec3 vPositionWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying vec4 vColor;

void main () {
  mat4 modelViewMatrix = uViewMatrix * uModelMatrix;
  vPositionWorld = (uModelMatrix * vec4(aPosition, 1.0)).xyz;
  vNormal = aNormal;
  vColor = vec4(aNormal * 0.5 + 0.5, 1.0);
  vUv = aUv;
  gl_Position = uProjectionMatrix * modelViewMatrix * vec4(aPosition, 1.0);
}`,
    frag: /* glsl */ `#extension GL_OES_standard_derivatives : enable
precision highp float;

uniform float uMode;

varying vec3 vPositionWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying vec4 vColor;

const float gamma = 2.2;
vec3 toLinear(vec3 v) {
  return pow(v, vec3(gamma));
}
vec3 toGamma(vec3 v) {
  return pow(v, vec3(1.0 / gamma));
}

void main () {
  if (uMode == 0.0) gl_FragColor = vColor;

  if (uMode == 1.0) {
    vec3 ambientColor = vec3(0.1, 0.1, 0.1);
    vec3 lightPos = vec3(1.0, -1.0, 1.0);
    float uWrap = 0.1;

    vec3 L = normalize(lightPos);
    vec3 N = normalize(vNormal);
    float NdotL = max(0.0, (dot(N, L) + uWrap) / (1.0 + uWrap));
    vec3 ambient = toLinear(ambientColor.rgb);
    vec3 diffuse = toLinear(vColor.rgb);

    gl_FragColor = vec4(toGamma(ambient + NdotL * diffuse), 1.0);
  }

  if (uMode == 2.0) {
    vec3 fdx = vec3(dFdx(vPositionWorld.x), dFdx(vPositionWorld.y), dFdx(vPositionWorld.z));
    vec3 fdy = vec3(dFdy(vPositionWorld.x), dFdy(vPositionWorld.y), dFdy(vPositionWorld.z));
    vec3 normal = normalize(cross(fdx, fdy));
    gl_FragColor = vec4(normal * 0.5 + 0.5, 1.0);
  }

  if (uMode == 3.0) gl_FragColor = vec4(vUv.xy, 0.0, 1.0);
}
    `,
  }),
  uniforms: {
    uProjectionMatrix: camera.projectionMatrix,
    uViewMatrix: camera.viewMatrix,
    uModelMatrix: modelMatrix,
    uMode: 2,
  },
};

const drawLine = {
  pipeline: ctx.pipeline({
    depthTest: true,
    vert: /* glsl */ `
attribute vec3 aPosition;
attribute vec4 aColor;

uniform mat4 uProjectionMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uModelMatrix;

varying vec4 vColor;

void main () {
  vColor = aColor;
  mat4 modelViewMatrix = uViewMatrix * uModelMatrix;
  gl_Position = uProjectionMatrix * modelViewMatrix * vec4(aPosition, 1.0);
}`,
    frag: /* glsl */ `
precision highp float;

varying vec4 vColor;

void main () {
  gl_FragColor.rgb = vColor.rgb;
  gl_FragColor.a = 1.0;
}`,
    primitive: ctx.Primitive.Lines,
  }),
  uniforms: {
    uProjectionMatrix: camera.projectionMatrix,
    uViewMatrix: camera.viewMatrix,
    uInvViewMatrix: camera.invViewMatrix,
    uModelMatrix: mat4.create(),
  },
};

const clearCmd = {
  pass: ctx.pass({
    clearColor: [0.2, 0.2, 0.2, 1],
    clearDepth: 1,
  }),
};

ctx.frame(() => {
  ctx.submit(clearCmd);
  ctx.submit(drawMesh, {
    ...cmdOptions,
    uniforms: {
      uMode: State.mode,
    },
  });
  if (State.frames[State.frame] !== "none") {
    ctx.submit(drawLine, cmdLineOptions);
  }

  gui.draw();
});

window.addEventListener("keydown", ({ key }) => {
  if (key === "g") gui.enabled = !gui.enabled;
});
