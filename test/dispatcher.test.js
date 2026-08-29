const test = require('node:test')
const assert = require('node:assert/strict')
const dispatcher = require('../src/message/dispatcher')

test('dispatches each supported protocol message to its handler group', () => {
  const cases = [
    ['key-event', 'VTTKeyEventMessage'],
    ['registration', 'VTTRegistrationMessage'],
    ['configuration', 'VTTConfigurationMessage'],
    ['ambilight', 'VTTAmbilightMessage']
  ]
  for (const [type, group] of cases) {
    let received
    const handler = (origin, message) => { received = { origin, message } }
    dispatcher.handlers[group].push(handler)
    const origin = {}
    const message = { type }
    dispatcher.dispatch(origin, message)
    dispatcher.handlers[group].pop()
    assert.deepEqual(received, { origin, message })
  }
})

test('ignores missing and unknown message types', () => {
  const counts = Object.fromEntries(
    Object.entries(dispatcher.handlers).map(([name, handlers]) => [name, handlers.length])
  )
  assert.doesNotThrow(() => dispatcher.dispatch({}, null))
  assert.doesNotThrow(() => dispatcher.dispatch({}, {}))
  assert.doesNotThrow(() => dispatcher.dispatch({}, { type: 'not-supported' }))
  for (const [name, handlers] of Object.entries(dispatcher.handlers)) {
    assert.equal(handlers.length, counts[name])
  }
})
