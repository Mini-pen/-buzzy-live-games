/** * Validates and extracts a canonical YouTube video id from URLs (watch / embed / short / nocookie embed). */
function extractYoutubeVideoId(u: URL): string | null {
  const host = u.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") {
    id = u.pathname.replace(/^\//u, "").split("/")[0] ?? null;
  } else if (
    host.endsWith("youtube.com") ||
    host === "m.youtube.com" ||
    host.endsWith("youtube-nocookie.com")
  ) {
    const v = u.searchParams.get("v");
    if (v !== null && v.length > 0) id = v;
    else if (u.pathname.startsWith("/embed/")) {
      id = u.pathname.slice("/embed/".length).split("/")[0] ?? null;
    } else if (u.pathname.startsWith("/shorts/")) {
      id = u.pathname.slice("/shorts/".length).split("/")[0] ?? null;
    }
  }
  if (id === null || id.length < 6 || id.length > 32) return null;
  if (!/^[a-zA-Z0-9_-]+$/u.test(id)) return null;
  return id;
}

/** * Builds iframe `src`: privacy-enhanced host + predictable query params YouTube honours in embed mode. */
function youtubeIframeSrcFromVideoId(id: string): string {
  const q = new URLSearchParams({
    modestbranding: "1",
    rel: "0",
    playsinline: "1",
  });
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${q.toString()}`;
}

/** * Turns a pasted YouTube watch / short / embed / youtu.be URL into a normalised nocookie iframe URL. */
export function youtubeWatchUrlToEmbedUrl(input: string): string | null {
  const raw = input.trim();
  if (raw === "") return null;
  let u: URL;
  try {
    u = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const id = extractYoutubeVideoId(u);
  if (id === null) return null;
  return youtubeIframeSrcFromVideoId(id);
}

/**
 * * Reads a stored embed pointer (`youtube-nocookie` or legacy `youtube.com/embed/…`) and emits the
 * * canonical nocookie iframe `src` saved for new manches (stable query params plus optional start/end).
 */
export function canonicalYoutubeEmbedIframeSrc(storedUrl: string): string | null {
  const raw = storedUrl.trim();
  if (raw === "") return null;
  let u: URL;
  try {
    u = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const id = extractYoutubeVideoId(u);
  if (id === null) return null;

  let out = youtubeIframeSrcFromVideoId(id);
  const start = u.searchParams.get("start");
  const end = u.searchParams.get("end");
  if (start !== null && start !== "") {
    const o = new URL(out);
    o.searchParams.set("start", start);
    out = o.toString();
  }
  if (end !== null && end !== "") {
    const o = new URL(out);
    o.searchParams.set("end", end);
    out = o.toString();
  }
  return out;
}
