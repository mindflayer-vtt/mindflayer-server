const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { WebSocketServer } = require("ws");
const { waitForInstallation } = require("../src/provisioning/online");

async function fixture(t, messages) {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  t.after(() => {
    for (const socket of server.clients) socket.terminate();
    server.close();
  });
  server.on("connection", (socket) =>
    socket.once("message", () => {
      for (const message of messages) socket.send(JSON.stringify(message));
    }),
  );
  return `ws://127.0.0.1:${server.address().port}`;
}
test("online verification rejects stale, untrusted, disconnected and mismatched reports", async (t) => {
  const notBefore = Date.now(),
    digest = "a".repeat(64);
  const registration = {
    type: "registration",
    "controller-id": "keypad",
    status: "connected",
    deviceAuthenticated: true,
    firmware: "1.2.3",
    hardware: "mindflayer-keypad-v1",
    configurationDigest: digest,
    configurationVerifiedAt: notBefore,
  };
  for (const changes of [
    { configurationVerifiedAt: notBefore - 1 },
    { configurationVerifiedAt: Date.now() + 60000 },
    { deviceAuthenticated: false },
    { status: "disconnected" },
    { firmware: "1.2.2" },
    { hardware: "other" },
    { configurationDigest: "b".repeat(64) },
  ]) {
    const url = await fixture(t, [{ ...registration, ...changes }]);
    await assert.rejects(
      waitForInstallation({
        url,
        id: "keypad",
        firmware: "1.2.3",
        digest,
        notBefore,
        timeout: 50,
      }),
      /Timed out/,
    );
  }
});
test("a fresh proof following authenticated registration completes verification", async (t) => {
  const notBefore = Date.now(),
    digest = "a".repeat(64);
  const url = await fixture(t, [
    {
      type: "configuration-state",
      "controller-id": "keypad",
      deviceAuthenticated: true,
      configurationDigest: digest,
      configurationVerifiedAt: notBefore,
    },
    {
      type: "registration",
      "controller-id": "keypad",
      status: "connected",
      deviceAuthenticated: true,
      firmware: "1.2.3",
      hardware: "mindflayer-keypad-v1",
    },
    {
      type: "configuration-state",
      "controller-id": "keypad",
      deviceAuthenticated: true,
      configurationDigest: digest,
      configurationVerifiedAt: notBefore,
    },
  ]);
  const result = await waitForInstallation({
    url,
    id: "keypad",
    firmware: "1.2.3",
    digest,
    notBefore,
    timeout: 1000,
  });
  assert.equal(result.configurationVerifiedAt, notBefore);
  assert.equal(result.connected, true);
});
