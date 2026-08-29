const test = require('node:test')
const assert = require('node:assert/strict')
const cbor = require('cbor')
const {
  AUTH_STATUS, MAX_DEVICE_FRAME_SIZE, TYPE, decodeDeviceFrame, encodeAuthChallenge,
  encodeAuthResult, encodeConfiguration, encodeUpdateAvailable
} = require('../src/device/protocol')

const fixtures = Object.freeze({
  authChallenge: '8300015820' + '11'.repeat(32),
  authResponse: '83016b636f6e74726f6c6c6572315820' + '22'.repeat(32),
  authResult: '8302006b636f6e74726f6c6c657231',
  registration: '830365312e322e33746d696e64666c617965722d6b65797061642d7631',
  keyDown: '83040101',
  configuration: '8705010203040506',
  updateAvailable: '860665312e322e33187b5820' + '00'.repeat(32) + '712f6669726d776172652f612f312e322e335820' + '33'.repeat(32)
})

test('server encoders match every canonical device-protocol byte fixture', () => {
  assert.equal(encodeAuthChallenge(Buffer.alloc(32, 0x11)).toString('hex'), fixtures.authChallenge)
  assert.equal(encodeAuthResult(AUTH_STATUS.OK, 'controller1').toString('hex'), fixtures.authResult)
  assert.equal(encodeConfiguration({ type: 'configuration', led1: { r: 1, g: 2, b: 3 }, led2: { r: 4, g: 5, b: 6 } }).toString('hex'), fixtures.configuration)
  assert.equal(encodeUpdateAvailable(
    { version: '1.2.3', size: 123, sha256: '00'.repeat(32) }, '/firmware/a/1.2.3', Buffer.alloc(32, 0x33).toString('base64url')
  ).toString('hex'), fixtures.updateAvailable)
})

test('server decoder maps exact keypad fixtures to typed semantics', () => {
  assert.deepEqual(decodeDeviceFrame(Buffer.from(fixtures.authResponse, 'hex')), {
    type: 'auth-response', deviceId: 'controller1', hmac: Buffer.alloc(32, 0x22)
  })
  assert.deepEqual(decodeDeviceFrame(Buffer.from(fixtures.registration, 'hex')), {
    type: 'registration', firmware: '1.2.3', hardware: 'mindflayer-keypad-v1'
  })
  assert.deepEqual(decodeDeviceFrame(Buffer.from(fixtures.keyDown, 'hex')), {
    type: 'key-event', key: 'W', state: 'down'
  })
})

test('restricted decoder rejects malformed and out-of-profile CBOR deterministically', () => {
  const malformed = [
    Buffer.alloc(0), Buffer.from([0x83]), Buffer.alloc(MAX_DEVICE_FRAME_SIZE + 1),
    cbor.encodeCanonical({ 0: 1 }), Buffer.from([0x9f, 0x01, 0xff]),
    Buffer.from([0xbf, 0x01, 0x01, 0xff]), Buffer.from([0x83, 0x01, 0x7f, 0xff, 0x40]),
    Buffer.from([0x83, 0xc0, 0x01, 0x01]), Buffer.from([0x83, 0xf9, 0x00, 0x00, 0x01]),
    cbor.encodeCanonical([99]), cbor.encodeCanonical([TYPE.KEY_EVENT, 1]),
    cbor.encodeCanonical([TYPE.KEY_EVENT, 1, 1, 1]), cbor.encodeCanonical([TYPE.KEY_EVENT, 'W', 1]),
    cbor.encodeCanonical([TYPE.KEY_EVENT, -1, 1]), cbor.encodeCanonical([TYPE.KEY_EVENT, 256, 1]),
    cbor.encodeCanonical([TYPE.KEY_EVENT, [], 1]), cbor.encodeCanonical([TYPE.KEY_EVENT, {}, 1]),
    Buffer.concat([Buffer.from(fixtures.keyDown, 'hex'), Buffer.from([0x00])]),
    Buffer.from([0x83, 0x01, 0x78, 0x20, 0x61]), Buffer.from([0x83, 0x01, 0x58, 0x20, 0x00])
  ]
  for (const frame of malformed) assert.throws(() => decodeDeviceFrame(frame))
})

test('configuration encoder rejects untyped browser JSON at the semantic boundary', () => {
  for (const message of [null, {}, { type: 'configuration', led1: { r: -1, g: 2, b: 3 }, led2: { r: 4, g: 5, b: 6 } },
    { type: 'configuration', led1: { r: 1, g: 2, b: 3 }, led2: { r: 4, g: 5, b: 999 } }]) {
    assert.throws(() => encodeConfiguration(message))
  }
})

module.exports = { fixtures }
