'use strict'
const glsl = require('glslify')

const ctx = require('pex-context')()
const mat4 = require('pex-math/mat4')
const createCamera = require('pex-cam/perspective')
const createOrbiter = require('pex-cam/orbiter')

const splitVertices = require('geom-split-vertices')
const normals = require('geom-normals')
const computeNormals = require('angle-normals')
const triangulate = require('geom-triangulate')
const splinePoints = require('spline-points')

const sweep = require('../')

const camera = createCamera({
  fov: Math.PI / 3,
  aspect: ctx.gl.drawingBufferWidth / ctx.gl.drawingBufferHeight,
  near: 0.1,
  far: 100,
  position: [0, 0, 4]
})
const orbiter = createOrbiter({ camera: camera })

const modelMatrix = mat4.create()

let shape = [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]]
// shape = splinePoints(shape, { segmentLength: 0.1, closed: true })
// const shape = [
// [-1, -1], [0, -1], [0, -0.5], [1, -0.5],
// [1, 0.5], [0, 0.5], [0, 1], [-1, 1]
// ]
let path = []
for (var i = 0; i < 10; i++) {
  path.push([0.3 * Math.sin((i / 10) * 4 * Math.PI), 2 * (i / 10 - 0.5), 0.3 * Math.cos((i / 10) * 4 * Math.PI)])
}

var n = 64
path.length = 0
for (var i = 0; i < n; i++) {
  var t = (Math.PI * 2 * i) / n
  var x = 10 * (Math.cos(t) + Math.cos(3 * t)) + Math.cos(2 * t) + Math.cos(4 * t)
  var y = 6 * Math.sin(t) + 10 * Math.sin(3 * t)
  var z = 4 * Math.sin(3 * t) * Math.sin((5 * t) / 2) + 4 * Math.sin(4 * t) - 2 * Math.sin(6 * t)
  var s = 1 / 10
  path.push([x * s, y * s, z * s])
}

// path.push(path[0])
const smoothPath = splinePoints(path, { segmentLength: 1 / 10, closed: true })
// let radius = smoothPath.map((p, i, points) => [ 0.08 + 0.07 * Math.sin(i / points.length * Math.PI * 4), 0.05])

// let g = createLoft(smoothPath, shape, { caps: true, radius: radius })
// let g = sweep(path, shape, { radius: 0.1, closed: false })
let g = sweep(smoothPath, shape, { radius: 0.1, closed: true, closedShape: true, caps: false, debug: true })
g.cells = triangulate(g.cells)

const line = {
  positions: g.debugLines
}

// console.log('g', g)
g = splitVertices(g)
g.normals = normals(g.positions, g.cells)
g.uvs = g.normals.map(() => [0, 0])

const drawMesh = {
  pipeline: ctx.pipeline({
    depthTest: true,
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
        // gl_FragColor.rgb = vec3(vTexCoord.xy, 0.0);
        // gl_FragColor = vec4(1.0, 1.0, 0.0, 1.0);
        gl_FragColor.a = 1.0;
      }
    `
  }),
  uniforms: {
    uProjectionMatrix: camera.projectionMatrix,
    uViewMatrix: camera.viewMatrix,
    uModelMatrix: modelMatrix
  },
  attributes: {
    aPosition: ctx.vertexBuffer(g.positions),
    // aNormal: ctx.vertexBuffer(g.positions),
    aNormal: ctx.vertexBuffer(computeNormals(g.cells, g.positions)),
    // aNormal: ctx.vertexBuffer(g.normals),
    aTexCoord: ctx.vertexBuffer(g.uvs)
  },
  indices: ctx.indexBuffer(g.cells)
  // count: g.positions.length,
  // primitive: 'lines',
}

const drawLine = {
  pipeline: ctx.pipeline({
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
    primitive: ctx.Primitive.Lines,
    depthTest: false
  }),
  attributes: {
    aPosition: ctx.vertexBuffer(line.positions)
  },
  count: line.positions.length,
  uniforms: {
    uProjectionMatrix: camera.projectionMatrix,
    uViewMatrix: camera.viewMatrix,
    uModelMatrix: mat4.create(),
    uColor: [1, 0, 0, 1]
  }
}

const clearCmd = {
  pass: ctx.pass({
    clearColor: [0, 0, 0, 1],
    clearDepth: 1
  })
}

ctx.frame(() => {
  ctx.submit(clearCmd)
  ctx.submit(drawMesh)
  // ctx.submit(drawLine)
})
