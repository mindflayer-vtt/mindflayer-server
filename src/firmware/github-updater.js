const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const semver = require("semver");
const { download } = require("./download");
const { unpackRelease, MAX_ARCHIVE, MAX_MANIFEST } = require("./archive");
const {
  HARDWARE,
  MAX_SIGNED,
  PUBLIC_KEY,
  stableVersion,
  sha256,
  validateMetadata,
  verifyFirmware,
  readBounded,
  requireValid,
} = require("./verify");

const REPOSITORY = "mindflayer-vtt/mindflayer-keypad";
const RELEASES_URL = "https://api.github.com/repos/" + REPOSITORY + "/releases";
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

class GithubFirmwareUpdater extends EventEmitter {
  constructor({
    root,
    publicKey = PUBLIC_KEY,
    request = download,
    intervalMs = DEFAULT_INTERVAL_MS,
    logger = console,
  } = {}) {
    super();
    requireValid(
      typeof root === "string" && root.length > 0,
      "Firmware cache directory required",
    );
    requireValid(
      Number.isSafeInteger(intervalMs) &&
        intervalMs >= 60000 &&
        intervalMs <= 86400000,
      "Firmware poll interval must be 60..86400 seconds",
    );
    requireValid(
      publicKey.asymmetricKeyType === "rsa" &&
        publicKey.asymmetricKeyDetails.modulusLength === 2048,
      "Expected RSA-2048 firmware public key",
    );
    this.root = path.resolve(root);
    this.publicKey = publicKey;
    this.request = request;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this.releases = new Map();
    this.running = false;
    this.load();
  }
  warn(error) {
    this.logger.warn("Firmware discovery: " + error.message);
  }
  filename(release) {
    return release.version + "-" + release.sha256;
  }
  record(release) {
    return Object.freeze({
      hardware: release.hardware,
      version: release.version,
      size: release.size,
      sha256: release.sha256,
      file: path.join(this.root, this.filename(release) + ".bin"),
      automatic: true,
    });
  }
  load() {
    try {
      fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
      requireValid(
        !fs.lstatSync(this.root).isSymbolicLink(),
        "Firmware cache must not be a symlink",
      );
      const names = fs
        .readdirSync(this.root)
        .filter(
          (name) =>
            /^(.+)-[0-9a-f]{64}\.json$/.test(name) &&
            stableVersion(name.slice(0, -70)),
        );
      names.sort((a, b) => semver.rcompare(a.slice(0, -70), b.slice(0, -70)));
      for (const name of names.slice(0, 64)) {
        try {
          const metadata = JSON.parse(
            readBounded(path.join(this.root, name), MAX_MANIFEST),
          );
          validateMetadata(metadata);
          requireValid(
            name === this.filename(metadata) + ".json",
            "Cache identity mismatch",
          );
          const release = this.record(metadata);
          this.read(release);
          this.releases.set(release.version, release);
        } catch (error) {
          this.warn(error);
        }
      }
    } catch (error) {
      this.warn(error);
    }
  }
  read(release) {
    return verifyFirmware(
      readBounded(release.file, MAX_SIGNED),
      release,
      this.publicKey,
    );
  }
  get(hardware, version) {
    return hardware === HARDWARE ? this.releases.get(version) : undefined;
  }
  latest(hardware) {
    if (hardware !== HARDWARE) return undefined;
    return [...this.releases.values()].sort((a, b) =>
      semver.rcompare(a.version, b.version),
    )[0];
  }
  install(metadata, bytes) {
    const release = this.record(metadata);
    verifyFirmware(bytes, release, this.publicKey);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    requireValid(
      !fs.lstatSync(this.root).isSymbolicLink(),
      "Firmware cache must not be a symlink",
    );
    const temporary = path.join(
      this.root,
      ".incoming-" + crypto.randomBytes(12).toString("hex"),
    );
    const writeAtomic = (data, destination) => {
      const fd = fs.openSync(temporary, "wx", 0o600);
      try {
        fs.writeFileSync(fd, data);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temporary, destination);
    };
    try {
      writeAtomic(bytes, release.file);
      // The index record is the commit point: startup ignores orphan binaries.
      writeAtomic(
        JSON.stringify({
          hardware: release.hardware,
          version: release.version,
          size: release.size,
          sha256: release.sha256,
        }) + "\n",
        path.join(this.root, this.filename(release) + ".json"),
      );
      const fd = fs.openSync(this.root, fs.constants.O_RDONLY);
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      this.releases.set(release.version, release);
      this.emit("available", release);
      return release;
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  async discover(signal) {
    const releases = [];
    for (let page = 1; page <= 5; page++) {
      const bytes = await this.request(
        RELEASES_URL + "?per_page=100&page=" + page,
        { maximum: 2 * 1024 * 1024, signal },
      );
      const items = JSON.parse(bytes);
      requireValid(
        Array.isArray(items) && items.length <= 100,
        "Invalid GitHub release listing",
      );
      for (const item of items) {
        if (
          item?.draft !== false ||
          item.prerelease !== false ||
          typeof item.tag_name !== "string" ||
          !item.tag_name.startsWith("v")
        )
          continue;
        const version = item.tag_name.slice(1);
        if (!stableVersion(version) || !Array.isArray(item.assets)) continue;
        const name = "mindflayer-keypad-" + version + "-server-firmware.tar.gz";
        const assets = item.assets.filter(
          (asset) => asset.name === name && asset.state === "uploaded",
        );
        if (assets.length !== 1) continue;
        const asset = assets[0];
        const url =
          "https://github.com/" +
          REPOSITORY +
          "/releases/download/" +
          encodeURIComponent(item.tag_name) +
          "/" +
          encodeURIComponent(name);
        if (
          asset.browser_download_url !== url ||
          !Number.isSafeInteger(asset.size) ||
          asset.size <= 0 ||
          asset.size > MAX_ARCHIVE
        )
          continue;
        if (asset.digest != null && !/^sha256:[0-9a-f]{64}$/.test(asset.digest))
          continue;
        releases.push({ version, url, size: asset.size, digest: asset.digest });
      }
      if (items.length < 100) break;
      requireValid(page < 5, "GitHub release listing exceeds pagination limit");
    }
    return releases.sort((a, b) => semver.rcompare(a.version, b.version));
  }
  refresh() {
    if (this.inFlight) return this.inFlight;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.inFlight = (async () => {
      const candidates = await this.discover(signal);
      let failure;
      for (const candidate of candidates.slice(0, 10)) {
        const current = this.latest(HARDWARE);
        if (current && semver.gte(current.version, candidate.version)) break;
        try {
          const bytes = await this.request(candidate.url, {
            maximum: candidate.size,
            signal,
          });
          requireValid(
            bytes.length === candidate.size &&
              (!candidate.digest ||
                candidate.digest === "sha256:" + sha256(bytes)),
            "Release asset SHA-256 or size mismatch",
          );
          const { release, bytes: firmware } = unpackRelease(
            bytes,
            candidate.version,
            this.publicKey,
          );
          signal.throwIfAborted();
          return this.install(release, firmware);
        } catch (error) {
          if (signal.aborted || error.retryAfterMs) throw error;
          failure = error;
          this.warn(error);
        }
      }
      if (failure) throw failure;
      return null;
    })().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
  start() {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      let delay = this.intervalMs;
      try {
        await this.refresh();
      } catch (error) {
        if (this.running) this.warn(error);
        delay = Math.max(delay, error.retryAfterMs || 0);
      }
      if (this.running) {
        this.emit("checked");
        this.timer = setTimeout(tick, delay);
        this.timer.unref();
      }
    };
    void tick();
  }
  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.controller?.abort();
  }
}

module.exports = { GithubFirmwareUpdater, RELEASES_URL, DEFAULT_INTERVAL_MS };
