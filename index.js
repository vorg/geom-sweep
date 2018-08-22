const vec3 = require('pex-math/vec3')
const mat4 = require('pex-math/mat4')
const quat = require('pex-math/quat')
const clamp = require('pex-math/utils').clamp
const toDegrees = require('pex-math/utils').toDegrees
var EPSILON = 0.00001

function sweep (path, shapePath, options) {
  options = options || { }

  const dist = vec3.distance(path[0], path[path.length - 1])
  const isClosed = dist < EPSILON || options.closed
  let isShapeClosed = (options.closedShape !== undefined) ? options.closedShape : true
  if (shapePath.length == 2) isShapeClosed = false
  const caps = options.caps && !isClosed
  const tangents = path.map((point, i, points) => {
    if (isClosed) {
      const nextPoint = (i < points.length - 1) ? points[i + 1] : points[1]
      return vec3.normalize(vec3.sub(vec3.copy(nextPoint), point))
    } else {
      if (i < points.length - 1) {
        const nextPoint = points[i + 1]
        return vec3.normalize(vec3.sub(vec3.copy(nextPoint), point))
      } else {
        const prevPoint = points[i - 1]
        return vec3.normalize(vec3.sub(vec3.copy(point), prevPoint))
      }
    }
  })
  const frames = makeFrames(path, tangents, isClosed)
  const g = buildGeometry(frames, shapePath, caps, options.radius, isClosed, isShapeClosed)
  g.debugLines = []

  path.forEach((p, i) => {
    g.debugLines.push(p)
    g.debugLines.push(vec3.add(vec3.copy(p), vec3.scale(vec3.copy(frames[i].tangent), 0.2)))
    g.debugLines.push(p)
    g.debugLines.push(vec3.add(vec3.copy(p), vec3.scale(vec3.copy(frames[i].normal), 0.2)))
    g.debugLines.push(p)
    g.debugLines.push(vec3.add(vec3.copy(p), vec3.scale(vec3.copy(frames[i].binormal), 0.2)))
  })

  return g
}

function makeFrames (points, tangents, closed, rot) {
  if (rot == null) {
    rot = 0
  }
  let tangent = tangents[0]
  const atx = Math.abs(tangent[0])
  const aty = Math.abs(tangent[1])
  const atz = Math.abs(tangent[2])
  let v = null
  if (atz > atx && atz >= aty) {
    v = vec3.cross(vec3.copy(tangent), [0, 1, 0])
  } else if (aty > atx && aty >= atz) {
    v = vec3.cross(vec3.copy(tangent), [1, 0, 0])
  } else {
    v = vec3.cross(vec3.copy(tangent), [0, 0, 1])
  }

  // var normal = this.options.initialNormal || vec3.create().asCross(tangent, v).normalize()
  let normal = vec3.normalize(vec3.cross(vec3.copy(tangent), v))
  let binormal = vec3.normalize(vec3.cross(vec3.copy(tangent), normal))
  // let prevBinormal = null
  // let prevNormal = null
  let prevTangent = null
  const frames = []
  let rotation = [0, 0, 0, 1]
  let theta = 0
  v = [0, 0, 0]
  for (var i = 0; i < points.length; i++) {
    var position = points[i]
    tangent = tangents[i]
    if (i > 0) {
      normal = vec3.copy(normal)
      binormal = vec3.copy(binormal)
      prevTangent = tangents[i - 1]
      vec3.cross(vec3.set(v, prevTangent), tangent)
      if (vec3.length(v) > EPSILON) {
        vec3.normalize(v)
        theta = Math.acos(vec3.dot(prevTangent, tangent))
        theta 
        quat.setAxisAngle(rotation, v, theta)
        vec3.multQuat(normal, rotation)
      }
      vec3.cross(vec3.set(binormal, tangent), normal)
    }
    // var m = mat4.set16(mat4.create(), binormal[0], binormal[1], binormal[2], 0, normal[0], normal[1], normal[2], 0, tangent[0], tangent[1], tangent[2], 0, 0, 0, 0, 1)
    var m = mat4.create()
    m[0] = binormal[0]
    m[1] = binormal[1]
    m[2] = binormal[2]
    m[0 + 4] = normal[0]
    m[1 + 4] = normal[1]
    m[2 + 4] = normal[2]
    m[0 + 8] = tangent[0]
    m[1 + 8] = tangent[1]
    m[2 + 8] = tangent[2]
    frames.push({
      tangent: tangent,
      normal: normal,
      binormal: binormal,
      position: position,
      rotation: quat.copy(rotation),
      m: m
    })
  }
  if (closed) {
    const firstNormal = frames[0].normal
    const lastNormal = frames[frames.length - 1].normal
    theta = Math.acos(clamp(vec3.dot(firstNormal, lastNormal), 0, 1))
    theta /= frames.length - 1
    if (vec3.dot(tangents[0], vec3.cross(vec3.copy(firstNormal), lastNormal)) > 0) {
      // theta = -theta
    }
    frames.forEach(function (frame, frameIndex) {
      quat.setAxisAngle(rotation, frame.tangent, theta * frameIndex)
      vec3.multQuat(frame.normal, rotation)
      vec3.cross(vec3.set(frame.binormal, frame.tangent), frame.normal)
      // mat4.set16(frame.m, binormal[0], binormal[1], binormal[2], 0, normal[0], normal[1], normal[2], 0, tangent[0], tangent[1], tangent[2], 0, 0, 0, 0, 1)
      frame.m[0] = frame.binormal[0]
      frame.m[1] = frame.binormal[1]
      frame.m[2] = frame.binormal[2]
      frame.m[0 + 4] = frame.normal[0]
      frame.m[1 + 4] = frame.normal[1]
      frame.m[2 + 4] = frame.normal[2]
      frame.m[0 + 8] = frame.tangent[0]
      frame.m[1 + 8] = frame.tangent[1]
      frame.m[2 + 8] = frame.tangent[2]
    })
  }
  return frames
}

function buildGeometry (frames, shapePath, caps, radius, isClosed, isShapeClosed) {
  caps = typeof caps !== 'undefined' ? caps : false

  var index = 0
  var positions = []
  var texCoords = []
  var normals = []
  var cells = []
  var tangents = []

  var numSegments = shapePath.length
  var numFaces = isShapeClosed ? shapePath.length : shapePath.length - 1
  var numFrameFaces = isClosed ? frames.length : frames.length - 1
  for (let i = 0; i < frames.length; i++) {
    var frame = frames[i]
    for (let j = 0; j < shapePath.length; j++) {
      var p = vec3.copy(shapePath[j])
      p = [p[0], p[1], 0]
      if (radius) {
        // TODO: there is ambiguity between [r, r] and [rx, ry]
        const r = radius.length ? radius[i] : radius
        const rx = (r[0] !== undefined) ? r[0] : r
        const ry = (r[1] !== undefined) ? r[1] : rx
        p[0] *= rx
        p[1] *= ry
      }
      vec3.add(vec3.multMat4(p, frame.m), frame.position)
      positions.push(p)
      // texCoords.push([j / (shapePath.length - 1), i / (frames.length - 1)])
      texCoords.push([j / numFaces, i / numFrameFaces])
      tangents.push(frame.tangent)
      normals.push(vec3.normalize(vec3.sub(vec3.copy(p), frame.position)))
    }
  }

  if (caps) {
    positions.push(frames[0].position)
    texCoords.push([0, 0])
    normals.push(vec3.scale(vec3.copy(frames[0].tangent), -1))
    positions.push(frames[frames.length - 1].position)
    texCoords.push([1, 1])
    normals.push(vec3.scale(vec3.copy(frames[frames.length - 1].tangent), -1))
  }

  index = 0
  for (let i = 0; i < frames.length; i++) {
    for (let j = 0; j < numFaces; j++) {
      if (i < frames.length - 1) {
        cells.push([index + (j + 1) % numSegments + numSegments, index + (j + 1) % numSegments, index + j, index + j + numSegments])
      }
    }
    index += numSegments
  }
  if (isClosed) {
    index -= numSegments
    for (var j = 0; j < numFaces; j++) {
      cells.push([
        index + (j + 1) % numSegments + numSegments,
        index + (j + 1) % numSegments,
        index + j,
        index + j + numSegments
      ].map((i) => i % positions.length))
    }
  }
  if (caps) {
    for (let j = 0; j < numSegments; j++) {
      cells.push([j, (j + 1) % numSegments, positions.length - 2])
      cells.push([positions.length - 1, index - numSegments + (j + 1) % numSegments, index - numSegments + j])
    }
  }

  return {
    positions: positions,
    uvs: texCoords,
    normals: normals,
    cells: cells,
    tangents: tangents
  }
}

module.exports = sweep
