const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { HARDWARE, sha256 } = require("../../src/firmware/verify");
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

function image(version) {
  const bytes = Buffer.alloc(176);
  Buffer.from([0xea, 4, 2, 0x40]).copy(bytes);
  bytes.writeUInt32LE(0x40100000, 4);
  bytes.writeUInt32LE(128, 12);
  Buffer.from(HARDWARE + "\0" + version + "\0").copy(bytes, 16);
  Buffer.from([0xe9, 1, 2, 0x40]).copy(bytes, 144);
  bytes.writeUInt32LE(0x40100000, 148);
  bytes.writeUInt32LE(0x40100000, 152);
  bytes.writeUInt32LE(4, 156);
  let checksum = 0xef;
  for (const byte of bytes.subarray(16, 144)) checksum ^= byte;
  for (const byte of bytes.subarray(160, 164)) checksum ^= byte;
  bytes[175] = checksum;
  return bytes;
}
function signed(version, body = image(version), key = privateKey) {
  const signature = crypto.sign("sha256", body, key);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(signature.length);
  return Buffer.concat([body, signature, length]);
}
function archive(entries) {
  const blocks = [];
  for (const [name, data, type = "0"] of entries) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, 12);
    header.fill(32, 148, 156);
    header.write(type, 156, 1);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return zlib.gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
function release(
  version = "1.2.0",
  { bytes = signed(version), metadata = {}, extraEntries = [] } = {},
) {
  const artifact = HARDWARE + "/" + version + "/firmware.bin.signed";
  const record = {
    hardware: HARDWARE,
    version,
    artifact,
    size: bytes.length,
    sha256: sha256(bytes),
    ...metadata,
  };
  const entries = [
    [
      "./manifest.json",
      Buffer.from(JSON.stringify({ version: 1, releases: [record] })),
    ],
    ["./" + artifact, bytes],
    ...extraEntries,
  ];
  const bundle = archive(entries);
  const name = "mindflayer-keypad-" + version + "-server-firmware.tar.gz";
  const url =
    "https://github.com/mindflayer-vtt/mindflayer-keypad/releases/download/" +
    encodeURIComponent("v" + version) +
    "/" +
    encodeURIComponent(name);
  return {
    record,
    bytes,
    entries,
    bundle,
    github: {
      draft: false,
      prerelease: false,
      tag_name: "v" + version,
      assets: [
        {
          name,
          state: "uploaded",
          size: bundle.length,
          digest: "sha256:" + sha256(bundle),
          browser_download_url: url,
        },
      ],
    },
  };
}
function source(fixtures) {
  const calls = [];
  return {
    calls,
    request: async (url, { maximum, signal }) => {
      signal?.throwIfAborted();
      calls.push(url);
      const bytes = url.startsWith("https://api.github.com/")
        ? Buffer.from(JSON.stringify(fixtures.map((f) => f.github)))
        : fixtures.find((f) => f.github.assets[0].browser_download_url === url)
            ?.bundle;
      if (!bytes || bytes.length > maximum)
        throw new Error("Missing or oversized fixture");
      return bytes;
    },
  };
}
module.exports = { publicKey, image, signed, archive, release, source };
