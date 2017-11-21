'use strict'
const gl = require('pex-gl')()
const regl = require('regl')(gl)
const Mat4 = require('pex-math/Mat4')
const glsl = require('glslify')
const splitVertices = require('geom-split-vertices')
const normals = require('geom-normals')
const camera = require('pex-cam/perspective')({
  fov: Math.PI / 3,
  aspect: gl.canvas.width / gl.canvas.height,
  near: 0.1,
  far: 100,
  position: [0, 0, 4]
})
require('pex-cam/orbiter')({ camera: camera })
const createLoft = require('../')
const computeNormals = require('angle-normals')
const triangulate = require('geom-triangulate')
const splinePoints = require('../../spline-points')

const modelMatrix = Mat4.create()

const shape = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
// const shape = [
  // [-1, -1], [0, -1], [0, -0.5], [1, -0.5],
  // [1, 0.5], [0, 0.5], [0, 1], [-1, 1]
// ]

const path = []
for (var i = 0; i < 10; i++) {
  path.push([0.3 * Math.sin(i / 10 * 4 * Math.PI), 2 * (i / 10 - 0.5), 0.3 * Math.cos(i / 10 * 4 * Math.PI)])
}


var n = 64
path.length = 0
for (var i = 0; i < n; i++) {
  var t = Math.PI * 2 * i / n
  var x = 10 * (Math.cos(t) + Math.cos(3 * t)) + Math.cos(2 * t) + Math.cos(4 * t)
  var y = 6 * Math.sin(t) + 10 * Math.sin(3 * t)
  var z = 4 * Math.sin(3 * t) * Math.sin(5 * t / 2) + 4 * Math.sin(4 * t) - 2 * Math.sin(6 * t)
  var s = 1 / 10
  path.push([x * s, y * s, z * s])
}

const smoothPath = splinePoints(path, { segmentLength: 1 / 5, closed: true })
// let radius = smoothPath.map((p, i, points) => [ 0.08 + 0.07 * Math.sin(i / points.length * Math.PI * 4), 0.05])

// let g = createLoft(smoothPath, shape, { caps: true, radius: radius })
let g = createLoft(path, shape, { radius: 0.1, closed: true })
// let g = createLoft(smoothPath, shape, { radius: 0.1, closed: true })
g.cells = triangulate(g.cells)

const line = {
  positions: g.debugLines
}

// g = splitVertices(g)
// g.normals = normals(g.positions, g.cells)

const drawMesh = regl({
  attributes: {
    aPosition: g.positions,
    // aNormal: g.positions,
    aNormal: computeNormals(g.cells, g.positions),
    aTexCoord: g.uvs
  },
  elements: g.cells,
  // count: g.positions.length,
  // primitive: 'lines',
  vert: glsl`
    #ifdef GL_ES
    #pragma glslify: transpose = require(glsl-transpose)
    #endif
    #pragma glslify: inverse = require(glsl-inverse)

    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec2 aTexCoord;

    uniform mat4 uProjectionMatrix;
    uniform mat4 uViewMatrix;
    uniform mat4 uModelMatrix;

    varying vec3 vNormal;
    varying vec2 vTexCoord;

    void main () {
      mat4 modelViewMatrix = uViewMatrix * uModelMatrix;
      mat3 normalMatrix = mat3(transpose(inverse(modelViewMatrix)));
      vNormal = normalMatrix * aNormal;
      vTexCoord = aTexCoord;
      gl_Position = uProjectionMatrix * modelViewMatrix * vec4(aPosition, 1.0);
    }
  `,
  frag: `
    #ifdef GL_ES
    precision highp float;
    #endif

    varying vec3 vNormal;
    varying vec2 vTexCoord;

    void main () {
      gl_FragColor.rgb = vNormal * 0.5 + 0.5;
      gl_FragColor.rgb = vec3(vTexCoord.xy, 0.0);
      // gl_FragColor = vec4(1.0, 1.0, 0.0, 1.0);
      gl_FragColor.a = 1.0;
    }
  `,
  uniforms: {
    uProjectionMatrix: () => camera.projectionMatrix,
    uViewMatrix: () => camera.viewMatrix,
    uModelMatrix: modelMatrix
  }
})

const drawLine = regl({
  attributes: {
    aPosition: line.positions
  },
  primitive: 'line',
  count: line.positions.length,
  depth: {
    enable: false
  },
  vert: glsl`
    attribute vec3 aPosition;

    uniform mat4 uProjectionMatrix;
    uniform mat4 uViewMatrix;
    uniform mat4 uModelMatrix;

    void main () {
      mat4 modelViewMatrix = uViewMatrix * uModelMatrix;
      gl_Position = uProjectionMatrix * modelViewMatrix * vec4(aPosition, 1.0);
    }
  `,
  frag: `
    #ifdef GL_ES
    precision highp float;
    #endif

    uniform vec4 uColor;

    void main () {
      gl_FragColor.rgb = uColor.rgb;
      gl_FragColor.a = 1.0;
    }
  `,
  uniforms: {
    uProjectionMatrix: () => camera.projectionMatrix,
    uViewMatrix: () => camera.viewMatrix,
    uModelMatrix: Mat4.create(),
    uColor: [1, 0, 0, 1]
  }
})

regl.frame(() => {
  regl.clear({
    color: [0, 0, 0, 1],
    depth: 1
  })
  drawMesh()
  // drawLine()
})
