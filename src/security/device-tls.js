const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const KEY_FILE = 'device-key.pem'
const CERT_FILE = 'device-cert.pem'

function ensureDeviceTls(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const keyPath = path.join(directory, KEY_FILE)
  const certPath = path.join(directory, CERT_FILE)
  if (!fs.existsSync(keyPath)) {
    if (fs.existsSync(certPath)) throw new Error('Device TLS certificate exists without its private key')
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    })
    fs.writeFileSync(keyPath, privateKey, { mode: 0o600, flag: 'wx' })
  }
  fs.chmodSync(keyPath, 0o600)
  if (!fs.existsSync(certPath)) {
    execFileSync('openssl', [
      'req', '-new', '-x509', '-sha256', '-days', '825', '-key', keyPath,
      '-out', certPath, '-subj', '/CN=mindflayer-keypad-server',
      '-addext', 'basicConstraints=critical,CA:FALSE',
      '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
      '-addext', 'extendedKeyUsage=serverAuth'
    ], { stdio: 'pipe' })
    fs.chmodSync(certPath, 0o644)
  }
  const key = fs.readFileSync(keyPath)
  const cert = fs.readFileSync(certPath)
  // Parsing both detects corrupt state before the listener starts.
  const privateKey = crypto.createPrivateKey(key)
  const publicKey = crypto.createPublicKey(privateKey)
  const certificate = new crypto.X509Certificate(cert)
  if (!certificate.publicKey.equals(publicKey)) throw new Error('Device TLS certificate does not match private key')
  return { key, cert, keyPath, certPath, publicKey: publicKey.export({ type: 'spki', format: 'pem' }) }
}

module.exports = { CERT_FILE, KEY_FILE, ensureDeviceTls }
