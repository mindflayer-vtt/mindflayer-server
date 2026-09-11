// Private preparation only: the host must persist the plan and register a new
// credential before serial delivery. Do not expose this object through an API.
const crypto = require("crypto");
const { classifyProvisioning } = require("./storage");
const { encodeEnvelope } = require("./format");

function prepareInstallation({
  sectorA,
  sectorB,
  devices,
  serverPublicKey,
  settings,
  adopt = false,
}) {
  if (typeof adopt !== "boolean")
    throw new Error("Adoption must be an explicit boolean");
  const existing = classifyProvisioning(
    sectorA,
    sectorB,
    devices,
    serverPublicKey,
  );
  if (existing.state === "invalid")
    throw new Error(
      "Provisioning records are damaged or unrecognized; recover the saved sectors before installation",
    );
  if (existing.ownership === "foreign" && !adopt)
    throw new Error(
      "This keypad belongs to another installation; explicit adoption is required",
    );
  const preserve = existing.ownership === "local";
  let deviceId = preserve
    ? existing.values.deviceId
    : "keypad-" + crypto.randomUUID().replaceAll("-", "");
  if (!preserve && Object.hasOwn(devices, deviceId))
    throw new Error(
      "Generated keypad identity already exists; retry preparation",
    );
  const deviceSecret = preserve
    ? Buffer.from(existing.values.deviceSecret)
    : crypto.randomBytes(32);
  const envelope = encodeEnvelope({
    deviceId,
    deviceSecret,
    serverPublicKey,
    ssid: settings.ssid,
    wifiPassword: settings.psk,
    serverHost: settings.serverHost,
    serverPort: settings.serverPort,
    serialDebug: preserve ? existing.values.serialDebug : false,
  });
  return {
    action: preserve
      ? "preserve"
      : existing.state === "blank"
        ? "initial"
        : "adopt",
    deviceId,
    newCredential: preserve
      ? null
      : { id: deviceId, secret: deviceSecret.toString("hex") },
    envelope,
    configurationDigest: crypto
      .createHash("sha256")
      .update(envelope)
      .digest("hex"),
  };
}

module.exports = { prepareInstallation };
