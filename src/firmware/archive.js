const zlib = require("node:zlib");
const {
  HARDWARE,
  MAX_SIGNED,
  requireValid,
  validateMetadata,
  verifyFirmware,
} = require("./verify");
const MAX_ARCHIVE = 2 * 1024 * 1024;
const MAX_MANIFEST = 16 * 1024;

function field(header, start, size) {
  return header
    .subarray(start, start + size)
    .toString("ascii")
    .replace(/\0.*$/s, "");
}
function octal(header, start, size) {
  const text = field(header, start, size).trim();
  requireValid(/^[0-7]+$/.test(text), "Invalid tar numeric field");
  return parseInt(text, 8);
}

// Parse in memory; never extract release-controlled paths, links or extensions.
function unpackRelease(compressed, version, publicKey) {
  requireValid(
    compressed.length > 0 && compressed.length <= MAX_ARCHIVE,
    "Archive too large",
  );
  const tar = zlib.gunzipSync(compressed, { maxOutputLength: MAX_ARCHIVE });
  const artifact = HARDWARE + "/" + version + "/firmware.bin.signed";
  const allowedDirectories = new Set([
    "",
    HARDWARE + "/",
    HARDWARE + "/" + version + "/",
  ]);
  const files = new Map();
  let offset = 0,
    ended = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      requireValid(
        tar.length - offset >= 1024 &&
          tar.subarray(offset).every((byte) => byte === 0),
        "Invalid tar terminator",
      );
      ended = true;
      break;
    }
    let checksum = 0;
    for (let i = 0; i < 512; i++)
      checksum += i >= 148 && i < 156 ? 32 : header[i];
    requireValid(
      checksum === octal(header, 148, 8),
      "Invalid tar header checksum",
    );
    const prefix = field(header, 345, 155);
    requireValid(!prefix, "Tar path prefixes are not supported");
    const name = field(header, 0, 100).replace(/^\.\//, "");
    const size = octal(header, 124, 12),
      type = header[156];
    offset += 512;
    requireValid(
      size <= MAX_SIGNED && offset + size <= tar.length,
      "Oversized or truncated tar member",
    );
    if (type === 53)
      requireValid(
        size === 0 && allowedDirectories.has(name),
        "Unexpected tar directory",
      );
    else {
      requireValid(
        (type === 0 || type === 48) &&
          (name === "manifest.json" || name === artifact) &&
          !files.has(name),
        "Unexpected, unsafe or duplicate tar member",
      );
      requireValid(
        name !== "manifest.json" || size <= MAX_MANIFEST,
        "Manifest too large",
      );
      files.set(name, tar.subarray(offset, offset + size));
    }
    offset += Math.ceil(size / 512) * 512;
  }
  requireValid(ended && files.size === 2, "Incomplete release archive");
  const manifest = JSON.parse(files.get("manifest.json").toString("utf8"));
  requireValid(
    manifest.version === 1 &&
      Array.isArray(manifest.releases) &&
      manifest.releases.length === 1,
    "Invalid release manifest",
  );
  const release = manifest.releases[0];
  validateMetadata(release);
  requireValid(
    release.version === version && release.artifact === artifact,
    "Release tag/manifest mismatch",
  );
  const bytes = files.get(artifact);
  verifyFirmware(bytes, release, publicKey);
  return { release, bytes };
}

module.exports = { MAX_ARCHIVE, MAX_MANIFEST, unpackRelease };
