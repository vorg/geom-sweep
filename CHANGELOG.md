# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

# [3.0.0](https://github.com/vorg/geom-sweep/compare/v2.0.0...v3.0.0) (2026-10-19)

* feat!: sweep every path polyline ([ae0bc8c](https://github.com/vorg/geom-sweep/commit/ae0bc8c6b32cf4ac1220331586377db99db2f292))
* feat!: copy path and shape attributes, read radii from the path geometry ([2594cfc](https://github.com/vorg/geom-sweep/commit/2594cfce0c1b13e3239e433537b8d942f3b61104))
* feat!: compute normals for elliptical, tapered and twisted walls, add frameOptions ([4a0e750](https://github.com/vorg/geom-sweep/commit/4a0e750a355048c108d1fb70c061051e6e55686b))

### Bug Fixes

* compute path frames unless tangents, normals and binormals are all given ([fd13220](https://github.com/vorg/geom-sweep/commit/fd132203bff906c0afe54c18b49c26e93793fe6c))
* normalize cap frames and skip path attributes copy when empty ([2cc20ff](https://github.com/vorg/geom-sweep/commit/2cc20ff2910cb097a769d16ded7dc77ebff53487))

### Features

* add capStart, capEnd and capMapping options with triangulated caps ([161afc9](https://github.com/vorg/geom-sweep/commit/161afc9344c2a7f141f9bc02ad01eeabd0a0860a))
* follow the first path polyline and close paths on a repeated index ([4e7ff90](https://github.com/vorg/geom-sweep/commit/4e7ff90d804bd710d4243582c18760cd6f6f3e38))

### BREAKING CHANGES

* every polyline in the path cells is swept, instead of the first one only.
* initialNormal moves to frameOptions.initialNormal
* radius is [rx, ry]. Per-point radii move to geometry.radii (flat rx, ry pairs), multiplied by radius.

# [2.0.0](https://github.com/vorg/geom-sweep/compare/v1.0.0...v2.0.0) (2024-03-19)


### Bug Fixes

* compute radius once per path position ([2564ffe](https://github.com/vorg/geom-sweep/commit/2564ffe9b834798013d16896a3ed4f9b1adb9d25))
* get typed array constructor from positions size ([81fe957](https://github.com/vorg/geom-sweep/commit/81fe957b609904196d8e9a5631366f64a9d40223))


### Features

* add support for flat arrays ([81766d0](https://github.com/vorg/geom-sweep/commit/81766d0b81923b6638278276e472787521e9b456))
* add support for shape as flat arrays ([7db89dc](https://github.com/vorg/geom-sweep/commit/7db89dc9b0af181897fdd929e65081c62860f0a6))


### Performance Improvements

* optimise sweep computation ([52ccfac](https://github.com/vorg/geom-sweep/commit/52ccfac717871aa2cda5d80b66ba9702ab3cb4c5))


### BREAKING CHANGES

* do not guess closed path
* use geometry as first argument
* return optionally augmented geometry and not frames
