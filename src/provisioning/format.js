const crypto = require('crypto')
const cbor = require('cbor')
const MAGIC = Buffer.from('MFP1')
const ENVELOPE_VERSION = 1
const MAX_PAYLOAD_SIZE = 1024
const MAX_ENVELOPE_SIZE = 1035
function crc32(data) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) } return (crc ^ 0xffffffff) >>> 0 }
function text(value, max, name, allowEmpty = false) { if (typeof value !== 'string' || (!allowEmpty && !value.length) || Buffer.byteLength(value) > max) throw new Error(`Invalid ${name}`); return value }
function validate(values) {
  text(values.deviceId, 64, 'device ID'); if (!Buffer.isBuffer(values.deviceSecret) || values.deviceSecret.length !== 32) throw new Error('Invalid device secret')
  text(values.ssid, 32, 'Wi-Fi SSID'); text(values.wifiPassword, 63, 'Wi-Fi password', true); text(values.serverHost, 253, 'server host')
  if (!Number.isInteger(values.serverPort) || values.serverPort < 1 || values.serverPort > 65535) throw new Error('Invalid server port')
  if (!Buffer.isBuffer(values.serverPublicKey) || values.serverPublicKey.length < 32 || values.serverPublicKey.length > 512) throw new Error('Invalid server public key length')
  const key = crypto.createPublicKey({ key: values.serverPublicKey, format: 'der', type: 'spki' }); if (!['rsa', 'ec'].includes(key.asymmetricKeyType)) throw new Error('Unsupported server public key')
  return values
}
function encodePayload(values) {
  validate(values)
  const payload = cbor.encodeCanonical(new Map([[0, 1], [1, values.deviceId], [2, values.deviceSecret], [3, values.ssid], [4, values.wifiPassword], [5, values.serverHost], [6, values.serverPort], [7, values.serverPublicKey]]))
  if (!payload.length || payload.length > MAX_PAYLOAD_SIZE) throw new Error('Provisioning payload exceeds limit')
  return payload
}
function encodeEnvelope(values) {
  const payload = encodePayload(values); const header = Buffer.alloc(7); MAGIC.copy(header); header[4] = ENVELOPE_VERSION; header.writeUInt16BE(payload.length, 5)
  const body = Buffer.concat([header, payload]); const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(body)); return Buffer.concat([body, checksum])
}
function verifyEnvelope(envelope) {
  if (!Buffer.isBuffer(envelope) || envelope.length < 12 || envelope.length > MAX_ENVELOPE_SIZE || !envelope.subarray(0, 4).equals(MAGIC) || envelope[4] !== ENVELOPE_VERSION) throw new Error('Invalid provisioning envelope header')
  const payloadSize = envelope.readUInt16BE(5); if (!payloadSize || payloadSize > MAX_PAYLOAD_SIZE || envelope.length !== 7 + payloadSize + 4) throw new Error('Invalid provisioning envelope length')
  if (envelope.readUInt32BE(7 + payloadSize) !== crc32(envelope.subarray(0, 7 + payloadSize))) throw new Error('Invalid provisioning CRC')
  return true
}
module.exports = { ENVELOPE_VERSION, MAGIC, MAX_ENVELOPE_SIZE, MAX_PAYLOAD_SIZE, crc32, encodeEnvelope, encodePayload, validate, verifyEnvelope }
