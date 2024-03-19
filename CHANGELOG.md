# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

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
