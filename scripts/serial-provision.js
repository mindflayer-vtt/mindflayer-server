#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { verifyEnvelope } = require('../src/provisioning/format')
const bundle = process.argv[2], serialPath = process.argv[3]
if (!bundle || !serialPath || !serialPath.startsWith('/dev/serial/by-path/')) { console.error('Usage: npm run device:serial-provision -- <bundle> </dev/serial/by-path/...>'); process.exit(2) }
const envelope = fs.readFileSync(bundle); verifyEnvelope(envelope); const resolved = fs.realpathSync(serialPath)
console.log(`Writing validated provisioning envelope to ${serialPath} (${resolved}); no secret fields will be printed.`)
execFileSync('python3', [path.join(__dirname, 'serial-provision-transport.py'), bundle, serialPath], { stdio: 'inherit' })
