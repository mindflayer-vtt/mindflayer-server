const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const semver = require("semver");

const HARDWARE = "mindflayer-keypad-v1";
const MAX_IMAGE = 0xfe000;
const MAX_SIGNED = MAX_IMAGE + 260;
const PUBLIC_KEY = crypto.createPublicKey(
  fs.readFileSync(path.join(__dirname, "firmware-signing-public.pem")),
);
const sha256 = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
const stableVersion = (version) =>
  typeof version === "string" &&
  version.length <= 47 &&
  semver.valid(version) === version &&
  semver.prerelease(version) === null;
function requireValid(condition, message) {
  if (!condition) throw new Error(message);
}

function validateMetadata(release) {
  requireValid(
    release && release.hardware === HARDWARE && stableVersion(release.version),
    "Invalid firmware identity",
  );
  requireValid(
    Number.isSafeInteger(release.size) &&
      release.size > 260 &&
      release.size <= MAX_SIGNED,
    "Invalid firmware size",
  );
  requireValid(
    typeof release.sha256 === "string" && /^[0-9a-f]{64}$/.test(release.sha256),
    "Invalid firmware SHA-256",
  );
}

// Mirrors the serial installer's unsigned ESP8266 boot2 structural checks.
function verifyBoot2(bytes) {
  requireValid(
    bytes.length >= 32 &&
      bytes.length <= MAX_IMAGE &&
      bytes.subarray(0, 4).equals(Buffer.from([0xea, 4, 2, 0x40])),
    "Invalid rBoot image header",
  );
  const entry = bytes.readUInt32LE(4),
    length = bytes.readUInt32LE(12);
  requireValid(
    bytes.readUInt32LE(8) === 0 && length > 0 && length <= bytes.length - 16,
    "Invalid IROM segment",
  );
  let checksum = 0xef;
  for (const byte of bytes.subarray(16, 16 + length)) checksum ^= byte;
  let offset = Math.ceil((16 + length) / 16) * 16;
  requireValid(offset + 8 <= bytes.length, "Truncated RAM header");
  const count = bytes[offset + 1];
  requireValid(
    bytes[offset] === 0xe9 &&
      count >= 1 &&
      count <= 16 &&
      bytes[offset + 2] === 2 &&
      bytes[offset + 3] === 0x40 &&
      bytes.readUInt32LE(offset + 4) === entry &&
      entry >= 0x40100000 &&
      entry < 0x40110000,
    "Invalid RAM header or entry point",
  );
  offset += 8;
  const segments = [];
  for (let i = 0; i < count; i++) {
    requireValid(offset + 8 <= bytes.length, "Truncated segment");
    const address = bytes.readUInt32LE(offset),
      size = bytes.readUInt32LE(offset + 4),
      end = address + size;
    offset += 8;
    requireValid(
      size > 0 &&
        size <= bytes.length - offset &&
        ((address >= 0x40100000 && end <= 0x40110000) ||
          (address >= 0x3ffe8000 && end <= 0x40000000)),
      "Invalid RAM segment",
    );
    requireValid(
      segments.every(([start, stop]) => end <= start || address >= stop),
      "Overlapping RAM segments",
    );
    segments.push([address, end]);
    for (const byte of bytes.subarray(offset, offset + size)) checksum ^= byte;
    offset += size;
  }
  requireValid(
    segments.some(([start, end]) => start <= entry && entry < end),
    "Entry point outside loaded segments",
  );
  const checksumOffset = Math.floor((offset + 16) / 16) * 16 - 1;
  requireValid(
    checksumOffset === bytes.length - 1 && bytes[checksumOffset] === checksum,
    "Invalid full IROM/RAM checksum or trailing data",
  );
}

function verifyFirmware(bytes, release, publicKey = PUBLIC_KEY) {
  validateMetadata(release);
  requireValid(
    bytes.length === release.size && sha256(bytes) === release.sha256,
    "Firmware size or SHA-256 mismatch",
  );
  requireValid(
    bytes.readUInt32LE(bytes.length - 4) === 256,
    "Invalid RSA signature trailer",
  );
  const body = bytes.subarray(0, bytes.length - 260),
    signature = bytes.subarray(bytes.length - 260, bytes.length - 4);
  requireValid(
    crypto.verify(
      "sha256",
      body,
      { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
      signature,
    ),
    "Firmware RSA signature rejected",
  );
  verifyBoot2(body);
  requireValid(
    body.includes(Buffer.from(release.version + "\0")) &&
      body.includes(Buffer.from(HARDWARE + "\0")),
    "Signed firmware identity does not match manifest",
  );
  return bytes;
}

function readBounded(file, maximum) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    requireValid(
      stat.isFile() && stat.size > 0 && stat.size <= maximum,
      "Invalid cached file size or type",
    );
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      requireValid(n > 0, "Truncated cached file");
      offset += n;
    }
    requireValid(
      fs.fstatSync(fd).size === stat.size,
      "Cached file changed while reading",
    );
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  HARDWARE,
  MAX_SIGNED,
  PUBLIC_KEY,
  sha256,
  stableVersion,
  validateMetadata,
  verifyBoot2,
  verifyFirmware,
  readBounded,
  requireValid,
};
