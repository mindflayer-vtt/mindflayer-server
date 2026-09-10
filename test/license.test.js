const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("project license text and root package metadata remain GPLv3", () => {
  const root = path.resolve(__dirname, "..");
  const license = fs.readFileSync(path.join(root, "LICENSE"));
  assert.equal(
    crypto.createHash("sha256").update(license).digest("hex"),
    "3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986",
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json")));
  const lock = JSON.parse(
    fs.readFileSync(path.join(root, "package-lock.json")),
  );
  assert.equal(manifest.license, "GPL-3.0-only");
  assert.equal(lock.license, "GPL-3.0-only");
  assert.equal(lock.packages[""].license, "GPL-3.0-only");
});
