const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const { once } = require("node:events");
const WebSocket = require("ws");
const cbor = require("cbor");
const { createDeviceServer, startAll, compareVersions } = require("../src");
const { GithubFirmwareUpdater } = require("../src/firmware/github-updater");
const {
  autoUpdateEnabled,
  RETRY_INTERVAL_MS,
} = require("../src/firmware/rollout");
const { HARDWARE } = require("../src/firmware/verify");
const { OtaTokens } = require("../src/firmware/tokens");
const { calculateHmacBytes } = require("../src/security/device-auth");
const { TYPE, PROTOCOL_VERSION: V } = require("../src/device/protocol");
const {
  publicKey,
  release,
  source,
} = require("./helpers/firmware-release.cjs");

const secret = "11".repeat(32);
const pause = () => new Promise((resolve) => setTimeout(resolve, 40));

async function fixture(t, devices = { one: {}, two: {} }, fixtures = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mindflayer-rollout-"));
  const devicesFile = path.join(root, "devices.json");
  fs.writeFileSync(
    devicesFile,
    JSON.stringify({
      version: 1,
      devices: Object.fromEntries(
        Object.entries(devices).map(([id, metadata]) => [
          id,
          { secret, ...metadata },
        ]),
      ),
    }),
  );
  const remote = source(fixtures);
  const updater = new GithubFirmwareUpdater({
    root: path.join(root, "cache"),
    publicKey,
    request: remote.request,
    logger: { warn() {} },
  });
  let now = 0;
  const runtime = createDeviceServer({
    devicesFile,
    firmwareDir: path.join(root, "manual"),
    tlsDir: path.join(root, "tls"),
    firmwareUpdater: updater,
    now: () => now,
  });
  t.after(async () => {
    for (const ws of runtime.wss.clients) ws.terminate();
    const closed = once(runtime.server, "close");
    runtime.wss.close();
    runtime.server.close();
    await closed;
    if (updater.inFlight) await updater.inFlight.catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  });
  const checked = once(updater, "checked");
  runtime.server.listen(0, "127.0.0.1");
  await once(runtime.server, "listening");
  await checked;
  return {
    runtime,
    updater,
    remote,
    fixtures,
    advance: () => {
      now += RETRY_INTERVAL_MS;
    },
  };
}

async function connect(runtime, id, version = "1.0.0", hardware = HARDWARE) {
  const ws = new WebSocket(
    `wss://127.0.0.1:${runtime.server.address().port}/device/v1`,
    { rejectUnauthorized: false },
  );
  const messages = [];
  ws.on("message", (data) => messages.push(cbor.decodeFirstSync(data)));
  async function next() {
    for (let i = 0; i < 100; i++) {
      if (messages.length) return messages.shift();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Timed out waiting for device frame");
  }
  await once(ws, "open");
  const challenge = await next();
  ws.send(
    cbor.encodeCanonical([
      TYPE.AUTH_RESPONSE,
      V,
      id,
      calculateHmacBytes(Buffer.from(secret, "hex"), id, challenge[2]),
    ]),
  );
  assert.deepEqual(await next(), [TYPE.AUTH_RESULT, V, 0, id]);
  ws.send(cbor.encodeCanonical([TYPE.REGISTRATION, V, version, hardware]));
  return { ws, messages, next };
}

function download(runtime, offer) {
  return new Promise((resolve, reject) => {
    https
      .get(
        `https://127.0.0.1:${runtime.server.address().port}${offer[5]}`,
        {
          rejectUnauthorized: false,
          headers: {
            Authorization: `Bearer ${Buffer.from(offer[6]).toString("base64url")}`,
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () =>
            resolve({ status: res.statusCode, bytes: Buffer.concat(chunks) }),
          );
          res.on("error", reject);
        },
      )
      .on("error", reject);
  });
}

test(
  "discovers once and offers verified downloads to multiple already-connected keypads",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    const one = await connect(f.runtime, "one");
    const two = await connect(f.runtime, "two");
    for (const keypad of [one, two])
      assert.deepEqual(await keypad.next(), [
        TYPE.FIRMWARE_ACCEPTED,
        V,
        "1.0.0",
      ]);
    const stable = release("1.2.0");
    f.fixtures.push(stable);
    await f.updater.refresh();
    const offers = await Promise.all([one.next(), two.next()]);
    assert.notDeepEqual(offers[0][6], offers[1][6]);
    for (const offer of offers) {
      assert.deepEqual(offer.slice(0, 4), [
        TYPE.UPDATE_AVAILABLE,
        V,
        "1.2.0",
        stable.bytes.length,
      ]);
      assert.equal(Buffer.from(offer[4]).toString("hex"), stable.record.sha256);
      const response = await download(f.runtime, offer);
      assert.equal(response.status, 200);
      assert.deepEqual(response.bytes, stable.bytes);
    }
    assert.equal(
      f.remote.calls.filter((url) => url.includes("/download/")).length,
      1,
    );
    one.ws.terminate();
    const candidate = await connect(f.runtime, "one", "1.2.0");
    assert.deepEqual(await candidate.next(), [
      TYPE.FIRMWARE_ACCEPTED,
      V,
      "1.2.0",
    ]);
    await pause();
    assert.equal(candidate.messages.length, 0);
  },
);

test(
  "honors per-device opt-outs, exact pins, hardware, and semantic no-downgrade rules",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(
      t,
      {
        optedOut: { autoUpdate: false },
        pinned: { targetVersion: "1.1.0" },
        missingPin: { targetVersion: "1.9.0" },
        current: {},
        newer: {},
        other: {},
        prerelease: {},
      },
      [release("1.2.0")],
    );
    const older = release("1.1.0");
    f.updater.install(older.record, older.bytes);
    for (const [id, current, hardware] of [
      ["optedOut", "1.0.0", HARDWARE],
      ["current", "1.2.0", HARDWARE],
      ["newer", "2.0.0", HARDWARE],
      ["other", "1.0.0", "other-hardware"],
    ]) {
      const keypad = await connect(f.runtime, id, current, hardware);
      assert.equal((await keypad.next())[0], TYPE.FIRMWARE_ACCEPTED);
      await pause();
      assert.equal(keypad.messages.length, 0, id);
    }
    const missing = await connect(f.runtime, "missingPin");
    await pause();
    assert.equal(missing.messages.length, 0);
    const pinned = await connect(f.runtime, "pinned");
    assert.deepEqual((await pinned.next()).slice(0, 3), [
      TYPE.UPDATE_AVAILABLE,
      V,
      "1.1.0",
    ]);
    const prerelease = await connect(f.runtime, "prerelease", "1.2.0-rc.1");
    assert.equal((await prerelease.next())[0], TYPE.FIRMWARE_ACCEPTED);
    assert.equal((await prerelease.next())[2], "1.2.0");
    assert.equal(compareVersions("1.2.0+build", "1.2.0"), 0);
    assert.ok(compareVersions("1.2.0", "1.2.0-rc.1") > 0);
  },
);

test(
  "acknowledges a returning candidate before offering a newer release",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, { one: {} }, [release("1.3.0")]);
    const candidate = await connect(f.runtime, "one", "1.2.0");
    assert.deepEqual(await candidate.next(), [
      TYPE.FIRMWARE_ACCEPTED,
      V,
      "1.2.0",
    ]);
    assert.deepEqual((await candidate.next()).slice(0, 3), [
      TYPE.UPDATE_AVAILABLE,
      V,
      "1.3.0",
    ]);
  },
);

test(
  "invalid newest release is never offered and disk tampering fails closed before HTTP bytes",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, { one: {} }, [release("1.2.0")]);
    const keypad = await connect(f.runtime, "one");
    await keypad.next();
    const offer = await keypad.next();
    const forgedBytes = Buffer.from(release("1.3.0").bytes);
    forgedBytes[20] ^= 1;
    f.fixtures.push(release("1.3.0", { bytes: forgedBytes }));
    await assert.rejects(f.updater.refresh(), /signature/i);
    assert.equal(f.updater.latest(HARDWARE).version, "1.2.0");
    const cached = f.updater.latest(HARDWARE);
    fs.writeFileSync(cached.file, Buffer.alloc(cached.size));
    const response = await download(f.runtime, offer);
    assert.equal(response.status, 503);
    assert.equal(response.bytes.length, 0);
    f.advance();
    f.updater.emit("checked");
    await pause();
    assert.equal(keypad.messages.length, 0);
  },
);

test(
  "throttles offers across checks and reconnects but permits a later retry",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, { one: {} }, [release("1.2.0")]);
    const first = await connect(f.runtime, "one");
    await first.next();
    assert.equal((await first.next())[0], TYPE.UPDATE_AVAILABLE);
    for (let i = 0; i < 3; i++) f.updater.emit("checked");
    await pause();
    assert.equal(first.messages.length, 0);
    const disconnected = once(first.ws, "close");
    first.ws.terminate();
    await disconnected;
    const again = await connect(f.runtime, "one");
    assert.equal((await again.next())[0], TYPE.FIRMWARE_ACCEPTED);
    await pause();
    assert.equal(again.messages.length, 0);
    f.advance();
    f.updater.emit("checked");
    assert.equal((await again.next())[0], TYPE.UPDATE_AVAILABLE);
  },
);

test(
  "production enables discovery by default; explicit opt-out and invalid configuration are respected",
  { timeout: 10000 },
  async (t) => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "mindflayer-auto-default-"),
    );
    const options = {
      foundryPort: 0,
      devicePort: 0,
      host: "127.0.0.1",
      deviceHost: "127.0.0.1",
      devicesFile: path.join(root, "devices.json"),
      firmwareDir: path.join(root, "manual"),
      tlsDir: path.join(root, "tls"),
      firmwareCacheDir: path.join(root, "cache"),
    };
    const old = process.env.MINDFLAYER_FIRMWARE_AUTO_UPDATE;
    delete process.env.MINDFLAYER_FIRMWARE_AUTO_UPDATE;
    t.after(() => {
      if (old === undefined) delete process.env.MINDFLAYER_FIRMWARE_AUTO_UPDATE;
      else process.env.MINDFLAYER_FIRMWARE_AUTO_UPDATE = old;
      fs.rmSync(root, { recursive: true, force: true });
    });
    const runtime = startAll(options);
    // Substitute only the network transport before the listening event starts polling.
    // The default configuration still constructs the real production-key verifier.
    let requests = 0;
    let aborted;
    runtime.device.firmwareUpdater.request = async (_url, { signal }) => {
      requests++;
      return new Promise((_resolve, reject) => {
        aborted = once(signal, "abort");
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    };
    await Promise.all([
      once(runtime.foundry.server, "listening"),
      once(runtime.device.server, "listening"),
    ]);
    assert.equal(requests, 1);
    const updater = runtime.device.firmwareUpdater;
    const pending = updater.inFlight;
    for (const side of [runtime.foundry, runtime.device]) {
      const closed = once(side.server, "close");
      side.wss.close();
      side.server.close();
      await closed;
    }
    await aborted;
    await assert.rejects(pending);
    assert.equal(updater.running, false);
    assert.equal(updater.listenerCount("available"), 0);
    assert.equal(updater.listenerCount("checked"), 0);
    process.env.MINDFLAYER_FIRMWARE_AUTO_UPDATE = "false";
    const disabled = startAll(options);
    assert.equal(disabled.device.firmwareUpdater, null);
    await Promise.all([
      once(disabled.foundry.server, "listening"),
      once(disabled.device.server, "listening"),
    ]);
    for (const side of [disabled.foundry, disabled.device]) {
      const closed = once(side.server, "close");
      side.wss.close();
      side.server.close();
      await closed;
    }
    assert.equal(autoUpdateEnabled(), false);
    assert.equal(autoUpdateEnabled(true), true);
    assert.throws(
      () => startAll({ ...options, autoFirmwareUpdates: "typo" }),
      /true or false/,
    );
    assert.throws(
      () =>
        startAll({
          ...options,
          autoFirmwareUpdates: true,
          firmwarePollIntervalMs: 0,
        }),
      /interval/,
    );
  },
);

test("periodic offers discard expired unused download grants", () => {
  let now = 0;
  const tokens = new OtaTokens({ lifetimeMs: 5, now: () => now });
  tokens.issue("one", {});
  now = 6;
  const current = tokens.issue("two", {});
  assert.equal(tokens.tokens.size, 1);
  assert.equal(tokens.consume(current).deviceId, "two");
});
