# Automatic keypad firmware updates

Production startup (`npm start` or the container) automatically checks
[keypad releases](https://github.com/mindflayer-vtt/mindflayer-keypad/releases)
at startup and hourly thereafter. It selects the highest compatible stable
semantic version, downloads and verifies it, then offers it to every eligible
authenticated keypad. Devices already online do not need to reconnect. A keypad
connecting later receives the cached release during registration.

The keypad downloads, verifies, installs, and reboots without operator approval.
Its existing signed-OTA/rBoot health gate and rollback remain in effect. Device
identity, Wi-Fi credentials, and the server TLS pin are preserved. Expect a brief
input interruption during installation; disable automatic updates or pin versions
before sessions where that would be disruptive.

## Configuration

| Setting                            | Default                                | Meaning                                                                                                         |
| ---------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `MINDFLAYER_FIRMWARE_AUTO_UPDATE`  | `true`                                 | Set exactly `false` to disable discovery and automatic offers globally. Manual version targets remain usable.   |
| `MINDFLAYER_FIRMWARE_POLL_SECONDS` | `3600`                                 | Integer polling interval, 60–86400 seconds. GitHub rate limits can extend it.                                   |
| `MINDFLAYER_FIRMWARE_CACHE_DIR`    | `$MINDFLAYER_DATA_DIR/firmware-cache`  | Writable, persistent verified artifact cache. Data directory defaults to `./data`, or `/data` in the container. |
| `MINDFLAYER_FIRMWARE_DIR`          | `./firmware`, `/firmware` in container | Optional separate, read-only manually managed repository.                                                       |

Invalid enable/disable values or enabled polling intervals fail startup. Public
release discovery needs outbound HTTPS to GitHub's API and release download
hosts; no GitHub token or signing private key is needed.

For one keypad, edit its existing entry in `devices.json` without changing its
secret, then restart the server. Set `"autoUpdate": false` to opt out. Remove it
or set it to `true` to follow stable releases again.

An explicit `"targetVersion": "1.2.3"` takes precedence, including when
`autoUpdate` is false. It selects only that exact version from the verified cache
or manual repository; discovery does not fetch arbitrary older pins. Remove the
target to resume automatic selection. Automatic updates never downgrade or
reinstall an equal semantic version. Only a pinned target with
`"allowDowngrade": true` permits a downgrade.

## Verification and storage

Only non-draft, non-prerelease GitHub releases tagged `vX.Y.Z` with the expected
`mindflayer-keypad-X.Y.Z-server-firmware.tar.gz` asset are considered. Selection
uses semantic ordering, not upload time or lexicographic ordering. The importer:

1. Restricts HTTPS download and redirect hosts, time, and byte counts; checks the
   asset size and GitHub SHA-256 digest when provided.
2. Parses a bounded archive in memory, rejecting traversal, links, duplicates,
   unexpected files, invalid headers, and oversized expansion.
3. Checks the manifest's hardware, stable version, size, and SHA-256; verifies the
   signed image's RSA-2048/SHA-256 signature, ESP8266 boot2 structure/checksum,
   and embedded hardware/version identity.
4. Atomically stores the verified image and cache metadata. Only then can a
   release be offered. It re-verifies cached files at startup, before offers,
   and before sending any download bytes.

The bundled trust anchor is `src/firmware/firmware-signing-public.pem`, matching
the keypad repository's `keys/firmware-signing-public.pem` and compiled key.
Its DER/SPKI SHA-256 fingerprint is
`aa60b6f834754980d279bfdf94c082c5d013eb7cbbc07843b9249ec0334bc2b1`.
Release assets cannot supply or replace the trust anchor. No automatic key
rotation is implemented; a changed signing key requires deliberate compatible
firmware/server deployment. Never put the private signing key on this server.

The independent keypad signature check remains the installation authority;
manifest hashes and GitHub metadata alone never authorize automatic firmware.

## Failures, retries, and testing

Network, rate-limit, invalid-release, or cache-write failures are logged without
stopping keypad service. A bad newest release may fall back to an older verified
stable release, but never below the latest already cached version. Valid cached
releases remain available offline. A missing or corrupt cached image is not
offered or served; if detected during download, the response is HTTP 503 with no
firmware bytes. Preserve the data volume across container replacements.

Offers for the same device/version are limited to once per ten minutes within a
server process, including across reconnects. A later registration or discovery
check retries after that interval; it is not a ten-minute retry timer. Each keypad
has independent retry state. Restarting the server resets the cooldown. A newly
discovered version can be offered immediately. Download grants are short-lived
and bound to the offered artifact.

The test suite exercises simulated keypads over loopback TLS/WSS, including
multi-device offers, signed download integrity, tampering, opt-outs/pins,
acknowledgement ordering, retries, and shutdown cancellation. It uses ephemeral
test signing keys and fake GitHub responses, not production private keys or
physical devices. The container smoke test disables discovery to remain
independent of GitHub availability.

For embedded/library use, `createDeviceServer()` alone stays opt-in; pass
`autoFirmwareUpdates: true`. `startAll()` is the default-on production entry.
The keypad repository's physical test harness explicitly sets
`autoFirmwareUpdates: false` and only installs operator-selected test targets.
