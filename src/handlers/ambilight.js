const log = require('../config/logger')
const E131Client = require('e131').Client

let connections = new Map()

/**
 * Validate the contents of the message to match an Ambilight message
 * @param {VTTAmbilightMessage} message 
 * @returns boolean true if message is valid false otherwise
 */
function validate(message) {
  if(typeof message != typeof {}) {
    return false
  } else if (!message.hasOwnProperty('colors') || !Array.isArray(message.colors) || message.colors.length <= 0) {
    log.error("Ambilight message 'colors' attribute missing or missformatted.")
    return false
  } else if (!message.hasOwnProperty('universe') || message.universe < 0x01 || message.universe > 0xff) {
    log.error("Ambilight message 'universe' attribute missing or missformatted.")
    return false
  } else if (!message.hasOwnProperty('target')) {
    log.error("Ambilight message 'target' attribute missing.")
    return false
  }
  return true
}

module.exports = function handler_ambilight(origin, message) {
  if(!validate(message)) {
    log.warn("Got invalid ambilight message, ignoring.")
    log.debug("message: " + JSON.stringify(message))
    return
  }
  if(!connections.has(message.target)) {
    connections.set(message.target, new E131Client(message.target))
  }
  const conn = connections.get(message.target)
  const packet = conn.createPacket(message.colors.length)
  packet.setSourceName("Mindflayer Server")
  packet.setUniverse(message.universe)
  const data = packet.getSlotsData();
  for(let i = 0; i < data.length; i++) {
    data[i] = message.colors[i]
  }
  log.debug("sending E131 Packet")
  conn.send(packet)
}