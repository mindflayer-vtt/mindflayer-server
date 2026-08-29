const fs = require('fs')
const http = require('http')
const https = require('https')
const WebSocket = require('ws')
const path = require('path')
const express = require('express')
const log = require('./config/logger')
const connectionRegistry = require('./connection/registry')
const messageDispatcher = require('./message/dispatcher')

const DEFAULT_PORT = 10443

function registerProtocolHandlers(registry, dispatcher) {
  registry.attach(dispatcher)
  dispatcher.handlers.VTTKeyEventMessage.push((source, message) => {
    registry.getReceiverConnections().forEach(conn => conn.send(JSON.stringify(message)))
  })
  dispatcher.handlers.VTTRegistrationMessage.push((connection, message) => {
    connection.receiver = message.receiver
    connection.controllerId = message['controller-id']
    if (connection.receiver) {
      connection.players = message.players || []
      registry.getControllerConnections().forEach(conn => connection.send(JSON.stringify({
        type: 'registration',
        'controller-id': conn.controllerId,
        status: 'connected',
        receiver: false
      })))
    } else {
      registry.getReceiverConnections().forEach(conn => conn.send(JSON.stringify({
        type: 'registration',
        'controller-id': connection.controllerId,
        status: message.status,
        receiver: false
      })))
    }
  })
  dispatcher.handlers.VTTConfigurationMessage.push((connection, message) => {
    registry.getControllerConnections()
      .filter(conn => conn.controllerId == message['controller-id'])
      .forEach(conn => conn.send(JSON.stringify(message)))
  })
  dispatcher.handlers.VTTAmbilightMessage.push(require('./handlers/ambilight'))
}

function createApp(registry = connectionRegistry) {
  const app = express()
  app.use(express.static(path.join(__dirname, '..', 'static')))
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  app.post('/api/players/register', (req, res) => {
    res.end()
    const data = JSON.stringify({
      type: 'keyboard-login',
      'controller-id': req.body['controller-id'],
      'player-id': req.body['player-id']
    })
    registry.getReceiverConnections().forEach(conn => conn.send(data))
  })
  app.get('/api/players', (req, res) => {
    res.json(registry.getReceiverConnections().flatMap(conn => conn.players))
  })
  app.get('/configure', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'static', 'configure.html'))
  })
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'static', 'keypad.html'))
  })
  return app
}

function createServer(options = {}) {
  const registry = options.registry || connectionRegistry
  const dispatcher = options.dispatcher || messageDispatcher
  registerProtocolHandlers(registry, dispatcher)
  const app = createApp(registry)
  const server = options.tls === false
    ? http.createServer(app)
    : https.createServer(options.tls || {
      cert: fs.readFileSync('./config/certs/snakeoil.pem'),
      key: fs.readFileSync('./config/certs/snakeoil.key')
    }, app)
  const wss = new WebSocket.Server({ noServer: true })

  wss.on('connection', ws => {
    registry.addConnection(ws)
    ws.on('message', function incoming(message) {
      try {
        dispatcher.dispatch(this, JSON.parse(message))
      } catch (ex) {
        log.error('unable to handle message:')
        log.debug(ex)
      }
    })
  })
  wss.on('close', () => registry.close())
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (pathname !== '/ws') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request))
  })
  return { app, server, wss }
}

function start(options = {}) {
  const runtime = createServer(options)
  const port = options.port === undefined ? DEFAULT_PORT : options.port
  runtime.server.listen(port, options.host, () => {
    log.info('Now listening on Port ' + runtime.server.address().port)
  })
  return runtime
}

if (require.main === module) start()

module.exports = { DEFAULT_PORT, createApp, createServer, start }
