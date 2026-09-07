const moment = require('moment')
const log = require('../config/logger')

const HEALTHCHECK_TIME = 30

class ConnectionRegistry {
  constructor({ healthCheckTime = HEALTHCHECK_TIME } = {}) {
    this.healthCheckTime = healthCheckTime
    this.connections = []
    this.dispatcher = null
    this.healthCheckInterval = setInterval(() => this.checkHealth(), healthCheckTime * 1000)
  }

  attach(dispatcher) {
    if (this.dispatcher === dispatcher) return false
    this.dispatcher = dispatcher
    dispatcher.handlers.VTTMessage.push(connection => this.heartbeat(connection))
    return true
  }

  getConnections() { return [...this.connections] }
  getReceiverConnections() { return this.connections.filter(connection => connection.receiver === true) }
  getControllerConnections() { return this.connections.filter(connection => connection.receiver === false) }

  addConnection(connection) {
    if (this.connections.includes(connection)) return
    this.connections.push(connection)
    connection.receiver = null
    connection.controllerId = null
    this.heartbeat(connection)
    connection.on('pong', () => this.heartbeat(connection))
    connection.on('close', () => {
      log.debug('client disconnected')
      this.removeConnection(connection)
    })
  }

  removeConnection(connection) {
    this.connections = this.connections.filter(candidate => candidate !== connection)
    if (this.dispatcher && connection.controllerId !== null) {
      this.dispatcher.dispatch(connection, {
        type: 'registration',
        'controller-id': connection.controllerId,
        status: 'disconnected',
        receiver: false
      })
    }
  }

  heartbeat(connection) { connection.lastMessageTime = moment() }

  checkHealth() {
    const minimum = moment().subtract(this.healthCheckTime * 1.5, 'seconds')
    this.connections.forEach(connection => {
      if (minimum.isAfter(connection.lastMessageTime)) connection.terminate()
      else connection.ping(() => {})
    })
  }

  close() {
    clearInterval(this.healthCheckInterval)
    this.connections = []
  }
}

module.exports = { ConnectionRegistry, HEALTHCHECK_TIME }
