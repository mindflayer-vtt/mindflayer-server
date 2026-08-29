const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const https = require('https')
const path = require('path')
const express = require('express')
const WebSocket = require('ws')
const log = require('./config/logger')
const defaultRegistry = require('./connection/registry')
const defaultDispatcher = require('./message/dispatcher')
const { calculateHmac, safeHexEqual } = require('./security/device-auth')
const { DeviceStore } = require('./security/device-store')
const { ensureDeviceTls } = require('./security/device-tls')
const { FirmwareRepository } = require('./firmware/repository')
const { OtaTokens } = require('./firmware/tokens')

const DEFAULT_FOUNDRY_PORT = 8080
const DEFAULT_DEVICE_PORT = 10443
const DEFAULT_PORT = DEFAULT_DEVICE_PORT

function registerProtocolHandlers(registry, dispatcher) {
  if (dispatcher.__mindflayerHandlersRegistered) return
  dispatcher.__mindflayerHandlersRegistered = true
  registry.attach(dispatcher)
  dispatcher.handlers.VTTKeyEventMessage.push((source, message) => {
    registry.getReceiverConnections().forEach(conn => conn.send(JSON.stringify(message)))
  })
  dispatcher.handlers.VTTRegistrationMessage.push((connection, message) => {
    if (connection.deviceAuthenticated && message['controller-id'] !== connection.authenticatedDeviceId) {
      connection.close(1008, 'controller identity mismatch')
      return
    }
    connection.receiver = message.receiver
    connection.controllerId = message['controller-id']
    connection.firmwareVersion = message.firmware
    connection.hardware = message.hardware
    if (connection.receiver) {
      connection.players = message.players || []
      registry.getControllerConnections().forEach(conn => connection.send(JSON.stringify({
        type: 'registration', 'controller-id': conn.controllerId, status: 'connected', receiver: false
      })))
    } else {
      log.info(`Controller ${connection.controllerId} registered${connection.firmwareVersion ? ` firmware=${connection.firmwareVersion}` : ''}`)
      registry.getReceiverConnections().forEach(conn => conn.send(JSON.stringify({
        type: 'registration', 'controller-id': connection.controllerId, status: message.status, receiver: false
      })))
      if (connection.offerUpdate) connection.offerUpdate(message)
    }
  })
  dispatcher.handlers.VTTConfigurationMessage.push((connection, message) => {
    registry.getControllerConnections().filter(conn => conn.controllerId === message['controller-id'])
      .forEach(conn => conn.send(JSON.stringify(message)))
  })
  dispatcher.handlers.VTTAmbilightMessage.push(require('./handlers/ambilight'))
}

function createFoundryApp(registry = defaultRegistry) {
  const app = express()
  app.use(express.static(path.join(__dirname, '..', 'static')))
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  app.post('/api/players/register', (req, res) => {
    res.end()
    const data = JSON.stringify({ type: 'keyboard-login', 'controller-id': req.body['controller-id'], 'player-id': req.body['player-id'] })
    registry.getReceiverConnections().forEach(conn => conn.send(data))
  })
  app.get('/api/players', (req, res) => res.json(registry.getReceiverConnections().flatMap(conn => conn.players)))
  app.get('/configure', (req, res) => res.sendFile(path.join(__dirname, '..', 'static', 'configure.html')))
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'static', 'keypad.html')))
  return app
}

function attachWebSocket(server, onConnection) {
  const wss = new WebSocket.Server({ noServer: true })
  wss.on('connection', onConnection)
  server.on('upgrade', (request, socket, head) => {
    let pathname
    try { pathname = new URL(request.url, 'http://localhost').pathname } catch { socket.destroy(); return }
    if (pathname !== '/ws') { socket.destroy(); return }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request))
  })
  return wss
}

function createFoundryServer(options = {}) {
  const registry = options.registry || defaultRegistry
  const dispatcher = options.dispatcher || defaultDispatcher
  registerProtocolHandlers(registry, dispatcher)
  const app = createFoundryApp(registry)
  const server = options.tls ? https.createServer(options.tls, app) : http.createServer(app)
  const wss = attachWebSocket(server, ws => {
    registry.addConnection(ws)
    ws.on('message', data => {
      try { dispatcher.dispatch(ws, JSON.parse(data)) } catch (error) { log.warn('Rejected malformed Foundry message'); log.debug(error) }
    })
  })
  wss.on('close', () => registry.close())
  return { app, server, wss }
}

function parseBearer(request) {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(request.headers.authorization || '')
  return match && match[1]
}

function createDeviceServer(options = {}) {
  const registry = options.registry || defaultRegistry
  const dispatcher = options.dispatcher || defaultDispatcher
  registerProtocolHandlers(registry, dispatcher)
  const store = options.deviceStore || new DeviceStore(options.devicesFile || path.join(process.env.MINDFLAYER_DATA_DIR || './data', 'devices.json'))
  const firmware = options.firmwareRepository || new FirmwareRepository(options.firmwareDir || process.env.MINDFLAYER_FIRMWARE_DIR || './firmware')
  const tokens = options.tokens || new OtaTokens()
  const tls = options.tls || ensureDeviceTls(options.tlsDir || path.join(process.env.MINDFLAYER_DATA_DIR || './data', 'tls'))
  const app = express()
  app.get('/firmware/:hardware/:version', (req, res) => {
    const grant = tokens.consume(parseBearer(req))
    if (!grant || grant.release.hardware !== req.params.hardware || grant.release.version !== req.params.version) return res.sendStatus(401)
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Length': grant.release.size, 'Cache-Control': 'no-store' })
    fs.createReadStream(grant.release.file).pipe(res)
  })
  const server = https.createServer(tls, app)
  const wss = attachWebSocket(server, ws => {
    ws.deviceAuthenticated = false
    ws.authChallenge = crypto.randomBytes(32).toString('base64url')
    ws.send(JSON.stringify({ type: 'auth-challenge', version: 1, challenge: ws.authChallenge }))
    ws.on('message', data => {
      let message
      try { message = JSON.parse(data) } catch { ws.close(1008, 'malformed message'); return }
      if (!ws.deviceAuthenticated) {
        if (message.type !== 'auth-response' || typeof message['device-id'] !== 'string') { ws.close(1008, 'authentication required'); return }
        const device = store.get(message['device-id'])
        const expected = device && calculateHmac(Buffer.from(device.secret, 'hex'), message['device-id'], ws.authChallenge)
        ws.authChallenge = null
        if (!expected || !safeHexEqual(message.hmac, expected)) { ws.send(JSON.stringify({ type: 'auth-failed' })); ws.close(1008, 'authentication failed'); return }
        ws.deviceAuthenticated = true
        ws.authenticatedDeviceId = message['device-id']
        ws.offerUpdate = registration => {
          const { hardware, firmware: current } = registration
          const target = device.targetVersion
          if (!target || current === target || !hardware) return
          const release = firmware.get(hardware, target)
          if (!release) { log.error(`No valid firmware ${target} for ${hardware}`); return }
          if (!device.allowDowngrade && current && compareVersions(target, current) <= 0) return
          const token = tokens.issue(ws.authenticatedDeviceId, release)
          ws.send(JSON.stringify({ type: 'update-available', version: release.version, size: release.size, sha256: release.sha256, url: `/firmware/${encodeURIComponent(release.hardware)}/${encodeURIComponent(release.version)}`, token }))
        }
        registry.addConnection(ws)
        ws.send(JSON.stringify({ type: 'auth-ok', 'device-id': ws.authenticatedDeviceId }))
        return
      }
      try { dispatcher.dispatch(ws, message) } catch (error) { log.warn('Rejected malformed device message'); log.debug(error) }
    })
  })
  wss.on('close', () => registry.close())
  return { app, server, wss, store, firmware, tokens, tls }
}

function compareVersions(a, b) {
  const parse = value => value.split(/[.+-]/).slice(0, 3).map(Number)
  const left = parse(a); const right = parse(b)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i]
  return a.localeCompare(b)
}

function listen(runtime, port, host, label) {
  runtime.server.listen(port, host, () => log.info(`${label} listener on ${host || '0.0.0.0'}:${runtime.server.address().port}`))
  return runtime
}

function createServer(options = {}) { return createFoundryServer(options) }
function createApp(registry) { return createFoundryApp(registry) }
function start(options = {}) { return listen(createFoundryServer(options), options.port ?? DEFAULT_FOUNDRY_PORT, options.host, 'Foundry') }
function startAll(options = {}) {
  const foundry = listen(createFoundryServer(options), options.foundryPort ?? Number(process.env.FOUNDRY_PORT || DEFAULT_FOUNDRY_PORT), options.host || process.env.FOUNDRY_HOST, 'Foundry')
  const device = listen(createDeviceServer(options), options.devicePort ?? Number(process.env.DEVICE_PORT || DEFAULT_DEVICE_PORT), options.deviceHost || process.env.DEVICE_HOST, 'Device')
  return { foundry, device }
}

if (require.main === module) startAll()

module.exports = { DEFAULT_PORT, DEFAULT_FOUNDRY_PORT, DEFAULT_DEVICE_PORT, compareVersions, createApp, createServer, createFoundryServer, createDeviceServer, start, startAll }
