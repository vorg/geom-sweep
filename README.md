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

const geometry = sweep({ positions: path }, shape, {
  radius: 0.5,
  closed: true,
  initialNormal: [0, 0, 1],
  withFrames: true,
});
// => {
//   positions: Float32Array(756),
//   normals: Float32Array(756),
//   uvs: Float32Array(504),
//   cells: Uint32Array(1512),
//   tangents?: Float32Array(756),
//   binormals?: Float32Array(756),
// }
```

## API

#### `sweep(geometry, shape, options, out?): geometry`

**Parameters**

- geometry: `{ positions: TypedArray | Array<[x, y, z]>, normals?: TypedArray | Array<[x, y, z]>, tangents?: TypedArray | Array<[x, y, z]>, binormals?: TypedArray | Array<[x, y, z]> }` – a geometry object with positions defining the path to extrude along.

- shape: `Array<[x, y, z]>` – positions defining the swept shape.

- options.radius: `number` (default: `1`) - extruded geometry radius.
- options.closed: `boolean` (default: `false`) - is the path closed.
- options.closedShape: `boolean` (default: `true`) - is the shape path closed.
- options.caps: `boolean` (default: `false`) - add caps at the end.
- options.initialNormal: `Array` (default: `null`) - provide a starting normal for the frames. Default to the direction of the minimum tangent component.
- options.withFrames: `boolean` (default: `false`) - compute tangents and binormals.

- out: `{ positions: TypedArray, normals?: TypedArray, tangents?: TypedArray, binormals?: TypedArray }` (default: `{}`) – a geometry object with pre-allocated typed array with each attributes being a multiple of `shape length * path vertices count + (caps ? 2 : 0)`.

**Returns**

geometry: `{ positions: TypedArray, normals: TypedArray, uvs: TypedArray, cells: TypedArray, tangents?: TypedArray, binormals: TypedArray }` - the extruded geometry with optional tangents and binormals.

## License

MIT. See [license file](https://github.com/vorg/geom-sweep/blob/master/LICENSE.md).
