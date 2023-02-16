# geom-sweep

Extrudes a shape along a path.

![](screenshot.png)

## Installation

```bash
npm install geom-sweep
```

## Usage

```js
import sweep from "geom-sweep";

// Create a circle
const path = [];
for (let i = 0; i < 50; i++) {
  path.push([
    Math.cos((i / 50) * 2 * Math.PI),
    Math.sin((i / 50) * 2 * Math.PI),
    0,
  ]);
}
// Create a square
const shape = [
  [1, 1, 0],
  [-1, 1, 0],
  [-1, -1, 0],
  [1, -1, 0],
];

const geometry = sweep(path, shape, options);
// => {
//   positions: Float32Array(756),
//   normals: Float32Array(756),
//   uvs: Float32Array(504),
//   cells: Uint32Array(1512),
//   tangents: Float32Array(756),
//   frames: [{...}, {...}]
// }
```

## API

#### `sweep(path, shape, options): geometry`

**Parameters**

- path: `Array<[x, y, z]>` – positions defining the path to extrude along
- shape: `Array<[x, y, z]>` – positions defining the swept shape

- options.radius: `number` (default: `1`) - extruded geometry radius.
- options.closed: `boolean` (default: `false`) - is the path closed.
- options.closedShape: `boolean` (default: `true`) - is the shape path closed.
- options.caps: `boolean` (default: `false`) - add caps at the end.
- options.initialNormal: `Array` (default: `null`) - provide a starting normal for the frames. Default to the direction of the minimum tangent component.
- options.pathTangents: `Array` (default: `undefined`) - pass pre-computed path tangents.
- options.frames: `Array<{ normal, tangent, bitangent }>` (default: `undefined`) - pass pre-computed frenet serret frames.

**Returns**

geometry: `{ positions: TypedArray|Array, normals: TypedArray|Array, uvs: TypedArray|Array, cells: TypedArray|Array, tangents: TypedArray|Array, frames: Array<{ normal, tangent, bitangent }> }` - the extruded geometry with tangents and frenet serret frames.

## License

MIT. See [license file](https://github.com/vorg/geom-sweep/blob/master/LICENSE.md).
