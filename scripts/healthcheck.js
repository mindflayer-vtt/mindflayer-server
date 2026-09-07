const http = require('http')
const https = require('https')

const foundryPort = Number(process.env.FOUNDRY_PORT || 8080)
const devicePort = Number(process.env.DEVICE_PORT || 10443)

function check(client, port, options = {}) {
  return new Promise((resolve, reject) => {
    const request = client.get({ host: '127.0.0.1', port, path: '/healthz', timeout: 3000, ...options }, response => {
      response.resume()
      response.statusCode === 200 ? resolve() : reject(new Error(`port ${port} returned ${response.statusCode}`))
    })
    request.on('timeout', () => request.destroy(new Error(`port ${port} timed out`)))
    request.on('error', reject)
  })
}

Promise.all([
  check(http, foundryPort),
  check(https, devicePort, { rejectUnauthorized: false })
]).catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
