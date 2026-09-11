const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { decodePayload, verifyEnvelope } = require("../src/provisioning/format");
const script = path.join(__dirname, "../scripts/prepare-installation.js");
test("private preparation command emits a valid plan without registering or leaking errors", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "mindflayer-prepare-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, "tls"));
  const certificate = path.join(directory, "tls/device-cert.pem");
  const generated = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=disposable-test",
      "-keyout",
      path.join(directory, "tls/key.pem"),
      "-out",
      certificate,
    ],
    { encoding: "utf8" },
  );
  assert.equal(generated.status, 0);
  const input = {
    sectorA: Buffer.alloc(4096, 255).toString("base64"),
    sectorB: Buffer.alloc(4096, 255).toString("base64"),
    settings: {
      ssid: "Table",
      psk: "private-test-password",
      serverHost: "elderbrain.local",
      serverPort: 10443,
    },
  };
  const run = (payload) =>
    spawnSync(process.execPath, [script], {
      env: { ...process.env, MINDFLAYER_DATA_DIR: directory },
      input: payload,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 65536,
    });
  const result = run(JSON.stringify(input));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const prepared = JSON.parse(result.stdout),
    envelope = Buffer.from(prepared.envelope, "base64");
  assert.equal(prepared.action, "initial");
  assert.equal(verifyEnvelope(envelope), true);
  assert.equal(
    prepared.configurationDigest,
    crypto.createHash("sha256").update(envelope).digest("hex"),
  );
  const decoded = decodePayload(envelope.subarray(7, -4));
  assert.equal(decoded.deviceId, prepared.newCredential.id);
  assert.equal(
    decoded.deviceSecret.toString("hex"),
    prepared.newCredential.secret,
  );
  assert.equal(decoded.wifiPassword, input.settings.psk);
  assert.equal(fs.existsSync(path.join(directory, "devices.json")), false);
  for (const malformed of [
    "private-test-password",
    "x".repeat(16385),
    JSON.stringify({ ...input, sectorA: "bad" }),
    JSON.stringify({
      ...input,
      settings: { ...input.settings, psk: "private-test-password".repeat(10) },
    }),
  ]) {
    const failed = run(malformed);
    assert.equal(failed.status, 1);
    assert.equal(failed.stdout, "");
    assert.equal(failed.stderr.includes("private-test-password"), false);
    assert.match(failed.stderr, /^Unable to prepare installation;/);
  }
});
