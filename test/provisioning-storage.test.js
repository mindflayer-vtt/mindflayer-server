const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { prepareInstallation } = require("../src/provisioning/installation");
const { crc32, encodePayload } = require("../src/provisioning/format");
const {
  readRecord,
  selectProvisioning,
  classifyProvisioning,
} = require("../src/provisioning/storage");
const serverPublicKey = crypto
  .generateKeyPairSync("rsa", { modulusLength: 2048 })
  .publicKey.export({ type: "spki", format: "der" });
const values = {
  deviceId: "controller1",
  deviceSecret: Buffer.alloc(32, 17),
  ssid: "Table",
  wifiPassword: "password",
  serverHost: "elderbrain.local",
  serverPort: 10443,
  serverPublicKey,
  serialDebug: false,
};
const erased = () => Buffer.alloc(4096, 255);

function prepared(sectorA, overrides = {}) {
  return prepareInstallation({
    sectorA,
    sectorB: erased(),
    devices: { controller1: { secret: values.deviceSecret.toString("hex") } },
    serverPublicKey,
    settings: {
      ssid: "Updated",
      psk: "updated-password",
      serverHost: "new.local",
      serverPort: 10443,
    },
    ...overrides,
  });
}

test("installation preserves local identity and binds the exact updated envelope", () => {
  const result = prepared(record(1, { serialDebug: true }));
  assert.equal(result.action, "preserve");
  assert.equal(result.deviceId, values.deviceId);
  assert.equal(result.newCredential, null);
  const payload = require("../src/provisioning/format").decodePayload(
    result.envelope.subarray(7, -4),
  );
  assert.deepEqual(payload.deviceSecret, values.deviceSecret);
  assert.equal(payload.ssid, "Updated");
  assert.equal(payload.wifiPassword, "updated-password");
  assert.equal(payload.serialDebug, true);
  assert.equal(
    result.configurationDigest,
    crypto.createHash("sha256").update(result.envelope).digest("hex"),
  );
});

test("foreign adoption is explicit and creates a fresh identity without mutating registrations", () => {
  const devices = { controller1: { secret: "22".repeat(32) } };
  const original = JSON.stringify(devices);
  assert.throws(() => prepared(record(1), { devices }), /explicit adoption/);
  assert.throws(
    () => prepared(record(1), { devices, adopt: "true" }),
    /boolean/,
  );
  const result = prepared(record(1), { devices, adopt: true });
  assert.equal(result.action, "adopt");
  assert.notEqual(result.deviceId, values.deviceId);
  assert.match(result.deviceId, /^keypad-[a-f0-9]{32}$/);
  assert.match(result.newCredential.secret, /^[a-f0-9]{64}$/);
  assert.notEqual(
    result.newCredential.secret,
    values.deviceSecret.toString("hex"),
  );
  assert.equal(JSON.stringify(devices), original);
});

test("blank provisioning gets fresh credentials but damaged records cannot silently become blank", () => {
  const first = prepared(erased()),
    second = prepared(erased());
  assert.equal(first.action, "initial");
  assert.notEqual(first.deviceId, second.deviceId);
  assert.notEqual(first.newCredential.secret, second.newCredential.secret);
  assert.throws(() => prepared(Buffer.alloc(4096), { adopt: true }), /damaged/);
  assert.throws(() => prepared(erased(), { settings: { ssid: "" } }), /SSID/);
});
function record(generation, overrides = {}) {
  const payload = encodePayload({ ...values, ...overrides }),
    sector = erased();
  sector.write("MFR1");
  sector[4] = 1;
  sector.writeUInt32BE(generation, 5);
  sector.writeUInt16BE(payload.length, 9);
  payload.copy(sector, 11);
  sector.writeUInt32BE(
    crc32(sector.subarray(0, 11 + payload.length)),
    11 + payload.length,
  );
  sector.write("MFPC", 4092);
  return sector;
}
test("sector selection matches firmware generation ordering including wrap and ties", () => {
  for (const [a, b, copy] of [
    [1, 2, "B"],
    [2, 1, "A"],
    [1, 1, "B"],
    [0, 0xffffffff, "A"],
    [0xffffffff, 0, "B"],
    [0, 0x80000000, "B"],
  ]) {
    const selected = selectProvisioning(record(a), record(b));
    assert.equal(selected.copy, copy);
    assert.deepEqual(selected.values, values);
  }
  assert.equal(selectProvisioning(record(1), erased()).copy, "A");
  assert.equal(selectProvisioning(erased(), record(1)).copy, "B");
});
test("invalid or interrupted records never override the surviving committed copy", () => {
  assert.deepEqual(selectProvisioning(erased(), erased()), { state: "blank" });
  for (const offset of [0, 4, 9, 20, 4092]) {
    const damaged = record(2);
    damaged[offset] ^= 1;
    assert.equal(readRecord(damaged), null);
    assert.equal(selectProvisioning(record(1), damaged).copy, "A");
    assert.deepEqual(selectProvisioning(erased(), damaged), {
      state: "invalid",
    });
  }
  assert.throws(() => readRecord(Buffer.alloc(4095)), /4096/);
  const invalidPayload = record(2);
  invalidPayload[11] = 0xff;
  const size = invalidPayload.readUInt16BE(9);
  invalidPayload.writeUInt32BE(
    crc32(invalidPayload.subarray(0, 11 + size)),
    11 + size,
  );
  assert.equal(readRecord(invalidPayload), null);
  assert.equal(selectProvisioning(record(1), invalidPayload).copy, "A");
});
test("local ownership requires identity, secret and server pin to match", () => {
  const devices = {
    controller1: { secret: values.deviceSecret.toString("hex") },
  };
  const classify = (overrides = {}, store = devices, key = serverPublicKey) =>
    classifyProvisioning(record(1, overrides), erased(), store, key);
  assert.equal(classify().ownership, "local");
  assert.equal(
    classify({ deviceSecret: Buffer.alloc(32, 18) }).ownership,
    "foreign",
  );
  assert.equal(classify({}, {}).ownership, "foreign");
  assert.equal(classify({}, devices, Buffer.alloc(32)).ownership, "foreign");
  assert.equal(classify({ deviceId: "constructor" }, {}).ownership, "foreign");
  assert.equal(classify({ deviceId: "other" }).ownership, "foreign");
});
