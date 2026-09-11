#!/usr/bin/env node
const { waitForInstallation } = require("../src/provisioning/online");
setTimeout(() => process.exit(1), 130000).unref();
async function main() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 2048) throw new Error("Input exceeds limit");
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const result = await waitForInstallation({
    id: input.id,
    firmware: input.firmware,
    digest: input.digest,
    notBefore: input.notBefore,
    url: "ws://127.0.0.1:" + (process.env.FOUNDRY_PORT || "8080") + "/ws",
  });
  process.stdout.write(JSON.stringify(result) + "\n");
}
main().catch(() => {
  process.stderr.write(
    "Authenticated online firmware and configuration could not be verified.\n",
  );
  process.exitCode = 1;
});
