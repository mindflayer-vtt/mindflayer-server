## [0.4.1](https://github.com/mindflayer-vtt/mindflayer-server/compare/v0.4.0...v0.4.1) (2026-09-11)


### Bug Fixes

* **provisioning:** verify installation through receiver endpoint ([5ab7abc](https://github.com/mindflayer-vtt/mindflayer-server/commit/5ab7abc4381b13c240737be5584688dbb58e7ad5))

# [0.4.0](https://github.com/mindflayer-vtt/mindflayer-server/compare/v0.3.0...v0.4.0) (2026-09-11)


### Features

* **keypads:** support verified installation and configuration ([fcb9b77](https://github.com/mindflayer-vtt/mindflayer-server/commit/fcb9b779e71863f3072957eab569158e6eddd213))

# [0.3.0](https://github.com/mindflayer-vtt/mindflayer-server/compare/v0.2.2...v0.3.0) (2026-09-10)


### Features

* **firmware:** automatically roll out verified stable releases ([a8663d1](https://github.com/mindflayer-vtt/mindflayer-server/commit/a8663d18c1459ab7db194ac18aa2860ff78b2bf7))
* **firmware:** discover and verify GitHub release archives ([ec5316f](https://github.com/mindflayer-vtt/mindflayer-server/commit/ec5316f9bf7acb5ffd7a852fbb8c5109d6de4ee3))

## [0.2.2](https://github.com/mindflayer-vtt/mindflayer-server/compare/v0.2.1...v0.2.2) (2026-09-10)


### Bug Fixes

* **container:** publish resolved labels and release revision ([54c579e](https://github.com/mindflayer-vtt/mindflayer-server/commit/54c579ef8b08718cf222637c7215fa242c4c3269))

## [0.2.1](https://github.com/mindflayer-vtt/mindflayer-server/compare/v0.2.0...v0.2.1) (2026-09-10)


### Bug Fixes

* **container:** include GPL notices in build context ([63d4f4a](https://github.com/mindflayer-vtt/mindflayer-server/commit/63d4f4abaa2fd84b36236ddfdc2db7876ca13345))
* **license:** enforce GPL metadata and include container notices ([52e9926](https://github.com/mindflayer-vtt/mindflayer-server/commit/52e9926565a51b3cf72aa6892c5fd15416b4a5ff))

# [0.2.0](https://github.com/mindflayer-vtt/mindflayer-server/compare/v0.1.1...v0.2.0) (2026-09-10)


### Bug Fixes

* **ci:** remove ppc64le as it is no longer supported by node ([afbf88a](https://github.com/mindflayer-vtt/mindflayer-server/commit/afbf88a9a8e43b71fdcba4018c417fd9fdbd75ff))
* docker image name for setup ([f4335a9](https://github.com/mindflayer-vtt/mindflayer-server/commit/f4335a9d701936e2156794269b0d2f8aab937be9))
* issue where creating PRs will tag image as latest ([ee56a03](https://github.com/mindflayer-vtt/mindflayer-server/commit/ee56a03c8e04c4fd397b8159d884925037c18921))
* merge pull request [#7](https://github.com/mindflayer-vtt/mindflayer-server/issues/7) from mindflayer-vtt/dependabot/npm_and_yarn/moment-2.29.2 ([1635513](https://github.com/mindflayer-vtt/mindflayer-server/commit/16355130c7e8d810b925a1d253dd15d233e805e9))
* **protocol:** validate provisioning CBOR schema ([deb6338](https://github.com/mindflayer-vtt/mindflayer-server/commit/deb633851af2f5618d7f317778e6dd26aac3fcff))
* **server:** enter keypad serial recovery by double reset ([a5b8dde](https://github.com/mindflayer-vtt/mindflayer-server/commit/a5b8dde2764a4d469768dbb229317a912c0bf8ce))
* **server:** harden public release boundaries ([d4214c2](https://github.com/mindflayer-vtt/mindflayer-server/commit/d4214c2a8675d8e76e579005346c0cdc3ae2e9ef))
* **server:** install TLS bootstrap dependency ([515811f](https://github.com/mindflayer-vtt/mindflayer-server/commit/515811fa5d235f91b9df8d7324caa9469069b687))
* **server:** isolate runtime state and harden container ([3ea8cc5](https://github.com/mindflayer-vtt/mindflayer-server/commit/3ea8cc584855ee4fd2648a23a4fbab61f0dfd476))
* update dependencies ([88afd4a](https://github.com/mindflayer-vtt/mindflayer-server/commit/88afd4a22a69f91cf0aacda8424ef963f299e617))


### Features

* **node:** upgrade node version to 16 ([265e211](https://github.com/mindflayer-vtt/mindflayer-server/commit/265e2110be580ec920db344880db415916a06893))
* **protocol:** support explicit CBOR v2 framing ([68b38d5](https://github.com/mindflayer-vtt/mindflayer-server/commit/68b38d5eb0ea97c468537dc77cf1bf9b79fe735b))
* **provisioning:** configure serial debugging ([70f0602](https://github.com/mindflayer-vtt/mindflayer-server/commit/70f06022d8a3049ef5e98d34aa4b4ebeb2bb2d7d))
* **server:** acknowledge healthy firmware registrations ([feca923](https://github.com/mindflayer-vtt/mindflayer-server/commit/feca923c317d093fe50967a733158faff77beb24))
* **server:** add CBOR device protocol and provisioning ([5945042](https://github.com/mindflayer-vtt/mindflayer-server/commit/594504271a62e90a8a5c3afce9d38345e975344f))
* **server:** secure dedicated keypad update endpoint ([ac0e652](https://github.com/mindflayer-vtt/mindflayer-server/commit/ac0e652fa78b4a29798a6c6ce6302cebb252c248))
