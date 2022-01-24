const fs = require('fs')
const https = require('https')
const WebSocket = require('ws')
const url = require('url')
const path = require('path')
const express = require('express')
const log = require('./config/logger')
const connectionRegistry = require('./connection/registry')
const messageDispatcher = require('./message/dispatcher')

// configuration
const PORT = 10443

connectionRegistry.attach(messageDispatcher)

messageDispatcher.handlers.VTTKeyEventMessage.push(function relayKeyEvent(sourceConnection, message) {
  connectionRegistry.getReceiverConnections()
      .forEach(conn => conn.send(JSON.stringify(message)))
})

messageDispatcher.handlers.VTTRegistrationMessage.push(function registerEndpoint(newConnection, message){
  newConnection.receiver = message.receiver
  newConnection.controllerId = message['controller-id']
  if(newConnection.receiver) {
    newConnection.players = message.players || []
    log.debug("announce all known controllers to new receiver")
    connectionRegistry.getControllerConnections()
        .forEach(conn => newConnection.send(JSON.stringify({
          type: "registration",
          "controller-id": conn.controllerId,
          status: "connected",
          receiver: false
        })))
  } else {
    log.debug("announce new controller to receivers")
    connectionRegistry.getReceiverConnections()
        .forEach(conn => conn.send(JSON.stringify({
          type: "registration",
          "controller-id": newConnection.controllerId,
          status: message.status,
          receiver: false
        })))
  }
})

messageDispatcher.handlers.VTTConfigurationMessage.push(function configureEndpoint(connection, message) {
  connectionRegistry.getControllerConnections()
      .filter(conn => conn.controllerId == message['controller-id'])
      .forEach(conn => {
        const data = JSON.stringify(message)
        log.debug('sending config "' + data + '" to: "' + conn.controllerId + '"')
        conn.send(data)
      })
})

messageDispatcher.handlers.VTTAmbilightMessage.push(require('./handlers/ambilight'))

const app = express()

app.use(express.static('./../static'))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.post('/api/players/register', (req, res) => {
  res.end()
  const data = JSON.stringify({
    type: "keyboard-login",
    'controller-id': req.body['controller-id'],
    'player-id': req.body['player-id']
  })
  log.debug('sending "' + data + '" to all receivers')
  connectionRegistry.getReceiverConnections().forEach(conn => {
    conn.send(data)
  })
})

app.get('/api/players', (req, res) => {
  res.json(connectionRegistry.getReceiverConnections().flatMap(conn => conn.players))
})

app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, '..','static','configure.html'))
})

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..','static','keypad.html'))
})

const server = https.createServer({
  cert: fs.readFileSync('./config/certs/snakeoil.pem'),
  key: fs.readFileSync('./config/certs/snakeoil.key')
}, app)

const wss = new WebSocket.Server({ noServer: true })

wss.on('connection', function connection(ws) {
  connectionRegistry.addConnection(ws)

  ws.on('message', function incoming(message) {
    log.trace('received: %s', message)
    try {
      const data = JSON.parse(message)
      messageDispatcher.dispatch(this, data)
    } catch(ex) {
      log.error('unable to handle message:')
      log.debug(ex)
    }
  })
})

wss.on('close', function close() {
  connectionRegistry.close()
})

server.on('upgrade', function upgrade(request, socket, head) {
  const pathname = url.parse(request.url).pathname

  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, function done(ws) {
      wss.emit('connection', ws, request)
    })
  } else {
    socket.destroy()
  }
})

server.listen(PORT, () => {
  log.info('Now listening on Port ' + PORT)
})
