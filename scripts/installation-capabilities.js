#!/usr/bin/env node
setTimeout(() => process.exit(1), 7000).unref();
async function main() {
  const response = await fetch(
    "http://127.0.0.1:" +
      (process.env.FOUNDRY_PORT || "8080") +
      "/api/capabilities",
    { signal: AbortSignal.timeout(5000) },
  );
  if (!response.ok) throw new Error("Capabilities unavailable");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 4096) throw new Error("Capabilities exceed limit");
    chunks.push(chunk);
  }
  const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  process.stdout.write(
    JSON.stringify({
      deviceProtocolVersions: result.deviceProtocolVersions,
      configurationProof: result.configurationProof,
    }) + "\n",
  );
}
main().catch(() => {
  process.stderr.write("Installation capabilities unavailable.\n");
  process.exitCode = 1;
});
