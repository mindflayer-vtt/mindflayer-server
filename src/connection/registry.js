const moment = require('moment')

const HEALTHCHECK_TIME = 30

/**
 * @type WebSocket[]
 */
let connections = []

function noop() {}

function attach(dispatcher) {
  dispatcher.handlers.VTTMessage.push(heartbeat)
}

function getConnections() {
  return [...connections]
}

function getReceiverConnections() {
  return connections.filter(conn => conn.receiver === true)
}

function getControllerConnections() {
  return connections.filter(conn => conn.receiver === false)
}

function addConnection(connection) {
  if(!connections.includes(connection)) {
    connections.push(connection)

    connection.receiver = null
    heartbeat(connection)
    connection.on('pong', heartbeat.bind(connection, connection))

    connection.on('close', function() {
      console.debug('client disconnected')
      removeConnection(connection)
    })
  }
}

function removeConnection(connection) {
  connections = connections.filter(conn => conn != connection)
}

function heartbeat(connection) {
  connection.lastMessageTime = moment()
}

function checkHealth() {
  const minimumLastMessageTime = moment().subtract(HEALTHCHECK_TIME*1.5, 'seconds')
  connections.forEach(function pingWebsocket(ws) {
    if (minimumLastMessageTime.isAfter(ws.lastMessageTime)) return ws.terminate();

    ws.ping(noop);
  });
}

const healthCheckInterval = setInterval(checkHealth, HEALTHCHECK_TIME*1000)

function close() {
  clearInterval(healthCheckInterval)
}

module.exports = {
  attach, addConnection, removeConnection, heartbeat, getConnections, getReceiverConnections, getControllerConnections, close
}