const path = require('path')
const { DeviceStore } = require('../src/security/device-store')

const id = process.argv[2]
if (!id) { console.error('Usage: npm run device:provision -- <device-id>'); process.exit(2) }
const file = process.env.MINDFLAYER_DEVICES_FILE || path.join(process.env.MINDFLAYER_DATA_DIR || './data', 'devices.json')
try {
  const device = new DeviceStore(file).provision(id)
  process.stdout.write(JSON.stringify(device, null, 2) + '\n')
  console.error(`Provisioned ${id} in ${file}. The secret above is displayed once; copy it into ignored device configuration.`)
} catch (error) { console.error(error.message); process.exit(1) }
