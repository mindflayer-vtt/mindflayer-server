const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function validateId(id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id))
    throw new Error("Invalid device ID");
}

class DeviceStore {
  constructor(file) {
    this.file = file;
    this.reload();
  }
  reload() {
    let fd;
    try {
      fd = fs.openSync(
        this.file,
        fs.constants.O_RDONLY |
          fs.constants.O_NOFOLLOW |
          fs.constants.O_NONBLOCK,
      );
    } catch (error) {
      if (error.code === "ENOENT") {
        this.devices = Object.create(null);
        return;
      }
      throw error;
    }
    let parsed;
    try {
      const info = fs.fstatSync(fd);
      if (!info.isFile() || info.size > 4 * 1024 * 1024)
        throw new Error("Invalid device credentials file");
      parsed = JSON.parse(fs.readFileSync(fd, "utf8"));
    } finally {
      fs.closeSync(fd);
    }
    if (
      !parsed ||
      parsed.version !== 1 ||
      !parsed.devices ||
      typeof parsed.devices !== "object" ||
      Array.isArray(parsed.devices)
    )
      throw new Error("Invalid device credentials file");
    for (const [id, device] of Object.entries(parsed.devices)) {
      validateId(id);
      if (
        !device ||
        typeof device.secret !== "string" ||
        !/^[0-9a-f]{64}$/i.test(device.secret)
      )
        throw new Error(`Invalid credential for ${id}`);
    }
    this.devices = Object.assign(Object.create(null), parsed.devices);
  }
  get(id) {
    return Object.hasOwn(this.devices, id) ? this.devices[id] : undefined;
  }
  provision(id) {
    validateId(id);
    return this.register(id, crypto.randomBytes(32).toString("hex"));
  }
  // Idempotent retry of a prepared installation, never credential replacement.
  register(id, secret) {
    validateId(id);
    if (typeof secret !== "string" || !/^[0-9a-f]{64}$/i.test(secret))
      throw new Error("Invalid device secret");
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const lock = `${this.file}.lock`;
    const lockFd = fs.openSync(lock, "wx", 0o600);
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(lockFd, String(process.pid) + "\n");
      this.reload();
      const existing = this.get(id);
      if (existing) {
        if (existing.secret.toLowerCase() !== secret.toLowerCase())
          throw new Error(
            `Device ${id} already exists with different credentials`,
          );
        return { id, ...existing };
      }
      const device = { secret: secret.toLowerCase() };
      const next = Object.assign(Object.create(null), this.devices, {
        [id]: device,
      });
      const fd = fs.openSync(temporary, "wx", 0o600);
      try {
        fs.writeFileSync(
          fd,
          JSON.stringify({ version: 1, devices: next }, null, 2) + "\n",
        );
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temporary, this.file);
      const directory = fs.openSync(
        path.dirname(this.file),
        fs.constants.O_RDONLY | fs.constants.O_DIRECTORY,
      );
      try {
        fs.fsyncSync(directory);
      } finally {
        fs.closeSync(directory);
      }
      this.devices = next;
      return { id, ...device };
    } finally {
      try {
        fs.unlinkSync(temporary);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      fs.closeSync(lockFd);
      fs.unlinkSync(lock);
    }
  }
}

module.exports = { DeviceStore, validateId };
