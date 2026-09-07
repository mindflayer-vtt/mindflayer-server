const cbor = require('cbor')

const MAX_DEVICE_FRAME_SIZE = 512
const AUTH_CHALLENGE_VERSION = 1
const LEGACY_PROTOCOL_VERSION = 1
const PROTOCOL_VERSION = 2
const TYPE = Object.freeze({
  AUTH_CHALLENGE: 0,
  AUTH_RESPONSE: 1,
  AUTH_RESULT: 2,
  REGISTRATION: 3,
  KEY_EVENT: 4,
  CONFIGURATION: 5,
  UPDATE_AVAILABLE: 6,
  FIRMWARE_ACCEPTED: 7
})
const AUTH_STATUS = Object.freeze({ OK: 0, FAILED: 1 })
const ACTION = Object.freeze({ UP: 0, DOWN: 1 })
const KEYS = Object.freeze(['Q', 'W', 'E', 'A', 'S', 'D', 'Z', 'X', 'C', 'SHI', 'SPC'])
const textDecoder = new TextDecoder('utf-8', { fatal: true })

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function uint(value, max, name) {
  assert(Number.isSafeInteger(value) && value >= 0 && value <= max, `Invalid ${name}`)
  return value
}

function text(value, max, name, allowEmpty = false) {
  assert(typeof value === 'string', `Invalid ${name}`)
  const size = Buffer.byteLength(value)
  assert((allowEmpty || size > 0) && size <= max && !value.includes('\0'), `Invalid ${name}`)
  return value
}

function bytes(value, length, name) {
  assert(Buffer.isBuffer(value) && value.length === length, `Invalid ${name}`)
  return value
}

function encode(fields) {
  const frame = cbor.encodeCanonical(fields)
  assert(frame.length <= MAX_DEVICE_FRAME_SIZE, 'Device frame exceeds limit')
  return frame
}

function encodeAuthChallenge(challenge) {
  return encode([TYPE.AUTH_CHALLENGE, AUTH_CHALLENGE_VERSION, bytes(challenge, 32, 'challenge')])
}

function fields(type, version, values) {
  assert(version === LEGACY_PROTOCOL_VERSION || version === PROTOCOL_VERSION, 'Unsupported device protocol version')
  return version === PROTOCOL_VERSION ? [type, version, ...values] : [type, ...values]
}

function encodeAuthResult(status, deviceId = '', version = PROTOCOL_VERSION) {
  uint(status, 1, 'auth status')
  return encode(fields(TYPE.AUTH_RESULT, version, [status, text(deviceId, 64, 'device ID', status === AUTH_STATUS.FAILED)]))
}

function encodeConfiguration(message, version = PROTOCOL_VERSION) {
  assert(message && message.type === 'configuration', 'Invalid configuration')
  const values = [message.led1?.r, message.led1?.g, message.led1?.b, message.led2?.r, message.led2?.g, message.led2?.b]
  return encode(fields(TYPE.CONFIGURATION, version, values.map((value, index) => uint(value, 255, `LED channel ${index}`))))
}

function encodeUpdateAvailable(release, url, token, version = PROTOCOL_VERSION) {
  const digest = Buffer.from(release.sha256, 'hex')
  const tokenBytes = Buffer.from(token, 'base64url')
  return encode(fields(TYPE.UPDATE_AVAILABLE, version, [
    text(release.version, 47, 'firmware version'),
    uint(release.size, 0xffffffff, 'firmware size'),
    bytes(digest, 32, 'firmware digest'),
    text(url, 191, 'firmware path'),
    bytes(tokenBytes, 32, 'OTA token')
  ]))
}

function encodeFirmwareAccepted(firmwareVersion, version = PROTOCOL_VERSION) {
  return encode(fields(TYPE.FIRMWARE_ACCEPTED, version, [text(firmwareVersion, 47, 'firmware version')]))
}

function readHead(input, state, expectedMajor) {
  assert(state.offset < input.length, 'Truncated CBOR item')
  const initial = input[state.offset++]
  const major = initial >> 5
  const additional = initial & 31
  assert(major === expectedMajor, 'Incorrect CBOR field type')
  assert(additional < 28, 'Indefinite or reserved CBOR length')
  let value
  if (additional < 24) value = additional
  else {
    const width = 1 << (additional - 24)
    assert(state.offset + width <= input.length, 'Truncated CBOR argument')
    value = 0
    for (let index = 0; index < width; index++) value = value * 256 + input[state.offset++]
    assert(Number.isSafeInteger(value), 'CBOR integer exceeds safe range')
    const minimum = additional === 24 ? 24 : 2 ** (8 * (width >> 1))
    assert(value >= minimum, 'Non-shortest CBOR encoding')
  }
  return value
}

function readUint(input, state, max, name) {
  return uint(readHead(input, state, 0), max, name)
}

function readBytes(input, state, min, max, name) {
  const length = readHead(input, state, 2)
  assert(length >= min && length <= max && state.offset + length <= input.length, `Invalid ${name}`)
  const result = input.subarray(state.offset, state.offset + length)
  state.offset += length
  return result
}

function readText(input, state, min, max, name) {
  const raw = readBytesWithMajor(input, state, 3, min, max, name)
  let result
  try { result = textDecoder.decode(raw) } catch { throw new Error(`Invalid UTF-8 in ${name}`) }
  return text(result, max, name, min === 0)
}

function readBytesWithMajor(input, state, major, min, max, name) {
  const length = readHead(input, state, major)
  assert(length >= min && length <= max && state.offset + length <= input.length, `Invalid ${name}`)
  const result = input.subarray(state.offset, state.offset + length)
  state.offset += length
  return result
}

function decodeDeviceFrame(data) {
  const input = Buffer.isBuffer(data) ? data : Buffer.from(data)
  assert(input.length > 0 && input.length <= MAX_DEVICE_FRAME_SIZE, 'Invalid device frame size')
  const state = { offset: 0 }
  const arity = readHead(input, state, 4)
  const type = readUint(input, state, 255, 'message type')
  const version = arity === 4 ? readUint(input, state, 255, 'protocol version') : LEGACY_PROTOCOL_VERSION
  assert(version === LEGACY_PROTOCOL_VERSION || version === PROTOCOL_VERSION, 'Unsupported device protocol version')
  let message
  switch (type) {
    case TYPE.AUTH_RESPONSE:
      assert(arity === (version === PROTOCOL_VERSION ? 4 : 3), 'Incorrect auth response arity')
      message = { type: 'auth-response', deviceId: readText(input, state, 1, 64, 'device ID'), hmac: Buffer.from(readBytes(input, state, 32, 32, 'HMAC')) }
      break
    case TYPE.REGISTRATION:
      assert(arity === (version === PROTOCOL_VERSION ? 4 : 3), 'Incorrect registration arity')
      message = { type: 'registration', firmware: readText(input, state, 1, 47, 'firmware version'), hardware: readText(input, state, 1, 64, 'hardware ID') }
      break
    case TYPE.KEY_EVENT: {
      assert(arity === (version === PROTOCOL_VERSION ? 4 : 3), 'Incorrect key-event arity')
      const key = readUint(input, state, KEYS.length - 1, 'key code')
      const action = readUint(input, state, 1, 'key action')
      message = { type: 'key-event', key: KEYS[key], state: action === ACTION.DOWN ? 'down' : 'up' }
      break
    }
    default: throw new Error('Unknown or server-only device message type')
  }
  assert(state.offset === input.length, 'Trailing CBOR data')
  message.protocolVersion = version
  return message
}

module.exports = {
  ACTION, AUTH_CHALLENGE_VERSION, AUTH_STATUS, KEYS, LEGACY_PROTOCOL_VERSION, MAX_DEVICE_FRAME_SIZE, PROTOCOL_VERSION, TYPE,
  decodeDeviceFrame, encodeAuthChallenge, encodeAuthResult, encodeConfiguration, encodeUpdateAvailable,
  encodeFirmwareAccepted
}
