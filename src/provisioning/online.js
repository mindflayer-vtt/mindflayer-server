const WebSocket = require("ws");

function waitForInstallation({
  url,
  id,
  firmware,
  digest,
  notBefore,
  timeout = 120000,
}) {
  if (
    typeof id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) ||
    typeof firmware !== "string" ||
    !/^[A-Za-z0-9.+_-]{1,47}$/.test(firmware) ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    !Number.isSafeInteger(notBefore) ||
    notBefore <= 0 ||
    !Number.isInteger(timeout) ||
    timeout < 1 ||
    timeout > 120000
  )
    return Promise.reject(
      new Error("Invalid installation verification request"),
    );
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { maxPayload: 65536 });
    let current = null,
      finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error("Timed out waiting for authenticated keypad configuration"),
        ),
      timeout,
    );
    socket.on("error", () =>
      finish(new Error("Installation verification connection unavailable")),
    );
    socket.on("close", () =>
      finish(new Error("Installation verification connection closed")),
    );
    socket.on("open", () =>
      socket.send(
        JSON.stringify({ type: "registration", receiver: true, players: [] }),
      ),
    );
    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (
        !message ||
        typeof message !== "object" ||
        message["controller-id"] !== id
      )
        return;
      if (message.type === "registration") {
        current =
          message.status === "connected" && message.deviceAuthenticated === true
            ? {
                id,
                connected: true,
                deviceAuthenticated: true,
                hardware: message.hardware,
                firmware: message.firmware,
                configurationDigest: message.configurationDigest,
                configurationVerifiedAt: message.configurationVerifiedAt,
              }
            : null;
      } else if (
        message.type === "configuration-state" &&
        current &&
        message.deviceAuthenticated === true
      ) {
        current.configurationDigest = message.configurationDigest;
        current.configurationVerifiedAt = message.configurationVerifiedAt;
      } else return;
      if (
        current &&
        current.hardware === "mindflayer-keypad-v1" &&
        current.firmware === firmware &&
        current.configurationDigest === digest &&
        Number.isSafeInteger(current.configurationVerifiedAt) &&
        current.configurationVerifiedAt >= notBefore &&
        current.configurationVerifiedAt <= Date.now() + 5000
      )
        finish(null, current);
    });
  });
}

module.exports = { waitForInstallation };
