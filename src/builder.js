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

// Volumes offered by the speech / YouTube volume pulldowns: 0-100 in
// steps of 10.
export const VOLUME_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

// The volume embedded in a catalog prefix (".../-v/60/..."), or null
// when the prefix carries no volume segment.
export function prefixVolume(prefix) {
  const m = /\/-v\/(\d+)(?=\/)/.exec(prefix || "");
  return m ? Number(m[1]) : null;
}

// The prefix with its -v segment replaced by the chosen volume.
// Prefixes without a volume segment, and volumes outside 0-100,
// pass through unchanged.
export function withVolume(prefix, volume) {
  const v = Number(volume);
  if (!Number.isInteger(v) || v < 0 || v > 100) return prefix;
  return String(prefix || "").replace(/\/-v\/\d+(?=\/)/, `/-v/${v}`);
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

// Commands are stored by the backend in a space-separated form that
// reads like a command line ("switchbot-command -d X -c turnOff");
// the page builds and describes them in path form
// ("/switchbot-command/-d/X/-c/turnOff"). These convert between the
// two. Speech text is URL-encoded inside the command, so it never
// contains a literal "/" or " " and the mapping is exact.
export function toWireCommand(command) {
  return command.replace(/^\//, "").split("/").join(" ");
}

// The reverse of toWireCommand. Path-form and full-URL inputs pass
// through unchanged, and anything whose first token is not an ASCII
// command name (for example Japanese speech text) is left as is.
export function fromWireCommand(command) {
  if (command.startsWith("/") || command.includes("://")) return command;
  const tokens = command.split(/ +/).filter((t) => t.length > 0);
  if (tokens.length >= 2 && /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(tokens[0])) {
    return `/${tokens.join("/")}`;
  }
  return command;
}

// One stored (wire-form) command as a copy-paste curl line that runs it
// directly against the home server, for pasting into a terminal on the
// server itself. `base` is the exec base URL injected at build time
// (see config.js EXEC_BASE); the path form is derived with
// fromWireCommand. Returns null when no line should be produced: no
// base configured, or the input is one fromWireCommand would pass
// through unchanged (already path form, a full URL, or free text whose
// first token is not an ASCII command name) — those were never stored
// in wire form, so a curl line for them would be a guess.
export function toExecCurl(wire, base) {
  if (!base || typeof wire !== "string") return null;
  if (wire.startsWith("/") || wire.includes("://")) return null;
  const tokens = wire.split(/ +/).filter((t) => t.length > 0);
  if (tokens.length < 2 || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(tokens[0])) {
    return null;
  }
  const origin = String(base).replace(/\/+$/, "");
  return `curl -s "${origin}${fromWireCommand(wire)}"`;
}

// The curl lines for a whole command list, one line per command, so a
// multi-command alarm can be pasted and run in order. Commands that do
// not convert are skipped; the result is "" when nothing converts.
export function toExecCurlBlock(wires, base) {
  return (wires || [])
    .map((wire) => toExecCurl(wire, base))
    .filter((line) => line !== null)
    .join("\n");
}

// What a text-less alarm says after the time: a nudge to get moving.
// Mirrors EMPTY_TEXT_SUFFIX_ in the alarm backend.
export const EMPTY_TEXT_SUFFIX = "時間ですよ。時間ですよ。そろそろ時間ですよ。";

// Prefix a spoken text with the alarm time, in the same wording the
// alarm backend uses for text alarms: 12-hour clock, "ちょうど" on
// the hour — for example "7時30分です。" or "1時ちょうどです。".
// An empty text gets the nudge suffix instead. Without a valid time
// value the text (or suffix) is returned unchanged.
export function speechTextWithTime(timeValue, text) {
  const match = /^(\d{1,2}):(\d{2})/.exec(timeValue || "");
  const body = text ? text : EMPTY_TEXT_SUFFIX;
  if (!match) return body;
  const hour = Number(match[1]) % 12 || 12;
  const minute = Number(match[2]);
  return `${hour}時${minute ? `${minute}分` : "ちょうど"}です。${body}`;
}

// Index of the catalog entry to preselect in a dropdown: the entry
// whose id matches preferredId, or the first entry when there is no
// match. The alarm page defaults sound output to the Tatami speaker
// because the Nest speaker is in the family space.
export function defaultSelectIndex(items, preferredId) {
  const index = (items || []).findIndex((item) => item && item.id === preferredId);
  return index >= 0 ? index : 0;
}

// Match a command against a catalog prefix whose -v/<n> segment may
// hold any volume (the builder lets the user override the catalog
// default). Returns { rest, volume } or null; volume is null when the
// prefix carries no volume segment.
function matchPrefix(command, prefix) {
  const at = (prefix || "").indexOf("/-v/");
  if (at < 0) {
    return command.startsWith(prefix)
      ? { rest: command.slice(prefix.length), volume: null }
      : null;
  }
  const head = prefix.slice(0, at + 4);
  const digits = /^\d+/.exec(prefix.slice(at + 4));
  const tail = prefix.slice(at + 4 + (digits ? digits[0].length : 0));
  if (!command.startsWith(head)) return null;
  const own = /^\d+/.exec(command.slice(head.length));
  if (!own) return null;
  const after = command.slice(head.length + own[0].length);
  if (!after.startsWith(tail)) return null;
  return { rest: after.slice(tail.length), volume: Number(own[0]) };
}

// A short human label for one stored command, used in the alarm list
// and in the builder's command chips:
// - speech commands  -> 発話（speaker・音量n）: text
// - YouTube commands -> YouTube（device・音量n）: video id
// - a command that appears in exactly one catalog action -> its label
// - anything else    -> the raw path
export function describeCommand(command, catalog) {
  const cat = catalog || {};
  for (const speaker of cat.speech || []) {
    const m = matchPrefix(command, speaker.prefix);
    if (m) {
      const who = m.volume === null ? speaker.label : `${speaker.label}・音量${m.volume}`;
      return `発話（${who}）: ${safeDecode(m.rest)}`;
    }
  }
  for (const target of cat.youtube || []) {
    const m = matchPrefix(command, target.prefix);
    if (m) {
      const who = m.volume === null ? target.label : `${target.label}・音量${m.volume}`;
      return `YouTube（${who}）: ${m.rest}`;
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

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// Active weekdays -> a short Japanese description: every day, the
// weekday set, the weekend set, or the joined day labels.
export function describeWeekdays(weekdays) {
  const days = [...weekdays].sort((a, b) => a - b);
  if (days.length === 7) return "毎日";
  if (days.join(",") === "1,2,3,4,5") return "平日のみ";
  if (days.join(",") === "0,6") return "土日のみ";
  return days.map((d) => WEEKDAY_LABELS[d]).join("・");
}

// "20261231" -> "2026/12/31". Anything else is returned unchanged.
export function formatUntilDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value || "");
  return m ? `${m[1]}/${m[2]}/${m[3]}` : value;
}

// "2026-12-31" (a date input value) -> "20261231" (the alarm-gas
// format). Returns null for empty or malformed values.
export function toApiDate(dateValue) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue || "");
  return d ? `${d[1]}${d[2]}${d[3]}` : null;
}
