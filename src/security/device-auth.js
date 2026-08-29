const crypto = require('crypto')

const AUTH_DOMAIN = 'mindflayer-device-auth-v1'

function authInput(deviceId, challenge) {
  const fields = [AUTH_DOMAIN, deviceId, challenge]
  return Buffer.concat(fields.map(value => {
    const bytes = Buffer.from(value, 'utf8')
    const length = Buffer.alloc(4)
    length.writeUInt32BE(bytes.length)
    return Buffer.concat([length, bytes])
  }))
}

function calculateHmac(secret, deviceId, challenge) {
  return crypto.createHmac('sha256', secret).update(authInput(deviceId, challenge)).digest('hex')
}

function safeHexEqual(actual, expected) {
  if (typeof actual !== 'string' || !/^[0-9a-f]{64}$/i.test(actual)) return false
  const a = Buffer.from(actual, 'hex')
  const b = Buffer.from(expected, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

module.exports = { AUTH_DOMAIN, authInput, calculateHmac, safeHexEqual }
