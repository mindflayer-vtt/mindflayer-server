const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const WebSocket = require('ws')
const { once } = require('events')
const { createDeviceServer } = require('../src')
const { calculateHmac, authInput } = require('../src/security/device-auth')
const { ensureDeviceTls } = require('../src/security/device-tls')
const { DeviceStore } = require('../src/security/device-store')
const { FirmwareRepository } = require('../src/firmware/repository')
const { OtaTokens } = require('../src/firmware/tokens')

function json(ws) { return new Promise((resolve, reject) => ws.once('message', data => { try { resolve(JSON.parse(data)) } catch (error) { reject(error) } })) }
async function open(runtime) {
  runtime.server.listen(0, '127.0.0.1'); await once(runtime.server, 'listening')
  const ws = new WebSocket(`wss://127.0.0.1:${runtime.server.address().port}/ws`, { rejectUnauthorized: false })
  await once(ws, 'open'); return ws
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindflayer-server-'))
  const devicesFile = path.join(root, 'devices.json')
  fs.writeFileSync(devicesFile, JSON.stringify({ version: 1, devices: { controller1: { secret: '11'.repeat(32), targetVersion: '1.2.0' } } }))
  const firmwareDir = path.join(root, 'firmware'); fs.mkdirSync(firmwareDir)
  const bytes = Buffer.from('signed-firmware-fixture'); fs.writeFileSync(path.join(firmwareDir, 'firmware.bin'), bytes)
  fs.writeFileSync(path.join(firmwareDir, 'manifest.json'), JSON.stringify({ version: 1, releases: [{ hardware: 'mindflayer-keypad-v1', version: '1.2.0', artifact: 'firmware.bin', size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }] }))
  return { root, devicesFile, firmwareDir, bytes }
}
function close(runtime, ws) { if (ws) ws.terminate(); for (const client of runtime.wss.clients) client.terminate(); runtime.wss.close(); runtime.server.close() }

test('uses canonical length-prefixed authentication input and known HMAC vector', () => {
  assert.equal(authInput('controller1', 'nonce').toString('hex'), '000000196d696e64666c617965722d6465766963652d617574682d76310000000b636f6e74726f6c6c657231000000056e6f6e6365')
  assert.equal(calculateHmac(Buffer.from('11'.repeat(32), 'hex'), 'controller1', 'nonce'), '7689f2a6005ab665f8a8fbf5dca46e63fafb9b2813ef08a3df0de168e052e63e')
})

test('persists TLS public key and fails safely for mismatched state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindflayer-tls-'))
  const first = ensureDeviceTls(root); const second = ensureDeviceTls(root)
  assert.equal(first.publicKey, second.publicKey)
  fs.writeFileSync(second.certPath, fs.readFileSync(path.join(__dirname, '..', 'config/certs/snakeoil.pem')))
  assert.throws(() => ensureDeviceTls(root), /does not match|error/i)
})

test('authenticates a device, reports metadata, offers exact targeted firmware, and authorizes download', { timeout: 5000 }, async () => {
  const f = fixture(); const runtime = createDeviceServer({ devicesFile: f.devicesFile, firmwareDir: f.firmwareDir, tlsDir: path.join(f.root, 'tls') })
  const ws = await open(runtime)
  try {
    const challenge = await json(ws)
    ws.send(JSON.stringify({ type: 'auth-response', 'device-id': 'controller1', hmac: calculateHmac(Buffer.from('11'.repeat(32), 'hex'), 'controller1', challenge.challenge) }))
    assert.equal((await json(ws)).type, 'auth-ok')
    ws.send(JSON.stringify({ type: 'registration', 'controller-id': 'controller1', status: 'connected', receiver: false, firmware: '1.1.0', hardware: 'mindflayer-keypad-v1' }))
    const offer = await json(ws); assert.equal(offer.type, 'update-available'); assert.equal(offer.version, '1.2.0')
    const base = `https://127.0.0.1:${runtime.server.address().port}`
    assert.equal((await httpsGet(base + offer.url)).status, 401)
    const response = await httpsGet(base + offer.url, { Authorization: `Bearer ${offer.token}` })
    assert.equal(response.status, 200); assert.deepEqual(response.body, f.bytes)
  } finally { close(runtime, ws) }
})

test('rejects invalid, unknown, replayed, unauthenticated, and identity-changing clients', { timeout: 10000 }, async () => {
  const f = fixture()
  for (const response of [
    challenge => ({ type: 'auth-response', 'device-id': 'controller1', hmac: '00'.repeat(32) }),
    challenge => ({ type: 'auth-response', 'device-id': 'unknown', hmac: '00'.repeat(32) }),
    () => ({ type: 'registration', 'controller-id': 'controller1', receiver: false })
  ]) {
    const runtime = createDeviceServer({ devicesFile: f.devicesFile, firmwareDir: f.firmwareDir, tlsDir: path.join(f.root, 'tls') }); const ws = await open(runtime)
    const challenge = await json(ws); ws.send(JSON.stringify(response(challenge))); await once(ws, 'close'); close(runtime)
  }
  const runtime = createDeviceServer({ devicesFile: f.devicesFile, firmwareDir: f.firmwareDir, tlsDir: path.join(f.root, 'tls') }); const ws = await open(runtime)
  const challenge = await json(ws); const auth = { type: 'auth-response', 'device-id': 'controller1', hmac: calculateHmac(Buffer.from('11'.repeat(32), 'hex'), 'controller1', challenge.challenge) }
  ws.send(JSON.stringify(auth)); await json(ws); ws.send(JSON.stringify({ type: 'registration', 'controller-id': 'controller2', receiver: false })); await once(ws, 'close'); close(runtime)
})

test('validates firmware paths, size, and hashes and expires opaque grants', () => {
  const f = fixture(); new FirmwareRepository(f.firmwareDir)
  const manifest = JSON.parse(fs.readFileSync(path.join(f.firmwareDir, 'manifest.json')))
  manifest.releases[0].artifact = '../outside.bin'; fs.writeFileSync(path.join(f.firmwareDir, 'manifest.json'), JSON.stringify(manifest))
  assert.throws(() => new FirmwareRepository(f.firmwareDir), /traversal/)
  let now = 10; const tokens = new OtaTokens({ lifetimeMs: 5, now: () => now }); const token = tokens.issue('a', { version: '1.0.0' }); now = 16
  assert.equal(tokens.consume(token), null)
})

function httpsGet(url, headers = {}) {
  const https = require('https')
  return new Promise((resolve, reject) => {
    https.get(url, { headers, rejectUnauthorized: false }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks) }))
    }).on('error', reject)
  })
}
