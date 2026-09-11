#!/usr/bin/env node
// Internal host-worker command. Stdin and stdout carry credentials; pipe them
// only between private files/processes, never workflow logs or public job output.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DeviceStore } = require("../src/security/device-store");
const { prepareInstallation } = require("../src/provisioning/installation");
// Docker client termination does not necessarily terminate an exec command.
setTimeout(() => process.exit(1), 15000).unref();

function sector(value) {
  if (typeof value !== "string" || value.length !== 5464)
    throw new Error("Invalid sector");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 4096 || decoded.toString("base64") !== value)
    throw new Error("Invalid sector");
  return decoded;
}

async function main() {
  if (process.stdin.isTTY || process.stdout.isTTY)
    throw new Error("Private pipes required");
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 16384) throw new Error("Request exceeds limit");
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !input.settings ||
    typeof input.settings !== "object" ||
    Array.isArray(input.settings)
  )
    throw new Error("Invalid request");
  const sectorA = sector(input.sectorA),
    sectorB = sector(input.sectorB);
  const dataDir = path.resolve(process.env.MINDFLAYER_DATA_DIR || "./data");
  const store = new DeviceStore(path.join(dataDir, "devices.json"));
  const certificate = new crypto.X509Certificate(
    fs.readFileSync(path.join(dataDir, "tls/device-cert.pem")),
  );
  const serverPublicKey = certificate.publicKey.export({
    type: "spki",
    format: "der",
  });
  const prepared = prepareInstallation({
    sectorA,
    sectorB,
    devices: store.devices,
    serverPublicKey,
    settings: input.settings,
    adopt: input.adopt,
  });
  process.stdout.write(
    JSON.stringify({
      ...prepared,
      envelope: prepared.envelope.toString("base64"),
    }) + "\n",
  );
}

main().catch(() => {
  // Do not echo malformed input, filesystem paths or secret-bearing exceptions.
  process.stderr.write(
    "Unable to prepare installation; check sector backups, settings and explicit adoption consent.\n",
  );
  process.exitCode = 1;
});
