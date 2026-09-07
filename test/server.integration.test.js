const test = require('node:test')
const assert = require('node:assert/strict')
const WebSocket = require('ws')
const { once } = require('node:events')
const { MAX_FOUNDRY_FRAME_SIZE, start } = require('../src')
const protocol = require('./fixtures/protocol.json')

function nextJson(ws) {
  return new Promise((resolve, reject) => {
    ws.once('message', data => {
      try { resolve(JSON.parse(data)) } catch (error) { reject(error) }
    })
  })
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error('Expected server state was not reached')
}

test('relays the complete controller protocol over real WebSocket connections', { timeout: 5000 }, async t => {
  const runtime = start({ port: 0, host: '127.0.0.1', tls: false })
  await once(runtime.server, 'listening')
  const address = runtime.server.address()
  const url = `ws://127.0.0.1:${address.port}/ws`
  const sockets = []
  t.after(() => {
    for (const socket of sockets) socket.terminate()
    for (const socket of runtime.wss.clients) socket.terminate()
    runtime.wss.close()
    runtime.server.close()
    runtime.registry.close()
  })

  const health = await fetch(`http://127.0.0.1:${address.port}/healthz`)
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok' })

  const controllerOne = await connect(url)
  sockets.push(controllerOne)
  controllerOne.send(JSON.stringify(protocol.controllerRegistration))
  await waitFor(() => runtime.registry.getControllerConnections().some(
    connection => connection.controllerId === 'controller1'
  ))

  const receiver = await connect(url)
  sockets.push(receiver)
  const knownController = nextJson(receiver)
  receiver.send(JSON.stringify(protocol.receiverRegistration))
  assert.deepEqual(await knownController, {
    type: 'registration', 'controller-id': 'controller1', status: 'connected', receiver: false
  })

  const controllerTwo = await connect(url)
  sockets.push(controllerTwo)
  const newController = nextJson(receiver)
  controllerTwo.send(JSON.stringify({
    type: 'registration', 'controller-id': 'controller2', status: 'connected', receiver: false
  }))
  assert.deepEqual(await newController, {
    type: 'registration', 'controller-id': 'controller2', status: 'connected', receiver: false
  })

  const keyEvent = protocol.keyEvent
  const relayedKey = nextJson(receiver)
  controllerOne.send(JSON.stringify(keyEvent))
  assert.deepEqual(await relayedKey, keyEvent)

  const configuration = protocol.configuration
  const routedConfiguration = nextJson(controllerOne)
  receiver.send(JSON.stringify(configuration))
  assert.deepEqual(await routedConfiguration, configuration)

  const keyboardLogin = nextJson(receiver)
  const loginResponse = await fetch(`http://127.0.0.1:${address.port}/api/players/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      'controller-id': protocol.keyboardLogin['controller-id'],
      'player-id': protocol.keyboardLogin['player-id']
    })
  })
  assert.equal(loginResponse.status, 200)
  assert.deepEqual(await keyboardLogin, protocol.keyboardLogin)

  controllerOne.send('{malformed')
  const stillAlive = nextJson(receiver)
  controllerOne.send(JSON.stringify({ ...keyEvent, state: 'up' }))
  assert.equal((await stillAlive).state, 'up')

  const disconnected = nextJson(receiver)
  controllerTwo.close()
  await once(controllerTwo, 'close')
  assert.deepEqual(await disconnected, {
    type: 'registration', 'controller-id': 'controller2', status: 'disconnected', receiver: false
  })
})

test('rejects WebSocket upgrades outside the configured path', { timeout: 5000 }, async t => {
  const runtime = start({ port: 0, host: '127.0.0.1', tls: false })
  await once(runtime.server, 'listening')
  t.after(() => {
    runtime.wss.close()
    runtime.server.close()
    runtime.registry.close()
  })
  const { port } = runtime.server.address()
  const ws = new WebSocket(`ws://127.0.0.1:${port}/wrong`)
  const [error] = await once(ws, 'error')
  assert.match(error.message, /socket hang up/)
  runtime.wss.close()
})

test('rejects oversized Foundry WebSocket messages', { timeout: 5000 }, async t => {
  const runtime = start({ port: 0, host: '127.0.0.1', tls: false })
  await once(runtime.server, 'listening')
  t.after(() => {
    for (const client of runtime.wss.clients) client.terminate()
    runtime.wss.close()
    runtime.server.close()
    runtime.registry.close()
  })
  const ws = await connect(`ws://127.0.0.1:${runtime.server.address().port}/ws`)
  ws.send('x'.repeat(MAX_FOUNDRY_FRAME_SIZE + 1))
  const [code] = await once(ws, 'close')
  assert.equal(code, 1009)
})
