const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { GithubFirmwareUpdater } = require("../src/firmware/github-updater");
const { download, trustedUrl } = require("../src/firmware/download");
const { unpackRelease, MAX_ARCHIVE } = require("../src/firmware/archive");
const {
  verifyFirmware,
  PUBLIC_KEY,
  HARDWARE,
  sha256,
} = require("../src/firmware/verify");
const fixture = require("./helpers/firmware-release.cjs");

function updater(t, releases = [], overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mindflayer-discovery-"));
  const source = fixture.source(releases);
  const warnings = [];
  const options = {
    root,
    publicKey: fixture.publicKey,
    request: source.request,
    logger: { warn: (message) => warnings.push(message) },
    ...overrides,
  };
  const service = new GithubFirmwareUpdater(options);
  t.after(() => {
    service.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { service, root, source, warnings, options };
}

test("bundled public key matches the deployed keypad trust anchor", () => {
  assert.equal(
    sha256(PUBLIC_KEY.export({ type: "spki", format: "der" })),
    "aa60b6f834754980d279bfdf94c082c5d013eb7cbbc07843b9249ec0334bc2b1",
  );
});

test("verifies signature, identity, size, SHA-256 and boot2 structure independently", () => {
  const good = fixture.release();
  assert.deepEqual(
    verifyFirmware(good.bytes, good.record, fixture.publicKey),
    good.bytes,
  );
  for (const mutate of [
    (bytes) => {
      bytes[30] ^= 1;
    },
    (bytes) => {
      bytes[bytes.length - 20] ^= 1;
    },
    (bytes) => bytes.writeUInt32LE(255, bytes.length - 4),
  ]) {
    const bad = Buffer.from(good.bytes);
    mutate(bad);
    assert.throws(
      () =>
        verifyFirmware(
          bad,
          { ...good.record, sha256: sha256(bad) },
          fixture.publicKey,
        ),
      /signature|trailer/,
    );
  }
  assert.throws(
    () => verifyFirmware(good.bytes, good.record, PUBLIC_KEY),
    /signature/,
  );
  assert.throws(
    () =>
      verifyFirmware(
        good.bytes,
        { ...good.record, size: good.bytes.length + 1 },
        fixture.publicKey,
      ),
    /size/,
  );
  assert.throws(
    () =>
      verifyFirmware(
        good.bytes,
        { ...good.record, sha256: "00".repeat(32) },
        fixture.publicKey,
      ),
    /SHA/,
  );
  assert.throws(
    () =>
      verifyFirmware(
        good.bytes,
        { ...good.record, version: "1.3.0" },
        fixture.publicKey,
      ),
    /identity/,
  );
  for (const mutate of [
    (body) => {
      body[0] = 0xe9;
    },
    (body) => {
      body[175] ^= 1;
    },
    (body) => body.writeUInt32LE(0x50000000, 152),
  ]) {
    const body = fixture.image("1.2.0");
    mutate(body);
    const bytes = fixture.signed("1.2.0", body);
    assert.throws(
      () =>
        verifyFirmware(
          bytes,
          { ...good.record, sha256: sha256(bytes) },
          fixture.publicKey,
        ),
      /header|checksum|segment/,
    );
  }
});

test("archive parser rejects traversal, symlinks, duplicates, malformed headers and bombs", () => {
  const good = fixture.release();
  assert.deepEqual(
    unpackRelease(good.bundle, "1.2.0", fixture.publicKey).bytes,
    good.bytes,
  );
  for (const entry of [
    ["../escape", Buffer.from("x")],
    ["/escape", Buffer.from("x")],
    ["link", Buffer.alloc(0), "2"],
    good.entries[0],
  ]) {
    assert.throws(
      () =>
        unpackRelease(
          fixture.archive([...good.entries, entry]),
          "1.2.0",
          fixture.publicKey,
        ),
      /member/,
    );
  }
  const tar = zlib.gunzipSync(good.bundle);
  tar[0] ^= 1;
  assert.throws(
    () => unpackRelease(zlib.gzipSync(tar), "1.2.0", fixture.publicKey),
    /checksum/,
  );
  assert.throws(
    () => unpackRelease(good.bundle, "1.3.0", fixture.publicKey),
    /member|mismatch/,
  );
  assert.throws(() =>
    unpackRelease(
      zlib.gzipSync(Buffer.alloc(MAX_ARCHIVE + 1)),
      "1.2.0",
      fixture.publicKey,
    ),
  );
  assert.throws(
    () =>
      unpackRelease(
        fixture.archive([good.entries[0]]),
        "1.2.0",
        fixture.publicKey,
      ),
    /Incomplete/,
  );
});

test("discovers newest stable version, commits only verified files and reuses offline cache", async (t) => {
  const old = fixture.release("1.9.0"),
    newer = fixture.release("1.10.0"),
    pre = fixture.release("2.0.0-rc.1"),
    draft = fixture.release("3.0.0");
  pre.github.prerelease = true;
  draft.github.draft = true;
  const { service, source, options } = updater(t, [old, pre, newer, draft]);
  let published = 0;
  service.on("available", () => published++);
  assert.equal((await service.refresh()).version, "1.10.0");
  assert.equal(source.calls.length, 2);
  assert.equal(service.latest("other-hardware"), undefined);
  assert.equal(service.latest(HARDWARE).version, "1.10.0");
  assert.equal(published, 1);
  assert.equal(await service.refresh(), null);
  assert.equal(published, 1);
  const offline = new GithubFirmwareUpdater({
    ...options,
    request: async () => {
      throw new Error("offline");
    },
  });
  t.after(() => offline.stop());
  assert.equal(offline.latest(HARDWARE).version, "1.10.0");
  assert.deepEqual(offline.read(offline.latest(HARDWARE)), newer.bytes);
  await assert.rejects(offline.refresh(), /offline/);
  assert.equal(offline.latest(HARDWARE).version, "1.10.0");
});

test("rejects unsigned/tampered downloads even when the archive and manifest hashes are recomputed", async (t) => {
  const good = fixture.release("1.1.0");
  const bytes = fixture.signed("1.2.0");
  bytes[30] ^= 1;
  const bad = fixture.release("1.2.0", { bytes });
  const { service, root } = updater(t, [bad, good]);
  assert.equal((await service.refresh()).version, "1.1.0");
  assert(!fs.readdirSync(root).some((name) => name.startsWith("1.2.0-")));
  service.request = fixture.source([bad]).request;
  await assert.rejects(service.refresh(), /signature/);
  assert.equal(service.latest(HARDWARE).version, "1.1.0");
});

test("rejects archive digest mismatch and unsupported release metadata without caching it", async (t) => {
  const bad = fixture.release();
  bad.github.assets[0].digest = "sha256:" + "00".repeat(32);
  const { service, root } = updater(t, [bad]);
  await assert.rejects(service.refresh(), /SHA/);
  assert.deepEqual(fs.readdirSync(root), []);
  for (const mutate of [
    (item) => (item.assets[0].browser_download_url = "https://evil.example/fw"),
    (item) => (item.assets[0].size = MAX_ARCHIVE + 1),
    (item) => (item.tag_name = "v01.2.0"),
  ]) {
    const release = fixture.release();
    mutate(release.github);
    service.request = fixture.source([release]).request;
    assert.equal(await service.refresh(), null);
  }
});

test("revalidates disk cache on restart and before use, ignoring incomplete writes and symlinks", async (t) => {
  const { service, root, options } = updater(t, [fixture.release()]);
  const release = await service.refresh();
  fs.writeFileSync(path.join(root, ".incoming-orphan"), "incomplete");
  fs.writeFileSync(release.file, Buffer.alloc(release.size));
  assert.throws(() => service.read(release), /SHA/);
  const restored = new GithubFirmwareUpdater(options);
  t.after(() => restored.stop());
  assert.equal(restored.latest(HARDWARE), undefined);
  assert.equal((await restored.refresh()).version, "1.2.0");
  fs.unlinkSync(release.file);
  fs.symlinkSync(path.join(root, ".incoming-orphan"), release.file);
  assert.throws(() => restored.read(release));
});

test("serializes refreshes and stops/aborts the scheduled poller", async (t) => {
  const good = fixture.release();
  const { service } = updater(t, [good]);
  const one = service.refresh(),
    two = service.refresh();
  assert.equal(one, two);
  await one;
  let calls = 0;
  service.request = (_url, { signal }) =>
    new Promise((resolve, reject) => {
      calls++;
      signal.addEventListener("abort", () => reject(new Error("aborted")), {
        once: true,
      });
    });
  service.start();
  service.start();
  assert.equal(calls, 1);
  const pending = service.inFlight;
  service.stop();
  await assert.rejects(pending, /aborted/);
  assert.equal(service.running, false);
  assert.equal(service.timer, undefined);
});

test("HTTPS downloader limits headers, streaming size, redirects and origin scope", async () => {
  for (const url of [
    "http://github.com/x",
    "https://127.0.0.1/x",
    "https://github.com.evil.example/x",
    "https://user:pass@github.com/x",
    "https://github.com:444/x",
  ])
    assert.throws(() => trustedUrl(url), /Untrusted/);
  const get = (fetchImpl) =>
    download("https://github.com/example", { maximum: 4, fetchImpl });
  assert.deepEqual(
    await get(async () => new Response("okay")),
    Buffer.from("okay"),
  );
  await assert.rejects(
    get(
      async () => new Response("x", { headers: { "content-length": "100" } }),
    ),
    /limit/,
  );
  await assert.rejects(
    get(async () => new Response("12345")),
    /limit/,
  );
  await assert.rejects(
    get(async () => new Response("x", { headers: { "content-length": "4" } })),
    /Truncated/,
  );
  await assert.rejects(
    get(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/private" },
        }),
    ),
    /Untrusted/,
  );
  let redirects = 0;
  await assert.rejects(
    get(async () => {
      redirects++;
      return new Response(null, {
        status: 302,
        headers: { location: "/loop" },
      });
    }),
    /redirects/,
  );
  assert.equal(redirects, 4);
  await assert.rejects(
    get(
      async () =>
        new Response(null, { status: 429, headers: { "retry-after": "120" } }),
    ),
    (error) => error.retryAfterMs >= 120000,
  );
  await assert.rejects(
    download("https://github.com/example", {
      maximum: 4,
      timeoutMs: 10,
      fetchImpl: (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    }),
    /timeout/i,
  );
});
