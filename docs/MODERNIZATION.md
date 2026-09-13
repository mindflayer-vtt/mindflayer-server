# Dependency modernization

## 2026-08-29 baseline and upgrade

- Runtime target: Node.js 22 -> 24; verified with Node 24.16.0 and npm 11.13.0 via fnm.
- Express: 5.1.0 -> 5.2.1; Winston: 3.17.0 -> 3.19.0; ws: 8.18.2 -> 8.21.3.
- bufferutil: 4.0.9 -> 4.1.0; utf-8-validate: 6.0.5 -> 6.0.6.
- `e131` and `moment` were already at their current compatible releases.
- The container now uses Node 24 Alpine, installs from the lockfile, and runs as the unprivileged `node` user.
- GitHub Actions were updated to current major action releases and now run install and test checks before publishing.

The npm audit result changed from 2 moderate and 2 high findings to zero. `npm ci`, all four protocol/WebSocket tests, startup on port 10443, the container build, and a real WSS registration smoke test pass. npm's install-script policy requires the two optional native WebSocket accelerators to be explicitly approved in `package.json`.

Reproduce with:

```sh
fnm use
npm ci
npm test
npm start
docker build -t mindflayer-server .
```

The malformed-message tests intentionally produce error log lines. The local Docker daemon required host networking for the verification build because it could not create a bridge veth; that is a host limitation, not a project failure.
