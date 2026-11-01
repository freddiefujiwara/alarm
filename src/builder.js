// Pure helpers for building alarm commands and describing them.
// The command catalog itself (device paths, speaker hosts) is injected
// at build time; see config.js. Nothing private is written here.

export const MAX_COMMANDS = 10;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);

// Extract a video ID from a YouTube URL (watch, youtu.be, shorts,
// live), following the same rules as the ha.ze.gs page. Returns null
// when the URL does not carry one.
export function parseYouTubeId(youtubeUrl) {
  if (!youtubeUrl) return null;
  try {
    const parsed = new URL(youtubeUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.split("/")[1] || null;
    }
    if (!YOUTUBE_HOSTS.has(parsed.hostname)) return null;
    if (parsed.pathname === "/watch") {
      return parsed.searchParams.get("v") || null;
    }
    if (parsed.pathname.startsWith("/live/") || parsed.pathname.startsWith("/shorts/")) {
      return parsed.pathname.split("/")[2] || null;
    }
    return null;
  } catch {
    return null;
  }
}

// Speech text is sent to the speaker wrapper URL-encoded, with runs of
// whitespace folded into a full-width space (the ha.ze.gs convention).
export function buildSpeechCommand(prefix, text) {
  const normalized = String(text ?? "").replace(/\s+/g, "　").trim();
  return prefix + encodeURIComponent(normalized);
}

// prefix is a ".../-i/" play prefix from the catalog.
export function buildYouTubeCommand(prefix, youtubeUrl) {
  const id = parseYouTubeId(youtubeUrl);
  return id ? prefix + id : null;
}

// "2026-11-02" + "06:52" -> "20261102-06:52" (the alarm-gas format).
// Returns null for values a date/time input would never produce.
export function toApiTime(dateValue, timeValue) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue || "");
  const t = /^(\d{2}):(\d{2})$/.exec(timeValue || "");
  if (!d || !t) return null;
  return `${d[1]}${d[2]}${d[3]}-${t[1]}:${t[2]}`;
}

// "20261102-06:52" -> "11/2 06:52" for display.
export function formatApiTime(apiTime) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2}):(\d{2})$/.exec(apiTime || "");
  if (!m) return apiTime || "";
  return `${Number(m[2])}/${Number(m[3])} ${m[4]}:${m[5]}`;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Index of the catalog entry to preselect in a dropdown: the entry
// whose id matches preferredId, or the first entry when there is no
// match. The alarm page defaults sound output to the Tatami speaker
// because the Nest speaker is in the family space.
export function defaultSelectIndex(items, preferredId) {
  const index = (items || []).findIndex((item) => item && item.id === preferredId);
  return index >= 0 ? index : 0;
}

// A short human label for one stored command, used in the alarm list
// and in the builder's command chips:
// - speech commands  -> 発話（speaker）: text
// - YouTube commands -> YouTube（device）: video id
// - a command that appears in exactly one catalog action -> its label
// - anything else    -> the raw path
export function describeCommand(command, catalog) {
  const cat = catalog || {};
  for (const speaker of cat.speech || []) {
    if (command.startsWith(speaker.prefix)) {
      return `発話（${speaker.label}）: ${safeDecode(command.slice(speaker.prefix.length))}`;
    }
  }
  for (const target of cat.youtube || []) {
    if (command.startsWith(target.prefix)) {
      return `YouTube（${target.label}）: ${command.slice(target.prefix.length)}`;
    }
  }
  const matches = [];
  for (const group of [...(cat.devices || []), ...(cat.groups || [])]) {
    for (const action of group.actions || []) {
      if ((action.commands || []).includes(command)) {
        matches.push(`${group.label} ${action.label}`);
      }
    }
  }
  if (matches.length === 1) return matches[0];
  return command;
}
