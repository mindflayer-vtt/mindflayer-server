// Root-side installation support. Returned values contain credentials and must
// never be serialized into public job results or logs. This module never writes.
const crypto = require("crypto");
const { crc32, decodePayload, MAX_PAYLOAD_SIZE } = require("./format");

const SECTOR_SIZE = 4096;

function readRecord(sector) {
  if (!Buffer.isBuffer(sector) || sector.length !== SECTOR_SIZE)
    throw new Error("Provisioning sector must contain exactly 4096 bytes");
  if (
    sector.subarray(0, 4).toString("hex") !== "4d465231" ||
    sector[4] !== 1 ||
    sector.subarray(-4).toString("hex") !== "4d465043"
  )
    return null;
  const size = sector.readUInt16BE(9);
  if (
    !size ||
    size > MAX_PAYLOAD_SIZE ||
    sector.readUInt32BE(11 + size) !== crc32(sector.subarray(0, 11 + size))
  )
    return null;
  try {
    return {
      generation: sector.readUInt32BE(5),
      values: decodePayload(sector.subarray(11, 11 + size)),
    };
  } catch {
    return null;
  }
}

function selectProvisioning(sectorA, sectorB) {
  const a = readRecord(sectorA),
    b = readRecord(sectorB);
  if (!a && !b)
    return {
      state:
        sectorA.every((byte) => byte === 255) &&
        sectorB.every((byte) => byte === 255)
          ? "blank"
          : "invalid",
    };
  // Exactly the firmware's uint32 serial-number comparison; ties choose B.
  const newer =
    a &&
    b &&
    a.generation !== b.generation &&
    (a.generation - b.generation) >>> 0 < 0x80000000;
  const copy = a && (!b || newer) ? "A" : "B";
  return { state: "configured", copy, ...(copy === "A" ? a : b) };
}

function classifyProvisioning(sectorA, sectorB, devices, serverPublicKey) {
  const selected = selectProvisioning(sectorA, sectorB);
  if (selected.state !== "configured") return selected;
  const {
    deviceId,
    deviceSecret,
    serverPublicKey: pinnedKey,
  } = selected.values;
  const known = Object.hasOwn(devices, deviceId) ? devices[deviceId] : null;
  const secret =
    known &&
    typeof known.secret === "string" &&
    /^[a-f0-9]{64}$/i.test(known.secret)
      ? Buffer.from(known.secret, "hex")
      : null;
  const local =
    secret &&
    crypto.timingSafeEqual(secret, deviceSecret) &&
    Buffer.isBuffer(serverPublicKey) &&
    serverPublicKey.equals(pinnedKey);
  return { ...selected, ownership: local ? "local" : "foreign" };
}

module.exports = {
  SECTOR_SIZE,
  readRecord,
  selectProvisioning,
  classifyProvisioning,
};
