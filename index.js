const fs = require('fs')
const https = require('https')
const WebSocket = require('ws')
const url = require('url')
const path = require('path')
const express = require('express')
const moment = require('moment')
const connectionRegistry = require('./src/connection/registry')
const messageDispatcher = require('./src/message/dispatcher')

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
    console.log("[%d] announce all known controllers to new receiver", moment().valueOf())
    connectionRegistry.getControllerConnections()
        .forEach(conn => newConnection.send(JSON.stringify({
          type: "registration",
          "controller-id": conn.controllerId,
          status: "connected",
          receiver: false
        })))
  } else {
    console.log("[%d] announce new controller to receivers", moment().valueOf())
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
        console.log('[%d] sending config %s to: %s', moment().valueOf(), data, conn.controllerId)
        conn.send(data)
      })
})

const app = express()

app.use(express.static('../test'))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.post('/api/players/register', (req, res) => {
  res.end()
  const data = JSON.stringify({
    type: "keyboard-login",
    'controller-id': req.body['controller-id'],
    'player-id': req.body['player-id']
  })
  console.log('[%d] sending "%s" to all receivers', moment().valueOf(), data)
  connectionRegistry.getReceiverConnections().forEach(conn => {
    conn.send(data)
  })
})

app.get('/api/players', (req, res) => {
  res.json(connectionRegistry.getReceiverConnections().flatMap(conn => conn.players))
})

app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, '..','test','configure.html'))
})

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..','test','keypad.html'))
})

const server = https.createServer({
  cert: fs.readFileSync('./config/certs/snakeoil.pem'),
  key: fs.readFileSync('./config/certs/snakeoil.key')
}, app)

const wss = new WebSocket.Server({ noServer: true })

wss.on('connection', function connection(ws) {
  connectionRegistry.addConnection(ws)

  ws.on('message', function incoming(message) {
    console.debug('[%d] received: %s', moment().valueOf(), message)
    try {
      const data = JSON.parse(message)
      console.dir(data)
      messageDispatcher.dispatch(this, data)
    } catch(ex) {
      console.error('[%d] unable to handle message: %s', moment().valueOf(), ex)
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
  console.log('[%d] Now listening on Port %d', moment().valueOf(), PORT)
})
