# Mind Flayer server

The server has two deliberately separate endpoints:

- `http://0.0.0.0:8080` (`FOUNDRY_PORT`): browser/Foundry HTTP and WebSocket traffic, intended only for a browser-trusted reverse proxy.
- `https://0.0.0.0:10443` (`DEVICE_PORT`): direct keypad WSS and authorized firmware downloads, using its own persistent self-signed TLS identity.

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

## Device TLS bootstrap

On first start the server creates `/data/tls/device-key.pem` (mode 0600) and a self-signed `/data/tls/device-cert.pem`. The certificate can be recreated while retaining the key; the private key is the durable server identity and must be backed up with the data volume. Extract the pinned public key with:

```sh
openssl pkey -in /data/tls/device-key.pem -pubout -out device-public.pem
```

Provision `device-public.pem` into each keypad's ignored local configuration. Losing the private key changes server identity; every keypad then needs the replacement public key provisioned by a trusted serial process. Corrupt or mismatched key/certificate state fails startup instead of silently changing identity.

## Device provisioning and rollout

Create a unique 256-bit device secret:

```sh
MINDFLAYER_DATA_DIR=/data npm run device:provision -- controller1
```

The command stores `/data/devices.json` with restrictive permissions and displays the new secret once for transfer into ignored keypad configuration. Normal logs never include it. Add rollout metadata to that device entry when ready:

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

Roll out to one keypad, verify its reconnect reports the target version, then add targets for further devices. Phase 1 has no automatic rollback: incomplete or invalid signed updates retain the current image, but valid buggy firmware may require serial recovery.

## Development

```sh
npm ci
npm test
npm audit
npm start
```
