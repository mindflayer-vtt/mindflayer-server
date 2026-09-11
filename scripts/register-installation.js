#!/usr/bin/env node
// Private stdin only; successful stdout intentionally contains no credential.
const path = require("path");
const { DeviceStore } = require("../src/security/device-store");
setTimeout(() => process.exit(1), 15000).unref();
async function main() {
  if (process.stdin.isTTY) throw new Error("Private input required");
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1024) throw new Error("Input exceeds limit");
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const file = path.join(
    process.env.MINDFLAYER_DATA_DIR || "./data",
    "devices.json",
  );
  const registered = new DeviceStore(file).register(input.id, input.secret);
  process.stdout.write(
    JSON.stringify({ id: registered.id, state: "registered" }) + "\n",
  );
}
main().catch(() => {
  process.stderr.write(
    "Unable to register installation credential; check existing identity and the private credential-store lock.\n",
  );
  process.exitCode = 1;
});
