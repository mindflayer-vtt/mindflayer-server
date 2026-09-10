const { requireValid } = require("./verify");
const HOSTS = new Set([
  "api.github.com",
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
]);

function trustedUrl(value) {
  const url = new URL(value);
  requireValid(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      HOSTS.has(url.hostname),
    "Untrusted firmware download URL",
  );
  return url;
}

async function download(
  url,
  { maximum, signal, timeoutMs = 30000, fetchImpl = fetch } = {},
) {
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  for (let redirects = 0; redirects <= 3; redirects++) {
    url = trustedUrl(url);
    const response = await fetchImpl(url, {
      redirect: "manual",
      signal: combined,
      headers: {
        Accept: "application/vnd.github+json",
        "Accept-Encoding": "identity",
        "User-Agent": "mindflayer-server-firmware-updater",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      requireValid(
        redirects < 3 && response.headers.get("location"),
        "Too many or invalid firmware redirects",
      );
      url = new URL(response.headers.get("location"), url);
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      const error = new Error("Firmware download HTTP " + response.status);
      if ([403, 429].includes(response.status)) {
        const after = Number(response.headers.get("retry-after")) * 1000;
        const reset =
          Number(response.headers.get("x-ratelimit-reset")) * 1000 - Date.now();
        error.retryAfterMs = Math.min(
          86400000,
          Math.max(
            60000,
            Number.isFinite(after) ? after : 0,
            Number.isFinite(reset) ? reset : 0,
          ),
        );
      }
      throw error;
    }
    try {
      const length = response.headers.get("content-length");
      requireValid(
        length === null || (/^\d+$/.test(length) && Number(length) <= maximum),
        "Firmware response exceeds size limit",
      );
      requireValid(response.body, "Empty firmware response");
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        combined.throwIfAborted();
        size += chunk.length;
        requireValid(size <= maximum, "Firmware response exceeds size limit");
        chunks.push(Buffer.from(chunk));
      }
      requireValid(
        size > 0 && (length === null || Number(length) === size),
        "Truncated firmware response",
      );
      return Buffer.concat(chunks, size);
    } catch (error) {
      try {
        await response.body?.cancel();
      } catch {}
      throw error;
    }
  }
}

module.exports = { download, trustedUrl };
