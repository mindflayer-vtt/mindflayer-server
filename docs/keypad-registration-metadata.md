# Keypad registration metadata

Receiver registration events now include `deviceAuthenticated`, `firmware` and
`hardware`, both for the initial connected-device snapshot and subsequent events.
`deviceAuthenticated` comes from the server-side HMAC handshake. Browser/Foundry
clients cannot set it by including it in their JSON payload; their metadata is
reported as null. Metadata is retained on authenticated disconnect notifications,
but `status: disconnected` must still be treated as offline.

Protocol v3 additionally supports nonce-bound configuration proofs. After an
authenticated registration the server sends `[8, 3, 1, nonce32]`; the keypad
responds `[9, 3, nonce32, digest32]`, where the digest is SHA-256 of the canonical
schema-v2 provisioning envelope reconstructed from boot-loaded settings. A nonce
is accepted once on its originating connection. Mismatched/replayed reports close
the connection. Browser messages cannot create proof events.

The server emits `configuration-state` with `configurationDigest` and includes
that digest in subsequent receiver snapshots. This is evidence of the active
provisioning values, not a numeric revision or an LED acknowledgement. Elderbrain
must match it against the exact envelope associated with its installation job;
it must not infer application merely from a successful serial write.

`GET /api/capabilities` advertises supported protocol versions `[1,2,3]` and the
`sha256-canonical-envelope-v2` proof scheme. Deploy this server before v3 firmware.
Existing v1/v2 clients retain their previous message schemas and receive no proof
query. No production release/image pin has been changed by this implementation.

Protocol-v3 LED commands use `[10, 3, nonce32, r1, g1, b1, r2, g2, b2]`, with
`[11, 3, nonce32]` acknowledging firmware application. The server emits `led-state`
with `appliedLeds: null` when sending and `{ led1: {r,g,b}, led2: {r,g,b} }` only
after the current pending nonce is acknowledged on its authenticated connection.
Old/replayed acknowledgements are ignored; client JSON cannot forge this event.
Late receiver snapshots include confirmed colours. Receivers must clear current
confirmation on disconnect and compare colours against their desired settings;
Foundry or Identify can change them later. This is not an optical measurement,
and it does not replace provisioning proof. V1/v2 LED commands remain unchanged
and do not provide confirmation.

Dependabot covers npm, Actions and the Docker base image with weekly reviewed
updates. npm minor/patch updates and security updates have separate groups;
major upgrades stay separate, and nothing auto-merges. GitHub activation requires
merging `.github/dependabot.yml` to the default branch.
