# alarm

Frontend for setting alarms via alarm-gas (Google Sign-In restricted
to the owner), in the same style as the health and tweet sites.
Published at https://freddiefujiwara.com/alarm/ from GitHub Pages.

## What it does

- Lists the alarms currently registered in alarm-gas, with a delete
  button per alarm.
- Registers a new alarm in two modes:
  - Speech: an optional text. alarm-gas announces the time, followed
    by the text (an empty text announces the time only).
  - Commands: up to 10 home commands, assembled with builders that
    follow the ha.ze.gs page — speech (speaker + text), YouTube
    (device + URL), device preset buttons (including composite ones
    such as the fan's S/M/L), grouped presets, and raw command paths.

## Configuration lives in GitHub Secrets, not in this repository

The GAS endpoint and the command catalog contain private home
details (device paths, LAN hosts), so they are injected at build
time from repository secrets and never committed:

- `GAS_ENDPOINT`: the alarm-gas `/exec` URL, passed to the build as
  the Vite env var `VITE_GAS_ENDPOINT`.
- `ALARM_COMMANDS`: the command catalog JSON, passed as
  `VITE_ALARM_COMMANDS`.

Catalog shape (values below are dummies):

```json
{
  "speech":  [{ "id": "nest", "label": "Nest", "prefix": "/speak/-h/192.0.2.1/-v/60/-s/" }],
  "youtube": [{ "id": "tatami", "label": "Tatami", "prefix": "/youtube-play/-h/192.0.2.2/-v/10/-i/" }],
  "devices": [
    { "id": "fan", "label": "Fan", "actions": [
      { "label": "S", "commands": ["/fan/turnOn", "/fan/setWindSpeed/-p/11"] },
      { "label": "Off", "commands": ["/fan/turnOff"] }
    ] }
  ],
  "groups": [
    { "id": "all-off", "label": "All off", "actions": [
      { "label": "All off", "commands": ["/hue/lights/off"] }
    ] }
  ]
}
```

For local development, copy the same values into `.env.local`
(git-ignored) and run `npm run dev`.

## Development

```bash
npm install
npm test
npm run build
```
