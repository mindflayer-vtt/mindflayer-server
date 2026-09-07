const log = require('../config/logger')

function dispatchByType(handlers, origin, message) {
  if(!message || !message.hasOwnProperty("type")) {
    log.info("Message does not have a type:" + message)
  } else {
    let selected = []
    switch(message.type) {
      case "key-event":
        selected = handlers.VTTKeyEventMessage
        break
      case "registration":
        selected = handlers.VTTRegistrationMessage
        break
      case "configuration":
        selected = handlers.VTTConfigurationMessage
        break
      case "ambilight":
        selected = handlers.VTTAmbilightMessage
        break
      default:
        log.warn("Unknown Message Type: " + message.type)
        log.debug(message)
        break
    }
    selected.forEach(handler => handler(origin, message))
  }
}

function createDispatcher() {
  const handlers = {
    VTTMessage: [],
    VTTKeyEventMessage: [],
    VTTRegistrationMessage: [],
    VTTConfigurationMessage: [],
    VTTAmbilightMessage: []
  }
  handlers.VTTMessage.push((origin, message) => dispatchByType(handlers, origin, message))
  return { handlers, dispatch: (origin, message) => handlers.VTTMessage.forEach(handler => handler(origin, message)) }
}

module.exports = { createDispatcher }
