
const handlers = {
  VTTMessage: [VTTMessageHandler],
  VTTKeyEventMessage: [],
  VTTRegistrationMessage: [],
  VTTConfigurationMessage: []
}

function VTTMessageHandler(origin, message) {
  if(!message || !message.hasOwnProperty("type")) {
    console.warn("Could not handle message:", message)
  } else {
    let selected = []
    switch(message.type) {
      case "key-event":
        selected = handlers.VTTKeyEventMessage
        break;
      case "registration":
        selected = handlers.VTTRegistrationMessage
        break;
      case "configuration":
        selected = handlers.VTTConfigurationMessage
        break;
      default:
        console.warn("Unknown Message Type: ", message)
        break;
    }
    selected.forEach(handler => handler(origin, message))
  }
}

function dispatch(origin, message) {
  handlers.VTTMessage.forEach(handler => handler(origin, message))
}

module.exports = {
  handlers, dispatch
}