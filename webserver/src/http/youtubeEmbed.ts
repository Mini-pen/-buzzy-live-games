/** * Turns a pasted YouTube watch / short / youtu.be URL into an embed URL (https only). */
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
  const host = u.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") {
    id = u.pathname.replace(/^\//u, "").split("/")[0] ?? null;
  } else if (host.endsWith("youtube.com") || host === "m.youtube.com") {
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
  return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
}
