const ALLOWED_OBJECT_KEY_PREFIXES = ["uploads/", "thumbnails/", "projects/"] as const;

export function isAllowedR2ObjectKey(objectKey: string): boolean {
  const normalized = objectKey.replace(/^\/+/, "").trim();
  if (!normalized || normalized.includes("..") || normalized.includes("\\")) {
    return false;
  }

  return ALLOWED_OBJECT_KEY_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
}

function addHostnameFromUrl(hosts: Set<string>, rawUrl: string | undefined): void {
  if (!rawUrl?.trim()) return;
  try {
    hosts.add(new URL(rawUrl.trim()).hostname.toLowerCase());
  } catch {
    // ignore malformed env URLs
  }
}

function getAllowedTranscribeHostnames(): Set<string> {
  const hosts = new Set<string>(["media.rendorax.com"]);

  addHostnameFromUrl(hosts, process.env.R2_PUBLIC_URL);
  addHostnameFromUrl(hosts, process.env.R2_PUBLIC_DOMAIN);
  addHostnameFromUrl(hosts, process.env.SUPABASE_URL);

  return hosts;
}

const ALLOWED_TRANSCRIBE_HOST_SUFFIXES = [".supabase.co", ".r2.cloudflarestorage.com"];

export function isAllowedTranscribeFileUrl(fileUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(fileUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  const allowedHosts = getAllowedTranscribeHostnames();

  if (allowedHosts.has(hostname)) {
    return true;
  }

  return ALLOWED_TRANSCRIBE_HOST_SUFFIXES.some((suffix) =>
    hostname.endsWith(suffix),
  );
}
