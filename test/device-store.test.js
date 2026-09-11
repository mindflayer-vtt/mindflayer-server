const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DeviceStore } = require("../src/security/device-store");
function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "mindflayer-credentials-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, file: path.join(root, "devices.json") };
}
test("registration retries are idempotent and stale instances preserve other credentials", (t) => {
  const { file } = fixture(t),
    first = new DeviceStore(file),
    second = new DeviceStore(file);
  assert.equal(first.get("constructor"), undefined);
  first.register("one", "11".repeat(32));
  second.register("two", "22".repeat(32));
  const before = fs.readFileSync(file);
  first.register("one", "11".repeat(32));
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(first.get("two").secret, "22".repeat(32));
  assert.throws(
    () => second.register("one", "33".repeat(32)),
    /different credentials/,
  );
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  first.register("constructor", "44".repeat(32));
  assert.equal(
    new DeviceStore(file).get("constructor").secret,
    "44".repeat(32),
  );
});
test("active or interrupted writer lock fails closed without changing registration", (t) => {
  const { file } = fixture(t),
    store = new DeviceStore(file);
  store.register("one", "11".repeat(32));
  const before = fs.readFileSync(file);
  fs.writeFileSync(file + ".lock", "other writer\n", { mode: 0o600 });
  assert.throws(() => store.register("two", "22".repeat(32)), /EEXIST/);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.readFileSync(file + ".lock", "utf8"), "other writer\n");
});
test("malformed and symlinked stores are rejected, not overwritten", (t) => {
  const { file, root } = fixture(t);
  for (const data of [
    "null",
    '{"version":1,"devices":null}',
    '{"version":1,"devices":{"one":{"secret":"bad"}}}',
  ]) {
    fs.writeFileSync(file, data);
    assert.throws(() => new DeviceStore(file));
  }
  const alternate = path.join(root, "alternate.json");
  fs.renameSync(file, alternate);
  fs.symlinkSync(alternate, file);
  assert.throws(() => new DeviceStore(file), /ELOOP/);
});
test("private registration command never prints secrets and refuses replacement", (t) => {
  const { root } = fixture(t);
  const run = (secret) =>
    spawnSync(
      process.execPath,
      [path.join(__dirname, "../scripts/register-installation.js")],
      {
        env: { ...process.env, MINDFLAYER_DATA_DIR: root },
        input: JSON.stringify({ id: "keypad", secret }),
        encoding: "utf8",
        timeout: 5000,
      },
    );
  const result = run("11".repeat(32));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    id: "keypad",
    state: "registered",
  });
  assert.equal(result.stderr, "");
  assert.equal(run("11".repeat(32)).status, 0);
  const refused = run("22".repeat(32));
  assert.equal(refused.status, 1);
  assert.equal(refused.stdout, "");
  assert.equal(refused.stderr.includes("22".repeat(32)), false);
});
