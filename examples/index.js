import sweep from "../index.js";

import createContext from "pex-context";
import { vec3, mat4 } from "pex-math";
import createGUI from "pex-gui";
import { perspective as createCamera, orbiter as createOrbiter } from "pex-cam";
import splinePoints from "spline-points";

const State = {
  closed: true,
  closedShape: true,
  caps: true,
  radius: 0.1,

  taper: false,
  smoothPath: true,
  shape: 0,
  shapes: ["square", "star"],
  path: 1,
  paths: ["circle", "knot"],

  debug: true,
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

      shape.push([r * Math.sin(t), r * Math.cos(t)]);
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

  const g = sweep(smoothPath, shape, {
    ...State,
    radius,
    // initialNormal: [-1, 0, 0],
  });
  const isTypedArray = !Array.isArray(g.cells);
  console.log(g);

  cmdOptions = {
    attributes: {
      aPosition: ctx.vertexBuffer(g.positions),
      aNormal: ctx.vertexBuffer(g.normals),
      aUv: ctx.vertexBuffer(g.uvs),
    },
    indices: ctx.indexBuffer(g.cells),
  };

  // Frame lines
  const positions = [];
  const colors = [];
  const red = [1, 0, 0, 1];
  const green = [0, 1, 0, 1];
  const blue = [0, 0, 1, 1];

  if (State.debug) {
    path.forEach((p, i) => {
      positions.push(
        p,
        vec3.add(
          vec3.copy(p),
          vec3.scale(vec3.copy(g.frames[i].tangent), State.radius * 2)
        ),
        p,
        vec3.add(
          vec3.copy(p),
          vec3.scale(vec3.copy(g.frames[i].normal), State.radius * 2)
        ),
        p,
        vec3.add(
          vec3.copy(p),
          vec3.scale(vec3.copy(g.frames[i].binormal), State.radius * 2)
        )
      );
      colors.push(red, red, green, green, blue, blue);
    });
  }
  cmdLineOptions = {
    attributes: {
      aPosition: ctx.vertexBuffer(positions),
      aColor: ctx.vertexBuffer(colors),
    },
    count: positions.length,
  };
};

updateGeometry();

const gui = createGUI(ctx);
gui.addColumn("Sweep Options");
gui.addParam("closed", State, "closed", undefined, updateGeometry);
gui.addParam("closedShape", State, "closedShape", undefined, updateGeometry);
gui.addParam("caps", State, "caps", undefined, updateGeometry);
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

gui.addColumn("Rendering");
gui.addParam("debug", State, "debug", undefined, updateGeometry);
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
    // primitive: ctx.Primitive.Lines,
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
  if (State.debug) ctx.submit(drawLine, cmdLineOptions);

  gui.draw();
});

window.addEventListener("keydown", ({ key }) => {
  if (key === "g") gui.enabled = !gui.enabled;
});
