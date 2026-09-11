const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const WebSocket = require('ws')
const cbor = require('cbor')
const { startAll } = require('../src')
const { calculateHmacBytes } = require('../src/security/device-auth')
const { TYPE, CONFIGURATION_PROTOCOL_VERSION: version, decodeDeviceFrame, encodeConfigurationQuery, encodeLedCommand } = require('../src/device/protocol')

async function until(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = predicate()
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for test message')
}
function queue(socket, decode) {
  const messages = []
  socket.on('message', data => messages.push(decode(data)))
  return predicate => until(() => {
    const index = messages.findIndex(predicate)
    return index < 0 ? null : messages.splice(index, 1)[0]
  })
}

test('configuration proof has exact v3 framing and rejects legacy or malformed reports', () => {
  const nonce = Buffer.alloc(32, 0x11)
  const digest = crypto.createHash('sha256').update('abc').digest()
  assert.equal(encodeConfigurationQuery(nonce).toString('hex'), '840803015820' + '11'.repeat(32))
  const frame = Buffer.from('8409035820' + '11'.repeat(32) + '5820' + digest.toString('hex'), 'hex')
  assert.deepEqual(decodeDeviceFrame(frame), { type: 'configuration-report', protocolVersion: 3, nonce, digest })
  for (const fields of [[9, 2, nonce, digest], [9, 1, nonce, digest], [9, 3, nonce, Buffer.alloc(31)], [8, 3, 1, nonce]]) {
    assert.throws(() => decodeDeviceFrame(cbor.encodeCanonical(fields)))
  }
})

test('LED commands and acknowledgements have bounded, exact v3 framing', () => {
  const nonce = Buffer.alloc(32, 0x11)
  const colours = { type: 'configuration', led1: { r: 0, g: 1, b: 2 }, led2: { r: 3, g: 4, b: 5 } }
  assert.equal(encodeLedCommand(colours, nonce).toString('hex'), '890a035820' + '11'.repeat(32) + '000102030405')
  const acknowledgement = Buffer.from('830b035820' + '11'.repeat(32), 'hex')
  assert.deepEqual(decodeDeviceFrame(acknowledgement), { type: 'led-applied', protocolVersion: 3, nonce })
  for (let size = 0; size < acknowledgement.length; size++) assert.throws(() => decodeDeviceFrame(acknowledgement.subarray(0, size)))
  for (const fields of [[11, 1, nonce], [11, 2, nonce], [11, 3, Buffer.alloc(31)], [11, 3, nonce, 0]]) {
    assert.throws(() => decodeDeviceFrame(cbor.encodeCanonical(fields)))
  }
  assert.throws(() => decodeDeviceFrame(Buffer.concat([acknowledgement, Buffer.from([0])])))
  assert.throws(() => encodeLedCommand(colours, Buffer.alloc(31)))
  assert.throws(() => encodeLedCommand({ ...colours, led1: { r: 256, g: 0, b: 0 } }, nonce))
})

test('only nonce-matched authenticated configuration proof reaches receivers; replay is rejected', { timeout: 5000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindflayer-proof-'))
  const devicesFile = path.join(root, 'devices.json')
  const secret = Buffer.alloc(32, 0x11)
  fs.writeFileSync(devicesFile, JSON.stringify({ version: 1, devices: { keypad: { secret: secret.toString('hex') } } }))
  const runtime = startAll({ autoFirmwareUpdates: false, foundryPort: 0, devicePort: 0, host: '127.0.0.1', deviceHost: '127.0.0.1',
    devicesFile, firmwareDir: path.join(root, 'firmware'), tlsDir: path.join(root, 'tls') })
  const sockets = []
  t.after(() => {
    for (const socket of sockets) socket.terminate()
    for (const side of [runtime.foundry, runtime.device]) {
      for (const socket of side.wss.clients) socket.terminate()
      side.wss.close(); side.server.close()
    }
    runtime.foundry.registry.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
  await Promise.all([once(runtime.foundry.server, 'listening'), once(runtime.device.server, 'listening')])
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${runtime.foundry.server.address().port}/api/capabilities`)).json(), {
    deviceProtocolVersions: [1, 2, 3], configurationProof: 'sha256-canonical-envelope-v2',
  })
  const receiver = new WebSocket(`ws://127.0.0.1:${runtime.foundry.server.address().port}/ws`)
  sockets.push(receiver)
  const receiverMessage = queue(receiver, data => JSON.parse(data))
  await once(receiver, 'open')
  receiver.send(JSON.stringify({ type: 'registration', receiver: true, players: [] }))
  await until(() => runtime.foundry.registry.getReceiverConnections().length)
  const device = new WebSocket(`wss://127.0.0.1:${runtime.device.server.address().port}/device/v1`, { rejectUnauthorized: false })
  sockets.push(device)
  const deviceMessage = queue(device, data => cbor.decodeFirstSync(data))
  await once(device, 'open')
  const challenge = await deviceMessage(message => message[0] === TYPE.AUTH_CHALLENGE)
  device.send(cbor.encodeCanonical([TYPE.AUTH_RESPONSE, version, 'keypad', calculateHmacBytes(secret, 'keypad', challenge[2])]))
  await deviceMessage(message => message[0] === TYPE.AUTH_RESULT)
  device.send(cbor.encodeCanonical([TYPE.REGISTRATION, version, '1.2.3', 'mindflayer-keypad-v1']))
  const query = await deviceMessage(message => message[0] === TYPE.CONFIGURATION_QUERY)
  await receiverMessage(message => message.type === 'registration' && message['controller-id'] === 'keypad')
  const digest = crypto.createHash('sha256').update('abc').digest()
  const report = cbor.encodeCanonical([TYPE.CONFIGURATION_REPORT, version, query[3], digest])
  receiver.send(JSON.stringify({ type: 'configuration-state', 'controller-id': 'keypad', deviceAuthenticated: true,
    configurationDigest: 'f'.repeat(64) }))
  const notBefore = Date.now()
  device.send(report)
  const verified = await receiverMessage(message => message.type === 'configuration-state')
  assert.ok(verified.configurationVerifiedAt >= notBefore && verified.configurationVerifiedAt <= Date.now())
  assert.deepEqual(verified, {
    type: 'configuration-state', 'controller-id': 'keypad', deviceAuthenticated: true, configurationDigest: digest.toString('hex'),
    configurationVerifiedAt: verified.configurationVerifiedAt,
  })
  const online = await require('../src/provisioning/online').waitForInstallation({
    url: `ws://127.0.0.1:${runtime.foundry.server.address().port}/ws`, id: 'keypad',
    firmware: '1.2.3', digest: digest.toString('hex'), notBefore, timeout: 1000,
  })
  assert.equal(online.deviceAuthenticated, true)
  assert.equal(online.configurationVerifiedAt, verified.configurationVerifiedAt)
  // Sending alone must clear confirmation. Only the current command's nonce
  // can confirm colours; a superseded command and a replay are harmless.
  const colours = { led1: { r: 0, g: 1, b: 2 }, led2: { r: 3, g: 4, b: 5 } }
  const command = { type: 'configuration', 'controller-id': 'keypad', ...colours }
  receiver.send(JSON.stringify(command))
  const firstLed = await deviceMessage(message => message[0] === TYPE.LED_COMMAND)
  assert.equal((await receiverMessage(message => message.type === 'led-state')).appliedLeds, null)
  receiver.send(JSON.stringify(command))
  const currentLed = await deviceMessage(message => message[0] === TYPE.LED_COMMAND)
  assert.notDeepEqual(firstLed[2], currentLed[2])
  assert.deepEqual(currentLed.slice(3), [0, 1, 2, 3, 4, 5])
  assert.equal((await receiverMessage(message => message.type === 'led-state')).appliedLeds, null)
  const connection = runtime.foundry.registry.getControllerConnections().find(connection => connection.controllerId === 'keypad')
  async function barrier() {
    device.send(cbor.encodeCanonical([TYPE.KEY_EVENT, version, 1, 1]))
    await receiverMessage(message => message.type === 'key-event')
  }
  device.send(cbor.encodeCanonical([TYPE.LED_APPLIED, version, firstLed[2]]))
  await barrier()
  assert.equal(connection.appliedLeds, null)
  device.send(cbor.encodeCanonical([TYPE.LED_APPLIED, version, currentLed[2]]))
  assert.deepEqual((await receiverMessage(message => message.type === 'led-state')).appliedLeds, colours)
  device.send(cbor.encodeCanonical([TYPE.LED_APPLIED, version, currentLed[2]]))
  await barrier()
  assert.equal(connection.pendingLeds, null)
  assert.deepEqual(connection.appliedLeds, colours)
  receiver.send(JSON.stringify({ type: 'led-state', 'controller-id': 'keypad', deviceAuthenticated: true, appliedLeds: null }))
  receiver.send(JSON.stringify({ type: 'registration', receiver: true, players: [] }))
  assert.deepEqual((await receiverMessage(message => message.type === 'registration' && message['controller-id'] === 'keypad')).appliedLeds, colours)
  const late = new WebSocket(`ws://127.0.0.1:${runtime.foundry.server.address().port}/ws`)
  sockets.push(late)
  const lateMessage = queue(late, data => JSON.parse(data))
  await once(late, 'open')
  late.send(JSON.stringify({ type: 'registration', receiver: true, players: [] }))
  const snapshot = await lateMessage(message => message['controller-id'] === 'keypad')
  assert.equal(snapshot.configurationDigest, digest.toString('hex'))
  assert.deepEqual(snapshot.appliedLeds, colours)
  const closed = once(device, 'close')
  device.send(report)
  assert.equal((await closed)[0], 1008)
  const reconnected = new WebSocket(`wss://127.0.0.1:${runtime.device.server.address().port}/device/v1`, { rejectUnauthorized: false })
  sockets.push(reconnected)
  const reconnectMessage = queue(reconnected, data => cbor.decodeFirstSync(data))
  await once(reconnected, 'open')
  const nextChallenge = await reconnectMessage(message => message[0] === TYPE.AUTH_CHALLENGE)
  reconnected.send(cbor.encodeCanonical([TYPE.AUTH_RESPONSE, version, 'keypad', calculateHmacBytes(secret, 'keypad', nextChallenge[2])]))
  await reconnectMessage(message => message[0] === TYPE.AUTH_RESULT)
  reconnected.send(cbor.encodeCanonical([TYPE.REGISTRATION, version, '1.2.3', 'mindflayer-keypad-v1']))
  const nextQuery = await reconnectMessage(message => message[0] === TYPE.CONFIGURATION_QUERY)
  assert.notDeepEqual(query[3], nextQuery[3])
  const rejected = once(reconnected, 'close')
  reconnected.send(report)
  assert.equal((await rejected)[0], 1008)
})
