const crypto = require('crypto')

class OtaTokens {
  constructor({ lifetimeMs = 120000, now = Date.now } = {}) { this.lifetimeMs = lifetimeMs; this.now = now; this.tokens = new Map() }
  issue(deviceId, release) {
    const token = crypto.randomBytes(32).toString('base64url')
    this.tokens.set(token, { deviceId, release, expires: this.now() + this.lifetimeMs, uses: 2 })
    return token
  }
  consume(token) {
    const grant = this.tokens.get(token)
    if (!grant || grant.expires <= this.now() || grant.uses-- <= 0) { this.tokens.delete(token); return null }
    if (grant.uses === 0) this.tokens.delete(token)
    return grant
  }
}

module.exports = { OtaTokens }
