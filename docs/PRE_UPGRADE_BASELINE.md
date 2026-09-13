# Pre-upgrade baseline

Verified with the locked dependencies under Node 22.13.1/npm 10.9.2. The same
test suite also passes unchanged under Node 24.16.0/npm 11.13.0.

## Commands and resolved direct dependencies

- Clean install: `npm ci`
- Tests: `npm test`
- Startup: `npm start`
- bufferutil 4.0.9, e131 1.1.3, Express 5.1.0, Moment 2.30.1,
  utf-8-validate 6.0.5, Winston 3.17.0, ws 8.18.2

The Node test suite has four tests, including real WebSocket clients connected
to an ephemeral localhost port. It covers registration, multiple controllers,
key-event forwarding, configuration routing, keyboard-login forwarding,
malformed/unknown input, disconnect notification, and invalid upgrade paths.

## Existing warnings

- `npm ci` reports 4 audit findings: 2 moderate and 2 high.
- Malformed/unknown-message tests intentionally produce application log output.
- Startup and tests emit no Node runtime warnings.
