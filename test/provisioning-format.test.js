const test = require('node:test')
const assert = require('node:assert/strict')
const cbor = require('cbor')
const { crc32, encodeEnvelope, verifyEnvelope } = require('../src/provisioning/format')
const fixture = '4d465031010194a80001016b636f6e74726f6c6c657231025820' + '11'.repeat(32) + '0367746573742d617004781c636f727265637420686f727365206261747465727920737461706c65056931302e34322e302e31061928cb0759012630820122300d06092a864886f70d01010105000382010f003082010a0282010100e30876faef1a62e490ce22679c63bbc4fa3541f31e9c5f70444fb96c80e26ebd20f636e62b33c25dfee2264aed873371b6e60b3ce673c3c6081f14bf3dd9152c66bf8688b8dcaaeb04b36e1e59041ead40ae24027296181110ccb2f9133461fa6862d169458b63f4bf5e472659879dabccdbf7f468a51d255c7447656398ab2a7536a575d4ba921d24dd5abef184615081a5e419a470f4f060638f3d920356f1c52a0a24c3131f391baf4e57da756cc314dd01d3fd9e9e5a5768963f831cc3270db8a8474a55191749a7cfbcfde719129d2eab6b206b862f58dee5db75e4de4114b6c4b2f51a8d383becd40c95a7e89888309234a3c3b3ea19a1d3f355ccf5470203010001fa6fb8d9'
test('host provisioning encoder matches the independent firmware fixture exactly', () => {
  const fixtureBytes = Buffer.from(fixture, 'hex'); const keyMarker = fixtureBytes.indexOf(Buffer.from('590126', 'hex')); const serverPublicKey = fixtureBytes.subarray(keyMarker + 3, keyMarker + 3 + 294)
  const encoded = encodeEnvelope({ deviceId: 'controller1', deviceSecret: Buffer.alloc(32, 0x11), ssid: 'test-ap', wifiPassword: 'correct horse battery staple', serverHost: '10.42.0.1', serverPort: 10443, serverPublicKey })
  assert.equal(encoded.toString('hex'), fixture); assert.equal(encoded.length, 415); assert.equal(verifyEnvelope(encoded), true)
})
test('host CRC uses CRC-32/ISO-HDLC and envelope corruption is rejected', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926); const corrupted = Buffer.from(fixture, 'hex'); corrupted[20] ^= 1; assert.throws(() => verifyEnvelope(corrupted), /CRC/)
})
test('host verifier rejects valid-CRC envelopes with unsafe or unsupported CBOR', () => {
  const fixtureBytes = Buffer.from(fixture, 'hex'); const keyMarker = fixtureBytes.indexOf(Buffer.from('590126', 'hex')); const serverPublicKey = fixtureBytes.subarray(keyMarker + 3, keyMarker + 3 + 294)
  assert.throws(() => encodeEnvelope({ deviceId: 'a\0b', deviceSecret: Buffer.alloc(32), ssid: 'test', wifiPassword: '', serverHost: 'localhost', serverPort: 10443, serverPublicKey }), /device ID/)
  const payload = cbor.encodeCanonical(new Map([[0, 2]])); const header = Buffer.alloc(7); header.write('MFP1'); header[4] = 1; header.writeUInt16BE(payload.length, 5)
  const body = Buffer.concat([header, payload]); const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(body))
  assert.throws(() => verifyEnvelope(Buffer.concat([body, checksum])), /schema/)
})
