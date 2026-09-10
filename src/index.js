const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const express = require("express");
const WebSocket = require("ws");
const semver = require("semver");
const log = require("./config/logger");
const { ConnectionRegistry } = require("./connection/registry");
const { createDispatcher } = require("./message/dispatcher");
const {
  calculateHmacBytes,
  safeBytesEqual,
} = require("./security/device-auth");
const {
  AUTH_STATUS,
  MAX_DEVICE_FRAME_SIZE,
  decodeDeviceFrame,
  encodeAuthChallenge,
  encodeAuthResult,
  encodeConfiguration,
  encodeFirmwareAccepted,
} = require("./device/protocol");
const { DeviceStore } = require("./security/device-store");
const { ensureDeviceTls } = require("./security/device-tls");
const { FirmwareRepository } = require("./firmware/repository");
const { OtaTokens } = require("./firmware/tokens");
const {
  createFirmwareRollout,
  autoUpdateEnabled,
} = require("./firmware/rollout");

const DEFAULT_FOUNDRY_PORT = 8080;
const DEFAULT_DEVICE_PORT = 10443;
const DEFAULT_PORT = DEFAULT_DEVICE_PORT;
const MAX_FOUNDRY_FRAME_SIZE = 64 * 1024;

function registerProtocolHandlers(registry, dispatcher) {
  if (!registry.attach(dispatcher)) return;
  dispatcher.handlers.VTTKeyEventMessage.push((source, message) => {
    registry
      .getReceiverConnections()
      .forEach((conn) => conn.send(JSON.stringify(message)));
  });
  dispatcher.handlers.VTTRegistrationMessage.push((connection, message) => {
    if (
      connection.deviceAuthenticated &&
      message["controller-id"] !== connection.authenticatedDeviceId
    ) {
      connection.close(1008, "controller identity mismatch");
      return;
    }
    connection.receiver = message.receiver;
    connection.controllerId = message["controller-id"];
    connection.firmwareVersion = message.firmware;
    connection.hardware = message.hardware;
    if (connection.receiver) {
      connection.players = message.players || [];
      registry.getControllerConnections().forEach((conn) =>
        connection.send(
          JSON.stringify({
            type: "registration",
            "controller-id": conn.controllerId,
            status: "connected",
            receiver: false,
          }),
        ),
      );
    } else {
      log.info(
        `Controller ${connection.controllerId} registered${connection.firmwareVersion ? ` firmware=${connection.firmwareVersion}` : ""}`,
      );
      registry.getReceiverConnections().forEach((conn) =>
        conn.send(
          JSON.stringify({
            type: "registration",
            "controller-id": connection.controllerId,
            status: message.status,
            receiver: false,
          }),
        ),
      );
    }
  });
  dispatcher.handlers.VTTConfigurationMessage.push((connection, message) => {
    registry
      .getControllerConnections()
      .filter((conn) => conn.controllerId === message["controller-id"])
      .forEach((conn) =>
        conn.send(
          conn.deviceProtocol === 1
            ? encodeConfiguration(message, conn.deviceProtocolVersion)
            : JSON.stringify(message),
          conn.deviceProtocol === 1 ? { binary: true } : undefined,
        ),
      );
  });
  dispatcher.handlers.VTTAmbilightMessage.push(require("./handlers/ambilight"));
}

function createFoundryApp(registry = new ConnectionRegistry()) {
  const app = express();
  app.use(express.static(path.join(__dirname, "..", "static")));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
  app.post("/api/players/register", (req, res) => {
    res.end();
    const data = JSON.stringify({
      type: "keyboard-login",
      "controller-id": req.body["controller-id"],
      "player-id": req.body["player-id"],
    });
    registry.getReceiverConnections().forEach((conn) => conn.send(data));
  });
  app.get("/api/players", (req, res) =>
    res.json(registry.getReceiverConnections().flatMap((conn) => conn.players)),
  );
  app.get("/configure", (req, res) =>
    res.sendFile(path.join(__dirname, "..", "static", "configure.html")),
  );
  app.get("/", (req, res) =>
    res.sendFile(path.join(__dirname, "..", "static", "keypad.html")),
  );
  return app;
}

function attachWebSocket(server, expectedPath, maxPayload, onConnection) {
  const wss = new WebSocket.Server({ noServer: true, maxPayload });
  wss.on("connection", (ws, request) => {
    ws.on("error", (error) => log.debug(error));
    onConnection(ws, request);
  });
  server.on("upgrade", (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url, "http://localhost").pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== expectedPath) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) =>
      wss.emit("connection", ws, request),
    );
  });
  return wss;
}

function createFoundryServer(options = {}) {
  const ownsRegistry = !options.registry;
  const registry = options.registry || new ConnectionRegistry();
  const dispatcher = options.dispatcher || createDispatcher();
  registerProtocolHandlers(registry, dispatcher);
  const app = createFoundryApp(registry);
  const server = options.tls
    ? https.createServer(options.tls, app)
    : http.createServer(app);
  const wss = attachWebSocket(server, "/ws", MAX_FOUNDRY_FRAME_SIZE, (ws) => {
    registry.addConnection(ws);
    ws.on("message", (data) => {
      try {
        dispatcher.dispatch(ws, JSON.parse(data));
      } catch (error) {
        log.warn("Rejected malformed Foundry message");
        log.debug(error);
      }
    });
  });
  if (ownsRegistry) wss.on("close", () => registry.close());
  return { app, server, wss, registry, dispatcher };
}

function parseBearer(request) {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(
    request.headers.authorization || "",
  );
  return match && match[1];
}

function createDeviceServer(options = {}) {
  const ownsRegistry = !options.registry;
  const store =
    options.deviceStore ||
    new DeviceStore(
      options.devicesFile ||
        path.join(process.env.MINDFLAYER_DATA_DIR || "./data", "devices.json"),
    );
  const firmware =
    options.firmwareRepository ||
    new FirmwareRepository(
      options.firmwareDir ||
        process.env.MINDFLAYER_FIRMWARE_DIR ||
        "./firmware",
    );
  const tokens = options.tokens || new OtaTokens();
  const rollout = createFirmwareRollout(options, firmware, tokens, log);
  const tls =
    options.tls ||
    ensureDeviceTls(
      options.tlsDir ||
        path.join(process.env.MINDFLAYER_DATA_DIR || "./data", "tls"),
    );
  const registry = options.registry || new ConnectionRegistry();
  const dispatcher = options.dispatcher || createDispatcher();
  registerProtocolHandlers(registry, dispatcher);
  const app = express();
  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
  app.get("/firmware/:hardware/:version", (req, res) => {
    const grant = tokens.consume(parseBearer(req));
    if (
      !grant ||
      grant.release.hardware !== req.params.hardware ||
      grant.release.version !== req.params.version
    )
      return res.sendStatus(401);
    if (grant.release.automatic) {
      try {
        // Verify the complete bounded image before sending any firmware bytes.
        const bytes = rollout.updater.read(grant.release);
        res.set({
          "Content-Type": "application/octet-stream",
          "Content-Length": bytes.length,
          "Cache-Control": "no-store",
        });
        return res.end(bytes);
      } catch (error) {
        log.error(`Unable to verify cached firmware: ${error.message}`);
        return res.status(503).end();
      }
    }
    const stream = fs.createReadStream(grant.release.file);
    stream.once("open", () => {
      res.set({
        "Content-Type": "application/octet-stream",
        "Content-Length": grant.release.size,
        "Cache-Control": "no-store",
      });
      stream.pipe(res);
    });
    stream.once("error", (error) => {
      log.error(
        `Unable to stream firmware ${grant.release.hardware} ${grant.release.version}: ${error.message}`,
      );
      if (!res.headersSent) res.sendStatus(404);
      else res.destroy(error);
    });
  });
  const server = https.createServer(tls, app);
  const wss = attachWebSocket(
    server,
    "/device/v1",
    MAX_DEVICE_FRAME_SIZE,
    (ws) => {
      ws.deviceProtocol = 1;
      ws.deviceProtocolVersion = null;
      ws.deviceAuthenticated = false;
      ws.authChallenge = crypto.randomBytes(32);
      ws.send(encodeAuthChallenge(ws.authChallenge), { binary: true });
      ws.on("message", (data, isBinary) => {
        let message;
        if (
          !isBinary ||
          data.length === 0 ||
          data.length > MAX_DEVICE_FRAME_SIZE
        ) {
          ws.close(1009, "invalid device frame");
          return;
        }
        try {
          message = decodeDeviceFrame(data);
        } catch {
          ws.close(1008, "malformed device message");
          return;
        }
        if (!ws.deviceAuthenticated) {
          if (message.type !== "auth-response") {
            ws.close(1008, "authentication required");
            return;
          }
          ws.deviceProtocolVersion = message.protocolVersion;
          const device = store.get(message.deviceId);
          const expected =
            device &&
            calculateHmacBytes(
              Buffer.from(device.secret, "hex"),
              message.deviceId,
              ws.authChallenge,
            );
          ws.authChallenge = null;
          if (!expected || !safeBytesEqual(message.hmac, expected)) {
            ws.send(
              encodeAuthResult(
                AUTH_STATUS.FAILED,
                "",
                ws.deviceProtocolVersion,
              ),
              { binary: true },
            );
            ws.close(1008, "authentication failed");
            return;
          }
          ws.deviceAuthenticated = true;
          ws.authenticatedDeviceId = message.deviceId;
          ws.offerUpdate = (registration) =>
            rollout.offer(ws, device, registration);
          registry.addConnection(ws);
          ws.send(
            encodeAuthResult(
              AUTH_STATUS.OK,
              ws.authenticatedDeviceId,
              ws.deviceProtocolVersion,
            ),
            { binary: true },
          );
          return;
        }
        if (message.protocolVersion !== ws.deviceProtocolVersion) {
          ws.close(1008, "device protocol version changed");
          return;
        }
        try {
          if (message.type === "registration") {
            const device = store.get(ws.authenticatedDeviceId);
            const accepted =
              !device.targetVersion ||
              (message.firmware === device.targetVersion &&
                Boolean(rollout.get(message.hardware, device.targetVersion)));
            dispatcher.dispatch(ws, {
              type: "registration",
              "controller-id": ws.authenticatedDeviceId,
              status: "connected",
              receiver: false,
              firmware: message.firmware,
              hardware: message.hardware,
            });
            if (accepted)
              ws.send(
                encodeFirmwareAccepted(
                  message.firmware,
                  ws.deviceProtocolVersion,
                ),
                { binary: true },
              );
            // A temporary candidate must see its health acknowledgement before
            // another update offer can make it close WSS for an OTA download.
            ws.offerUpdate(message);
          } else if (message.type === "key-event")
            dispatcher.dispatch(ws, {
              type: "key-event",
              "controller-id": ws.authenticatedDeviceId,
              key: message.key,
              state: message.state,
            });
          else ws.close(1008, "device message not authorized");
        } catch (error) {
          log.warn("Rejected malformed device message");
          log.debug(error);
        }
      });
    },
  );
  if (ownsRegistry) wss.on("close", () => registry.close());
  rollout.attach(server, wss, store);
  return {
    app,
    server,
    wss,
    store,
    firmware,
    firmwareUpdater: rollout.updater,
    tokens,
    tls,
    registry,
    dispatcher,
  };
}

function compareVersions(a, b) {
  return semver.compare(a, b);
}

function listen(runtime, port, host, label) {
  runtime.server.listen(port, host, () =>
    log.info(
      `${label} listener on ${host || "0.0.0.0"}:${runtime.server.address().port}`,
    ),
  );
  return runtime;
}

function createServer(options = {}) {
  return createFoundryServer(options);
}
function createApp(registry) {
  return createFoundryApp(registry);
}
function start(options = {}) {
  return listen(
    createFoundryServer(options),
    options.port ?? DEFAULT_FOUNDRY_PORT,
    options.host,
    "Foundry",
  );
}
function startAll(options = {}) {
  const autoFirmwareUpdates = autoUpdateEnabled(options.autoFirmwareUpdates);
  const registry = options.registry || new ConnectionRegistry();
  const dispatcher = options.dispatcher || createDispatcher();
  const sharedOptions = {
    ...options,
    autoFirmwareUpdates,
    registry,
    dispatcher,
  };
  // Validate device configuration before opening either listener.
  let device, foundry;
  try {
    device = createDeviceServer(sharedOptions);
    foundry = createFoundryServer(sharedOptions);
  } catch (error) {
    device?.wss.close();
    if (!options.registry) registry.close();
    throw error;
  }
  listen(
    foundry,
    options.foundryPort ??
      Number(process.env.FOUNDRY_PORT || DEFAULT_FOUNDRY_PORT),
    options.host || process.env.FOUNDRY_HOST,
    "Foundry",
  );
  listen(
    device,
    options.devicePort ??
      Number(process.env.DEVICE_PORT || DEFAULT_DEVICE_PORT),
    options.deviceHost || process.env.DEVICE_HOST,
    "Device",
  );
  let openServers = 2;
  const closeRegistry = () => {
    if (--openServers === 0) registry.close();
  };
  foundry.wss.once("close", closeRegistry);
  device.wss.once("close", closeRegistry);
  return { foundry, device };
}

if (require.main === module) startAll();

module.exports = {
  DEFAULT_PORT,
  DEFAULT_FOUNDRY_PORT,
  DEFAULT_DEVICE_PORT,
  MAX_FOUNDRY_FRAME_SIZE,
  compareVersions,
  createApp,
  createServer,
  createFoundryServer,
  createDeviceServer,
  start,
  startAll,
};
