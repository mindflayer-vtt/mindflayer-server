#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  encodeEnvelope,
  parseSerialDebug,
  verifyEnvelope,
} = require("../src/provisioning/format");
const id = process.argv[2],
  output = process.argv[3];
if (
  !id ||
  !output ||
  !process.env.MINDFLAYER_WIFI_SSID ||
  process.env.MINDFLAYER_WIFI_PASSWORD === undefined ||
  !process.env.MINDFLAYER_SERVER_HOST
) {
  console.error(
    "Usage: MINDFLAYER_WIFI_SSID=... MINDFLAYER_WIFI_PASSWORD=... MINDFLAYER_SERVER_HOST=... npm run device:bundle -- <device-id> <output-file>",
  );
  process.exit(2);
}
const dataDir = path.resolve(process.env.MINDFLAYER_DATA_DIR || "./data");
const state = JSON.parse(fs.readFileSync(path.join(dataDir, "devices.json")));
const device = state.devices[id];
if (!device || !/^[0-9a-f]{64}$/i.test(device.secret))
  throw new Error(`Unknown or invalid device ${id}`);
const certificate = new crypto.X509Certificate(
  fs.readFileSync(path.join(dataDir, "tls", "device-cert.pem")),
);
const serverPublicKey = certificate.publicKey.export({
  type: "spki",
  format: "der",
});
const serialDebug = parseSerialDebug(process.env.MINDFLAYER_SERIAL_DEBUG);
const envelope = encodeEnvelope({
  deviceId: id,
  deviceSecret: Buffer.from(device.secret, "hex"),
  ssid: process.env.MINDFLAYER_WIFI_SSID,
  wifiPassword: process.env.MINDFLAYER_WIFI_PASSWORD,
  serverHost: process.env.MINDFLAYER_SERVER_HOST,
  serverPort: Number(process.env.MINDFLAYER_SERVER_PORT || 10443),
  serverPublicKey,
  serialDebug,
});
verifyEnvelope(envelope);
fs.mkdirSync(path.dirname(path.resolve(output)), {
  recursive: true,
  mode: 0o700,
});
fs.writeFileSync(output, envelope, { mode: 0o600 });
fs.chmodSync(output, 0o600);
console.log(
  `Wrote validated provisioning bundle for ${id} to ${output}; secret fields were not printed.`,
);
