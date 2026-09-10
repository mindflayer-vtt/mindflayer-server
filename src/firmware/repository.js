const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const VERSION =
  /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const HARDWARE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

class FirmwareRepository {
  constructor(root, manifestFile = "manifest.json") {
    this.root = path.resolve(root);
    this.releases = new Map();
    const manifestPath = path.resolve(this.root, manifestFile);
    if (!manifestPath.startsWith(this.root + path.sep))
      throw new Error("Manifest is outside firmware repository");
    if (!fs.existsSync(manifestPath)) return;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.version !== 1 || !Array.isArray(manifest.releases))
      throw new Error("Invalid firmware manifest");
    for (const release of manifest.releases) this.add(release);
  }
  add(release) {
    if (
      !release ||
      !HARDWARE.test(release.hardware || "") ||
      !VERSION.test(release.version || "")
    )
      throw new Error("Invalid firmware release identity");
    if (
      !Number.isSafeInteger(release.size) ||
      release.size <= 0 ||
      !/^[0-9a-f]{64}$/i.test(release.sha256 || "")
    )
      throw new Error("Invalid firmware release metadata");
    if (
      typeof release.artifact !== "string" ||
      path.isAbsolute(release.artifact)
    )
      throw new Error("Invalid firmware artifact path");
    const file = path.resolve(this.root, release.artifact);
    if (!file.startsWith(this.root + path.sep))
      throw new Error("Firmware path traversal rejected");
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size !== release.size)
      throw new Error("Firmware artifact size mismatch");
    const digest = crypto
      .createHash("sha256")
      .update(fs.readFileSync(file))
      .digest("hex");
    if (
      !crypto.timingSafeEqual(
        Buffer.from(digest, "hex"),
        Buffer.from(release.sha256, "hex"),
      )
    )
      throw new Error("Firmware artifact hash mismatch");
    this.releases.set(`${release.hardware}\0${release.version}`, {
      ...release,
      file,
    });
  }
  get(hardware, version) {
    return this.releases.get(`${hardware}\0${version}`);
  }
}

module.exports = { FirmwareRepository, VERSION };
