// alarm frontend configuration.
//
// GOOGLE_CLIENT_ID: OAuth 2.0 Web client ID used for Google Sign-In.
//   The same client as the health and tweet sites. It is not a secret.
//
// GAS_ENDPOINT and COMMANDS are NOT written in this repository. The
// endpoint is the /exec URL of the alarm-gas web app, and COMMANDS is
// the catalog of home command presets (device paths and LAN hosts).
// Both are provided at build time from GitHub Secrets through Vite
// environment variables:
//   VITE_GAS_ENDPOINT    the alarm-gas /exec URL
//   VITE_ALARM_COMMANDS  the command catalog as a JSON string
//   VITE_ALARM_EXEC_BASE the home server base URL used only to render
//     stored commands as copy-paste curl lines in the list view; when
//     it is not set, that display is hidden entirely.
// For local development, put the same variables in .env.local
// (git-ignored). Authorization itself is enforced server-side by
// alarm-gas, which verifies the ID token before every action.

function parseCatalog(raw) {
  const empty = { speech: [], youtube: [], devices: [], groups: [] };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw);
    return {
      speech: Array.isArray(parsed.speech) ? parsed.speech : [],
      youtube: Array.isArray(parsed.youtube) ? parsed.youtube : [],
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
    };
  } catch {
    return empty;
  }
}

export const CONFIG = {
  GOOGLE_CLIENT_ID:
    "728154182351-5ribj1diqcp8jpfo3rnqk9rei1aka98t.apps.googleusercontent.com",
  GAS_ENDPOINT: import.meta.env.VITE_GAS_ENDPOINT || "",
  COMMANDS: parseCatalog(import.meta.env.VITE_ALARM_COMMANDS),
  EXEC_BASE: import.meta.env.VITE_ALARM_EXEC_BASE || "",
};
