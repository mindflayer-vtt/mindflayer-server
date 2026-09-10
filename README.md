<div align="center">
<img width="460" src=".github/foundryvtt-mindflayer-logo.png" alt="Mind Flayer">
</div>

# Mind Flayer server

[![Docker CI and release](https://github.com/mindflayer-vtt/mindflayer-server/actions/workflows/docker-publish.yml/badge.svg?branch=main)](https://github.com/mindflayer-vtt/mindflayer-server/actions/workflows/docker-publish.yml)
[![Docker Pulls](https://img.shields.io/docker/pulls/mindflayervtt/server)](https://hub.docker.com/r/mindflayervtt/server)
[![GitHub Release](https://img.shields.io/github/v/release/mindflayer-vtt/mindflayer-server)](https://github.com/mindflayer-vtt/mindflayer-server/releases/latest)

The [Docker workflow](https://github.com/mindflayer-vtt/mindflayer-server/actions/workflows/docker-publish.yml)
runs tests, creates semantic releases, and publishes multi-platform images to
[Docker Hub](https://hub.docker.com/r/mindflayervtt/server). Release builds publish
the full version, minor, major, and `latest` tags; main-branch builds also publish
`edge`.

The server has two deliberately separate endpoints:

- `http://0.0.0.0:8080` (`FOUNDRY_PORT`): browser/Foundry HTTP and WebSocket traffic, intended only for a browser-trusted reverse proxy.
- `https://0.0.0.0:10443` (`DEVICE_PORT`): versioned binary restricted-CBOR keypad WSS at `/device/v1` and authorized firmware downloads, using its own persistent self-signed TLS identity. Current keypads use explicit frame protocol v2; the server retains the bounded legacy-v1 codec needed to update deployed keypads.

The reverse proxy remains outside this repository. Configure the Foundry module with its external reverse-proxy host, port and `/ws` path; it already constructs the appropriate external `wss://` URL.

## Container topology

```yaml
services:
  mindflayer-server:
    build: .
    user: node
    environment:
      MINDFLAYER_DATA_DIR: /data
      MINDFLAYER_FIRMWARE_DIR: /firmware
      FOUNDRY_PORT: 8080
      DEVICE_PORT: 10443
    ports:
      - "10443:10443"
    expose:
      - "8080"
    volumes:
      - mindflayer-data:/data
      - ./firmware:/firmware:ro
volumes:
  mindflayer-data:
```

The image runs as the unprivileged `node` user. Ensure bind-mounted directories are writable by that UID where required. The image contains neither PlatformIO nor any firmware signing private key.

Published container images support `linux/amd64`, `linux/arm64`, and `linux/s390x`. Node.js 24 does not provide the Alpine base image for 32-bit ARM, so `linux/arm/v6` and `linux/arm/v7` are not published.

The image defaults persistent server identity and credentials to `/data`, expects firmware at `/firmware`, and declares `/data` as a volume. Its Docker health check verifies both `/healthz` on the Foundry HTTP listener and `/healthz` on the device HTTPS listener.

## Device TLS bootstrap

On first start the server creates `/data/tls/device-key.pem` (mode 0600) and a self-signed `/data/tls/device-cert.pem`. The certificate can be recreated while retaining the key; the private key is the durable server identity and must be backed up with the data volume. Extract the pinned public key with:

```sh
openssl pkey -in /data/tls/device-key.pem -pubout -out device-public.pem
```

The host bundle tool exports this public key as DER/SPKI into each keypad's serial provisioning envelope. Losing the private key changes server identity; every keypad then needs trusted serial reprovisioning. Corrupt or mismatched key/certificate state fails startup instead of silently changing identity.

## Device provisioning and rollout

Create a unique 256-bit device secret:

```sh
MINDFLAYER_DATA_DIR=/data npm run device:provision -- controller1
```

The command stores `/data/devices.json` with restrictive permissions. Create a mode-0600 ignored serial bundle without printing its secret fields:

```sh
MINDFLAYER_DATA_DIR=/data MINDFLAYER_WIFI_SSID='ssid' \
MINDFLAYER_WIFI_PASSWORD='password' MINDFLAYER_SERVER_HOST='10.42.0.1' \
npm run device:bundle -- controller1 provisioning/controller1.provisioning.bin
npm run device:serial-provision -- provisioning/controller1.provisioning.bin /dev/serial/by-path/...
```

The serial sender automatically performs the keypad's double-reset recovery sequence through FTDI RTS. Recovery boot leaves the physically shared GPIO3/RXD0 out of NeoPixel DMA mode, sends the validated envelope, waits for acknowledgement, and requires no button press.

Serial runtime diagnostics default to disabled. Set `MINDFLAYER_SERIAL_DEBUG=true` while creating a bundle to enable them for that device; use `false` or omit the variable for silent normal operation. Provisioning acknowledgements remain available regardless of this setting.

Add rollout metadata to the device entry when ready:

```json
{
  "secret": "<existing secret>",
  "targetVersion": "1.2.3",
  "allowDowngrade": false
}
```

No target means no update. Equal versions mean no update. Downgrades are rejected unless explicitly enabled. Authenticated devices receive short-lived, device-bound opaque download grants in an HTTP `Authorization: Bearer` header.

## Firmware repository

The server only accepts prebuilt signed firmware; it never compiles or signs it. Copy the signed binary into the read-only firmware mount and create `manifest.json` following `firmware/manifest.example.json`. Each release declares schema version, hardware ID, semantic version, relative artifact path, byte size and SHA-256. Startup rejects invalid versions, missing or outside files, traversal, and size/hash mismatches. The SHA-256 is repository integrity metadata; the independent ESP8266 signature is what authorizes installation.

Roll out to one keypad, verify its reconnect reports the target version, then add targets for further devices. After HMAC authentication, a registration that reports the configured target version receives restricted-CBOR `FIRMWARE_ACCEPTED`. This is distinct from authentication: it tells a temporary rBoot candidate that the server observed and accepted its semantic version/session, allowing the keypad's complete health gate to promote it. A registration at another version may receive an update offer but never the acceptance needed to promote that version. The server never knows or controls rBoot slot numbers.

## Development

### License

The server is licensed under [GPL-3.0-only](LICENSE). Third-party dependencies
retain their own licenses. Published containers include the project license and
credits and declare the GPL license in their OCI metadata.

The server's published branches and tags were rewritten on 2026-09-10 to make
the project license consistently GPLv3 throughout history. Existing clones should
be replaced with fresh clones after preserving local work; do not merge the old
history back into the repository.

### Commands

```sh
npm ci
npm test
npm audit
npm start
```

Commits on `main` are released with semantic-release. Conventional Commit types determine the next version, update `package.json`, `package-lock.json`, and `CHANGELOG.md`, create the Git tag and GitHub release, and supply matching semantic Docker tags and OCI version metadata.
