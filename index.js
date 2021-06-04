const fs = require('fs')
const https = require('https')
const WebSocket = require('ws')
const url = require('url')
const moment = require('moment')
const connectionRegistry = require('./src/connection/registry')
const messageDispatcher = require('./src/message/dispatcher')

connectionRegistry.attach(messageDispatcher)

messageDispatcher.handlers.VTTKeyEventMessage.push(function relayKeyEvent(sourceConnection, message) {
  connectionRegistry.getReceiverConnections()
      .forEach(conn => conn.send(JSON.stringify(message)))
})

messageDispatcher.handlers.VTTRegistrationMessage.push(function registerEndpoint(newConnection, message){
  newConnection.receiver = message.receiver
  newConnection.controllerId = message['controller-id']
  if(newConnection.receiver) {
    // announce all known controllers
    connectionRegistry.getControllerConnections()
        .forEach(conn => newConnection.send(JSON.stringify({
          type: "registration",
          "controller-id": conn.controllerId,
          status: "connected",
          receiver: false
        })))
  } else {
    // announce controller status
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
  connectionRegistry.getConnections()
      .filter(conn => conn.controllerId == message['controller-id'])
      .forEach(conn => conn.send(JSON.stringify(message)))
})

const server = https.createServer({
  cert: fs.readFileSync('./config/certs/snakeoil.pem'),
  key: fs.readFileSync('./config/certs/snakeoil.key')
}, function httpRequest(req, res) {
  fs.readFile('../test/keypad.html', function (err, data) {
    if (err) {
      res.writeHead(404)
      res.end(JSON.stringify(err))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(data, 'utf-8')
  })
})

const wss = new WebSocket.Server({ noServer: true })

wss.on('connection', function connection(ws) {
  connectionRegistry.addConnection(ws)

  ws.on('message', function incoming(message) {
    console.debug('[%d] received: %s', moment().valueOf(), message)
    const data = JSON.parse(message)
    console.dir(data)
    messageDispatcher.dispatch(this, data)
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

server.listen(10443)

