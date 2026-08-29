const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

function validateId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new Error('Invalid device ID')
}

class DeviceStore {
  constructor(file) {
    this.file = file
    this.reload()
  }
  reload() {
    if (!fs.existsSync(this.file)) { this.devices = {}; return }
    const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    if (parsed.version !== 1 || typeof parsed.devices !== 'object' || Array.isArray(parsed.devices)) throw new Error('Invalid device credentials file')
    for (const [id, device] of Object.entries(parsed.devices)) {
      validateId(id)
      if (!device || typeof device.secret !== 'string' || !/^[0-9a-f]{64}$/i.test(device.secret)) throw new Error(`Invalid credential for ${id}`)
    }
    this.devices = parsed.devices
  }
  get(id) { return this.devices[id] }
  provision(id) {
    validateId(id)
    if (this.devices[id]) throw new Error(`Device ${id} already exists`)
    const device = { secret: crypto.randomBytes(32).toString('hex') }
    this.devices[id] = device
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, devices: this.devices }, null, 2) + '\n', { mode: 0o600 })
    fs.renameSync(temporary, this.file)
    fs.chmodSync(this.file, 0o600)
    return { id, ...device }
  }
}

module.exports = { DeviceStore, validateId }
