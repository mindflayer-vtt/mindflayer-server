const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const WebSocket = require("ws");
const cbor = require("cbor");
const { startAll } = require("../src");
const { DeviceStore } = require("../src/security/device-store");
const { calculateHmacBytes } = require("../src/security/device-auth");
const { TYPE, PROTOCOL_VERSION: V } = require("../src/device/protocol");

function inbox(ws, decode) {
  const queued = [],
    waiting = [],
    received = [];
  ws.on("message", (data) => {
    const value = decode(data);
    received.push(value);
    if (waiting.length) waiting.shift()(value);
    else queued.push(value);
  });
  return {
    received,
    next: () =>
      queued.length
        ? Promise.resolve(queued.shift())
        : new Promise((resolve) => waiting.push(resolve)),
  };
}

test(
  "two authenticated keypads share one TLS server with independent events, LEDs, and reconnects",
  { timeout: 10000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mindflayer-multi-"));
    const store = new DeviceStore(path.join(root, "devices.json"));
    const credentials = [
      store.provision("keypad6"),
      store.provision("keypad2"),
    ];
    assert.notEqual(credentials[0].secret, credentials[1].secret);
    const runtime = startAll({
      autoFirmwareUpdates: false,
      host: "127.0.0.1",
      deviceHost: "127.0.0.1",
      foundryPort: 0,
      devicePort: 0,
      deviceStore: store,
      tlsDir: path.join(root, "tls"),
      firmwareDir: path.join(root, "firmware"),
    });
    const sockets = [];
    t.after(() => {
      sockets.forEach((ws) => ws.terminate());
      for (const endpoint of [runtime.foundry, runtime.device]) {
        endpoint.wss.clients.forEach((ws) => ws.terminate());
        endpoint.wss.close();
        endpoint.server.close();
      }
      runtime.foundry.registry.close();
      fs.rmSync(root, { recursive: true, force: true });
    });
    await Promise.all([
      once(runtime.foundry.server, "listening"),
      once(runtime.device.server, "listening"),
    ]);
    const receiver = new WebSocket(
      `ws://127.0.0.1:${runtime.foundry.server.address().port}/ws`,
    );
    sockets.push(receiver);
    const foundry = inbox(receiver, (data) => JSON.parse(data));
    await once(receiver, "open");
    receiver.send(
      JSON.stringify({
        type: "registration",
        "controller-id": "receiver",
        receiver: true,
        players: [],
      }),
    );
    // Ping is a processing barrier for the registration on this same socket.
    receiver.ping();
    await once(receiver, "pong");
    async function connect(credential) {
      // Trust the exact shared fixture certificate, with normal TLS validation.
      const ws = new WebSocket(
        `wss://127.0.0.1:${runtime.device.server.address().port}/device/v1`,
        {
          ca: runtime.device.tls.cert,
          servername: "mindflayer-keypad-server",
        },
      );
      sockets.push(ws);
      const messages = inbox(ws, (data) => cbor.decodeFirstSync(data));
      await once(ws, "open");
      const challenge = await messages.next();
      ws.send(
        cbor.encodeCanonical([
          TYPE.AUTH_RESPONSE,
          V,
          credential.id,
          calculateHmacBytes(
            Buffer.from(credential.secret, "hex"),
            credential.id,
            challenge[2],
          ),
        ]),
      );
      assert.deepEqual(await messages.next(), [
        TYPE.AUTH_RESULT,
        V,
        0,
        credential.id,
      ]);
      ws.send(
        cbor.encodeCanonical([
          TYPE.REGISTRATION,
          V,
          "0.0.3-hwtest.1",
          "mindflayer-keypad-v1",
        ]),
      );
      assert.deepEqual(await messages.next(), [
        TYPE.FIRMWARE_ACCEPTED,
        V,
        "0.0.3-hwtest.1",
      ]);
      return { ws, messages };
    }
    const [six, two] = await Promise.all(credentials.map(connect));
    const registrations = await Promise.all([foundry.next(), foundry.next()]);
    assert.deepEqual(
      registrations.map((message) => message["controller-id"]).sort(),
      ["keypad2", "keypad6"],
    );
    assert.ok(registrations.every((message) => message.status === "connected"));
    assert.equal(runtime.device.registry.getControllerConnections().length, 2);
    function key(device, index, down) {
      device.ws.send(
        cbor.encodeCanonical([TYPE.KEY_EVENT, V, index, down ? 1 : 0]),
      );
    }
    key(six, 0, true);
    key(two, 7, true);
    key(six, 0, false);
    key(two, 7, false);
    const events = await Promise.all(
      Array.from({ length: 4 }, () => foundry.next()),
    );
    assert.deepEqual(
      events
        .map((event) =>
          [event["controller-id"], event.key, event.state].join(":"),
        )
        .sort(),
      ["keypad2:X:down", "keypad2:X:up", "keypad6:Q:down", "keypad6:Q:up"],
    );
    for (const [id, channels] of [
      ["keypad6", [1, 2, 3, 4, 5, 6]],
      ["keypad2", [7, 8, 9, 10, 11, 12]],
    ]) {
      receiver.send(
        JSON.stringify({
          type: "configuration",
          "controller-id": id,
          led1: { r: channels[0], g: channels[1], b: channels[2] },
          led2: { r: channels[3], g: channels[4], b: channels[5] },
        }),
      );
    }
    assert.deepEqual(await six.messages.next(), [
      TYPE.CONFIGURATION,
      V,
      1,
      2,
      3,
      4,
      5,
      6,
    ]);
    assert.deepEqual(await two.messages.next(), [
      TYPE.CONFIGURATION,
      V,
      7,
      8,
      9,
      10,
      11,
      12,
    ]);
    receiver.ping();
    await once(receiver, "pong");
    for (const device of [six, two]) {
      device.ws.ping();
      await once(device.ws, "pong");
      assert.equal(
        device.messages.received.filter(
          (message) => message[0] === TYPE.CONFIGURATION,
        ).length,
        1,
      );
    }
    six.ws.close();
    await once(six.ws, "close");
    assert.deepEqual(await foundry.next(), {
      type: "registration",
      "controller-id": "keypad6",
      status: "disconnected",
      receiver: false,
    });
    key(two, 10, true);
    assert.deepEqual(await foundry.next(), {
      type: "key-event",
      "controller-id": "keypad2",
      key: "SPC",
      state: "down",
    });
    const reconnected = await connect(credentials[0]);
    assert.equal((await foundry.next()).status, "connected");
    assert.equal(runtime.device.registry.getControllerConnections().length, 2);
    key(reconnected, 0, true);
    assert.equal((await foundry.next())["controller-id"], "keypad6");
    key(two, 10, false);
    assert.deepEqual(await foundry.next(), {
      type: "key-event",
      "controller-id": "keypad2",
      key: "SPC",
      state: "up",
    });
  },
);
