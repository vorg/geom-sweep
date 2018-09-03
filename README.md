# geom-sweep

![](screenshot.png)

Extrudes a shape along a path.

## Usage

```javascript
var sweep = require('geom-sweep')
var g = sweep(path, shape, opts)
```

## API

### `sweep(path, shape, opts)`

- `path` - array of [x, y, z] positions defining the path to extrude along
- `shape` - array of [x, y, z] positions defining the swept shape
- `opts` - options
- `opts.radius` - extruded geometry radius (default 1)
- `opts.initialNormal` - provide a starting normal for the frames. Default to the direction of the minimum tangent component (default undefined)
- `opts.closed` - is the path closed? (default false)
- `opts.caps` - add caps at the end? (default false)
- `opts.closedShape` - is the shape path closed? (default true)
- `opts.debug` - add `debugLines: []` with the frames vectors concatenated in the form [point, tangent, point, normal, point, binormal] (default false)

Returns new geometry: `{ positions: [], normals: [], tangents: [], uvs: [], cells: [] }`

## License

MIT, see [LICENSE.md](http://github.com/vorg/geom-sweep/blob/master/LICENSE.md) for details.
