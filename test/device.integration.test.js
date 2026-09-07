const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const WebSocket = require('ws')
const cbor = require('cbor')
const { once } = require('events')
const { createDeviceServer } = require('../src')
const { calculateHmac, authInput } = require('../src/security/device-auth')
const { ensureDeviceTls } = require('../src/security/device-tls')
const { DeviceStore } = require('../src/security/device-store')
const { FirmwareRepository } = require('../src/firmware/repository')
const { OtaTokens } = require('../src/firmware/tokens')
const { TYPE } = require('../src/device/protocol')

function message(ws) { return new Promise((resolve, reject) => ws.once('message', (data, isBinary) => { try { assert.equal(isBinary, true); resolve(cbor.decodeFirstSync(data, { required: true })) } catch (error) { reject(error) } })) }
function noMessage(ws, milliseconds=50) { return Promise.race([message(ws).then(() => false), new Promise(resolve => setTimeout(() => resolve(true), milliseconds))]) }
async function open(runtime) {
  runtime.server.listen(0, '127.0.0.1'); await once(runtime.server, 'listening')
  const ws = new WebSocket(`wss://127.0.0.1:${runtime.server.address().port}/device/v1`, { rejectUnauthorized: false })
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

async function authenticate(runtime, id = 'controller1', secret = '11'.repeat(32)) {
  const ws = await open(runtime)
  const challenge = await message(ws)
  ws.send(cbor.encodeCanonical([TYPE.AUTH_RESPONSE, id, Buffer.from(calculateHmac(Buffer.from(secret, 'hex'), id, challenge[2]), 'hex')]))
  const accepted = await message(ws)
  assert.deepEqual(accepted, [TYPE.AUTH_RESULT, 0, id])
  return { ws, challenge }
}

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

test('repairs a missing certificate without replacing the TLS private key and rejects a missing key', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindflayer-tls-state-'))
  const first = ensureDeviceTls(root)
  fs.unlinkSync(first.certPath)
  const repaired = ensureDeviceTls(root)
  assert.equal(repaired.publicKey, first.publicKey)
  fs.unlinkSync(repaired.keyPath)
  assert.throws(() => ensureDeviceTls(root), /certificate exists without its private key/)
})

test('device endpoint is TLS and each connection receives a fresh challenge', async () => {
  const f = fixture(); const runtime = createDeviceServer({ devicesFile: f.devicesFile, firmwareDir: f.firmwareDir, tlsDir: path.join(f.root, 'tls') })
  runtime.server.listen(0, '127.0.0.1'); await once(runtime.server, 'listening')
  const url = `wss://127.0.0.1:${runtime.server.address().port}/device/v1`
  const health = await httpsGet(`https://127.0.0.1:${runtime.server.address().port}/healthz`)
  assert.equal(health.status, 200)
  const first = new WebSocket(url, { rejectUnauthorized: false }); await once(first, 'open'); const a = await message(first)
  const second = new WebSocket(url, { rejectUnauthorized: false }); await once(second, 'open'); const b = await message(second)
  try {
    assert.equal(a[0], TYPE.AUTH_CHALLENGE); assert.equal(a[1], 1); assert.equal(a[2].length, 32)
    assert.equal(b[0], TYPE.AUTH_CHALLENGE); assert.notDeepEqual(a[2], b[2])
  } finally { first.terminate(); second.terminate(); close(runtime) }
})

test('authenticates a device, reports metadata, offers exact targeted firmware, and authorizes download', { timeout: 5000 }, async () => {
  const f = fixture(); const runtime = createDeviceServer({ devicesFile: f.devicesFile, firmwareDir: f.firmwareDir, tlsDir: path.join(f.root, 'tls') })
  const ws = await open(runtime)
  try {
    const challenge = await message(ws)
    ws.send(cbor.encodeCanonical([TYPE.AUTH_RESPONSE, 'controller1', Buffer.from(calculateHmac(Buffer.from('11'.repeat(32), 'hex'), 'controller1', challenge[2]), 'hex')]))
    assert.deepEqual(await message(ws), [TYPE.AUTH_RESULT, 0, 'controller1'])
    ws.send(cbor.encodeCanonical([TYPE.REGISTRATION, '1.1.0', 'mindflayer-keypad-v1']))
    const offer = await message(ws); assert.equal(offer[0], TYPE.UPDATE_AVAILABLE); assert.equal(offer[1], '1.2.0')
    const base = `https://127.0.0.1:${runtime.server.address().port}`
    assert.equal((await httpsGet(base + offer[4])).status, 401)
    const response = await httpsGet(base + offer[4], { Authorization: `Bearer ${Buffer.from(offer[5]).toString('base64url')}` })
    assert.equal(response.status, 200); assert.deepEqual(response.body, f.bytes)
  } finally { close(runtime, ws) }
})

test('acknowledges only an authenticated registration at the accepted target version', { timeout: 5000 }, async () => {
  const f = fixture(); const runtime = createDeviceServer({ devicesFile: f.devicesFile, firmwareDir: f.firmwareDir, tlsDir: path.join(f.root, 'tls') })
  const { ws } = await authenticate(runtime)
  try {
    ws.send(cbor.encodeCanonical([TYPE.REGISTRATION, '1.2.0', 'mindflayer-keypad-v1']))
    assert.deepEqual(await message(ws), [TYPE.FIRMWARE_ACCEPTED, '1.2.0'])
  } finally { close(runtime, ws) }
})

test('does not acknowledge an unacceptable version or hardware', { timeout: 5000 }, async () => {
  for (const registration of [['1.2.0','other-hardware'],['9.9.9','mindflayer-keypad-v1']]) {
    const f=fixture(); const runtime=createDeviceServer({devicesFile:f.devicesFile,firmwareDir:f.firmwareDir,tlsDir:path.join(f.root,'tls')}); const {ws}=await authenticate(runtime)
    try { ws.send(cbor.encodeCanonical([TYPE.REGISTRATION,...registration])); assert.equal(await noMessage(ws),true) } finally { close(runtime,ws) }
  }
})

test('rollout selection emits no grant for no target, current target, wrong hardware, or missing artifact', async () => {
  const cases = [
    { target: null, current: '1.1.0', hardware: 'mindflayer-keypad-v1' },
    { target: '1.2.0', current: '1.2.0', hardware: 'mindflayer-keypad-v1' },
    { target: '1.2.0', current: '1.1.0', hardware: 'other-hardware' },
    { target: '9.9.9', current: '1.1.0', hardware: 'mindflayer-keypad-v1' }
  ]
  for (const item of cases) {
    const f = fixture(); const state = JSON.parse(fs.readFileSync(f.devicesFile))
    if (item.target === null) delete state.devices.controller1.targetVersion
    else state.devices.controller1.targetVersion = item.target
    fs.writeFileSync(f.devicesFile, JSON.stringify(state))
    const runtime = createDeviceServer({ devicesFile: f.devicesFile, firmwareDir: f.firmwareDir, tlsDir: path.join(f.root, 'tls') })
    const { ws } = await authenticate(runtime)
    ws.send(cbor.encodeCanonical([TYPE.REGISTRATION, item.current, item.hardware]))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(runtime.tokens.tokens.size, 0)
    close(runtime, ws)
  }
})

test('rejects invalid, unknown, replayed, and unauthenticated device frames', { timeout: 10000 }, async () => {
  const f = fixture()
  for (const response of [
    () => [TYPE.AUTH_RESPONSE, 'controller1', Buffer.alloc(32)],
    () => [TYPE.AUTH_RESPONSE, 'unknown', Buffer.alloc(32)],
    () => [TYPE.REGISTRATION, '1.0.0', 'mindflayer-keypad-v1']
  ]) {
    const runtime = createDeviceServer({ devicesFile: f.devicesFile, firmwareDir: f.firmwareDir, tlsDir: path.join(f.root, 'tls') }); const ws = await open(runtime)
    const challenge = await message(ws); ws.send(cbor.encodeCanonical(response(challenge))); await once(ws, 'close'); close(runtime)
  }
  const firstRuntime = createDeviceServer({ devicesFile: f.devicesFile, firmwareDir: f.firmwareDir, tlsDir: path.join(f.root, 'tls') }); const first = await open(firstRuntime)
  const oldChallenge = await message(first)
  const replay = [TYPE.AUTH_RESPONSE, 'controller1', Buffer.from(calculateHmac(Buffer.from('11'.repeat(32), 'hex'), 'controller1', oldChallenge[2]), 'hex')]
  close(firstRuntime, first)
  const secondRuntime = createDeviceServer({ devicesFile: f.devicesFile, firmwareDir: f.firmwareDir, tlsDir: path.join(f.root, 'tls') }); const second = await open(secondRuntime)
  await message(second); second.send(cbor.encodeCanonical(replay)); await once(second, 'close'); close(secondRuntime)
})

test('validates firmware paths, size, and hashes and expires opaque grants', () => {
  const f = fixture(); new FirmwareRepository(f.firmwareDir)
  const manifest = JSON.parse(fs.readFileSync(path.join(f.firmwareDir, 'manifest.json')))
  manifest.releases[0].artifact = '../outside.bin'; fs.writeFileSync(path.join(f.firmwareDir, 'manifest.json'), JSON.stringify(manifest))
  assert.throws(() => new FirmwareRepository(f.firmwareDir), /traversal/)
  let now = 10; const tokens = new OtaTokens({ lifetimeMs: 5, now: () => now }); const token = tokens.issue('a', { version: '1.0.0' }); now = 16
  assert.equal(tokens.consume(token), null)
})

test('rejects invalid manifests and firmware size or hash mismatches', () => {
  for (const mutation of [
    manifest => { manifest.version = 2 },
    manifest => { manifest.releases[0].size++ },
    manifest => { manifest.releases[0].sha256 = '00'.repeat(32) }
  ]) {
    const f = fixture(); const manifestPath = path.join(f.firmwareDir, 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath)); mutation(manifest)
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    assert.throws(() => new FirmwareRepository(f.firmwareDir), /manifest|size|hash/i)
  }
})

test('OTA grants are opaque, short-lived, and bound to their exact artifact', async () => {
  const f = fixture(); const repository = new FirmwareRepository(f.firmwareDir)
  const release = repository.get('mindflayer-keypad-v1', '1.2.0')
  const tokens = new OtaTokens(); const token = tokens.issue('controller1', release)
  assert.match(token, /^[A-Za-z0-9_-]{40,}$/)
  const runtime = createDeviceServer({ devicesFile: f.devicesFile, firmwareRepository: repository, tokens, tlsDir: path.join(f.root, 'tls') })
  runtime.server.listen(0, '127.0.0.1'); await once(runtime.server, 'listening')
  const base = `https://127.0.0.1:${runtime.server.address().port}`
  try {
    assert.equal((await httpsGet(`${base}/firmware/other-hardware/1.2.0`, { Authorization: `Bearer ${token}` })).status, 401)
    assert.equal((await httpsGet(`${base}/firmware/mindflayer-keypad-v1/9.9.9`, { Authorization: `Bearer ${token}` })).status, 401)
    assert.equal((await httpsGet(`${base}/firmware/mindflayer-keypad-v1/1.2.0`, { Authorization: 'Bearer definitely-wrong' })).status, 401)
  } finally { close(runtime) }
})

test('malformed authenticated device messages do not crash the listener', { timeout: 5000 }, async () => {
  const f = fixture(); const runtime = createDeviceServer({ devicesFile: f.devicesFile, firmwareDir: f.firmwareDir, tlsDir: path.join(f.root, 'tls') })
  const { ws } = await authenticate(runtime)
  try {
    ws.send('{not-json')
    await once(ws, 'close')
    assert.equal(runtime.server.listening, true)
  } finally { close(runtime) }
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
