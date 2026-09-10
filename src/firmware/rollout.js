const path = require("node:path");
const semver = require("semver");
const WebSocket = require("ws");
const {
  GithubFirmwareUpdater,
  DEFAULT_INTERVAL_MS,
} = require("./github-updater");
const { encodeUpdateAvailable } = require("../device/protocol");

const RETRY_INTERVAL_MS = 10 * 60 * 1000;

function autoUpdateEnabled(
  value = process.env.MINDFLAYER_FIRMWARE_AUTO_UPDATE ?? "true",
) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error("MINDFLAYER_FIRMWARE_AUTO_UPDATE must be true or false");
}

function createFirmwareRollout(options, firmware, tokens, logger) {
  const updater =
    options.firmwareUpdater ||
    (options.autoFirmwareUpdates
      ? new GithubFirmwareUpdater({
          root:
            options.firmwareCacheDir ||
            process.env.MINDFLAYER_FIRMWARE_CACHE_DIR ||
            path.join(
              options.dataDir || process.env.MINDFLAYER_DATA_DIR || "./data",
              "firmware-cache",
            ),
          intervalMs:
            options.firmwarePollIntervalMs ??
            (process.env.MINDFLAYER_FIRMWARE_POLL_SECONDS === undefined
              ? DEFAULT_INTERVAL_MS
              : Number(process.env.MINDFLAYER_FIRMWARE_POLL_SECONDS) * 1000),
          logger,
        })
      : null);
  const attempts = new Map();
  const now = options.now || Date.now;
  const get = (hardware, version) =>
    updater?.get(hardware, version) || firmware.get(hardware, version);

  function offer(ws, device, registration) {
    if (ws.readyState !== WebSocket.OPEN) return;
    const { hardware, firmware: current } = registration;
    if (!hardware || !semver.valid(current)) return;
    const pinned = Boolean(device.targetVersion);
    if (!pinned && device.autoUpdate === false) return;
    const release = pinned
      ? get(hardware, device.targetVersion)
      : updater?.latest(hardware);
    if (!release || semver.eq(release.version, current)) return;
    if (
      (!pinned || !device.allowDowngrade) &&
      semver.lte(release.version, current)
    )
      return;
    const previous = attempts.get(ws.authenticatedDeviceId);
    if (
      previous?.version === release.version &&
      now() - previous.at < RETRY_INTERVAL_MS
    )
      return;
    try {
      // Disk state can change after discovery. Never offer a corrupt cached image.
      if (release.automatic) updater.read(release);
      const token = tokens.issue(ws.authenticatedDeviceId, release);
      const url = `/firmware/${encodeURIComponent(release.hardware)}/${encodeURIComponent(release.version)}`;
      ws.send(
        encodeUpdateAvailable(release, url, token, ws.deviceProtocolVersion),
        { binary: true },
      );
      attempts.set(ws.authenticatedDeviceId, {
        version: release.version,
        at: now(),
      });
    } catch (error) {
      logger.warn(
        `Unable to offer firmware ${release.version}: ${error.message}`,
      );
    }
  }

  function attach(server, wss, store) {
    if (!updater) return;
    const offerConnected = () => {
      for (const ws of wss.clients) {
        if (!ws.deviceAuthenticated || !ws.hardware || !ws.firmwareVersion)
          continue;
        const device = store.get(ws.authenticatedDeviceId);
        if (device)
          offer(ws, device, {
            hardware: ws.hardware,
            firmware: ws.firmwareVersion,
          });
      }
    };
    updater.on("available", offerConnected);
    updater.on("checked", offerConnected);
    const start = () => updater.start();
    const stop = () => {
      server.removeListener("listening", start);
      updater.removeListener("available", offerConnected);
      updater.removeListener("checked", offerConnected);
      updater.stop();
      attempts.clear();
    };
    server.once("listening", start);
    server.once("close", stop);
    wss.once("close", stop);
  }
  return { updater, get, offer, attach };
}

module.exports = {
  createFirmwareRollout,
  autoUpdateEnabled,
  RETRY_INTERVAL_MS,
};
