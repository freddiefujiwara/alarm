import "./style.css";
import { CONFIG } from "./config.js";
import { decodeJwtPayload } from "./auth.js";
import { THEME_KEY, resolveTheme, nextTheme, applyTheme } from "./theme.js";
import { callApi } from "./api.js";
import {
  MAX_COMMANDS,
  buildSpeechCommand,
  buildYouTubeCommand,
  defaultSelectIndex,
  describeCommand,
  formatApiTime,
  fromWireCommand,
  speechTextWithTime,
  toApiTime,
  toWireCommand,
} from "./builder.js";

const $ = (id) => document.getElementById(id);
const gateEl = $("gate");
const listSectionEl = $("list-section");
const formSectionEl = $("form-section");
const accountEl = $("account");
const listEl = $("alarm-list");
const listStatusEl = $("list-status");
const logoutBtn = $("logout");
const themeBtn = $("theme-toggle");
const dateEl = $("date");
const timeEl = $("time");
const speechTextEl = $("speech-text");
const speechPanelEl = $("speech-panel");
const commandsPanelEl = $("commands-panel");
const speechDeviceEl = $("speech-device");
const speechCmdTextEl = $("speech-cmd-text");
const youtubeDeviceEl = $("youtube-device");
const youtubeUrlEl = $("youtube-url");
const deviceSelectEl = $("device-select");
const deviceActionsEl = $("device-actions");
const rawCommandEl = $("raw-command");
const cmdListEl = $("cmd-list");
const cmdCountEl = $("cmd-count");
const formStatusEl = $("form-status");
const statusEl = $("status");
const registerBtn = $("register");

const catalog = CONFIG.COMMANDS;
let idToken = null;
let commands = [];

let theme = resolveTheme(localStorage.getItem(THEME_KEY));
applyTheme(document.documentElement, themeBtn, theme);
themeBtn.addEventListener("click", () => {
  theme = nextTheme(theme);
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(document.documentElement, themeBtn, theme);
});

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = isError ? "error" : "";
}

function fillSelect(select, items, preferredId) {
  select.innerHTML = "";
  items.forEach((item, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = item.label;
    select.appendChild(opt);
  });
  if (preferredId && items.length) {
    select.value = String(defaultSelectIndex(items, preferredId));
  }
}

function renderDeviceActions() {
  const groups = [...catalog.devices, ...catalog.groups];
  const group = groups[Number(deviceSelectEl.value || 0)];
  deviceActionsEl.innerHTML = "";
  if (!group) return;
  (group.actions || []).forEach((action) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-toggle";
    btn.textContent = action.label;
    btn.addEventListener("click", () => addCommands(action.commands || []));
    deviceActionsEl.appendChild(btn);
  });
}

function renderCommands() {
  cmdCountEl.textContent = String(commands.length);
  cmdListEl.innerHTML = "";
  commands.forEach((cmd, i) => {
    const chip = document.createElement("div");
    chip.className = "cmd-chip";
    const label = document.createElement("span");
    label.textContent = describeCommand(cmd, catalog);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "theme-toggle";
    remove.textContent = "削除";
    remove.addEventListener("click", () => {
      commands.splice(i, 1);
      renderCommands();
    });
    chip.append(label, remove);
    cmdListEl.appendChild(chip);
  });
}

function addCommands(newCommands) {
  const merged = [...commands, ...newCommands];
  if (merged.length > MAX_COMMANDS) {
    formStatusEl.textContent = `コマンドは最大 ${MAX_COMMANDS} 個までです。`;
    return;
  }
  commands = merged;
  formStatusEl.textContent = "";
  renderCommands();
}

function currentMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function renderMode() {
  const mode = currentMode();
  speechPanelEl.hidden = mode !== "speech";
  commandsPanelEl.hidden = mode !== "commands";
}
document.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener("change", renderMode);
});

const builderPanels = {
  speech: $("builder-speech"),
  youtube: $("builder-youtube"),
  device: $("builder-device"),
  raw: $("builder-raw"),
};
function selectBuilderTab(name) {
  document.querySelectorAll("[data-builder-tab]").forEach((btn) => {
    const active = btn.dataset.builderTab === name;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  Object.entries(builderPanels).forEach(([key, panel]) => {
    panel.hidden = key !== name;
  });
}
document.querySelectorAll("[data-builder-tab]").forEach((btn) => {
  btn.addEventListener("click", () => selectBuilderTab(btn.dataset.builderTab));
});

$("add-speech").addEventListener("click", () => {
  const speaker = catalog.speech[Number(speechDeviceEl.value || 0)];
  const text = speechCmdTextEl.value.trim();
  if (!speaker) return;
  addCommands([buildSpeechCommand(speaker.prefix, speechTextWithTime(timeEl.value, text))]);
  speechCmdTextEl.value = "";
});

$("add-youtube").addEventListener("click", () => {
  const target = catalog.youtube[Number(youtubeDeviceEl.value || 0)];
  if (!target) return;
  const cmd = buildYouTubeCommand(target.prefix, youtubeUrlEl.value);
  if (!cmd) {
    formStatusEl.textContent = "YouTube URL から動画IDを取得できませんでした。";
    return;
  }
  addCommands([cmd]);
  youtubeUrlEl.value = "";
});

$("add-raw").addEventListener("click", () => {
  const value = fromWireCommand(rawCommandEl.value.trim());
  if (!value.startsWith("/")) {
    formStatusEl.textContent = "コマンドはスペース区切り（switchbot-command -d …）か / 形式で入力してください。";
    return;
  }
  addCommands([value]);
  rawCommandEl.value = "";
});

deviceSelectEl.addEventListener("change", renderDeviceActions);

async function loadList() {
  listStatusEl.textContent = "読み込み中…";
  try {
    const res = await callApi(CONFIG.GAS_ENDPOINT, idToken, { action: "list" });
    if (!res.ok) throw new Error(res.error || "unknown error");
    listEl.innerHTML = "";
    if (!res.alarms.length) {
      listStatusEl.textContent = "設定中のアラームはありません。";
      return;
    }
    listStatusEl.textContent = "";
    res.alarms.forEach((alarm) => {
      const row = document.createElement("div");
      row.className = "alarm-row";
      const left = document.createElement("div");
      const time = document.createElement("div");
      time.className = "alarm-time";
      time.textContent = formatApiTime(alarm.time);
      const cmds = document.createElement("div");
      cmds.className = "alarm-commands";
      cmds.textContent = alarm.commands
        .map((c) => describeCommand(fromWireCommand(c), catalog))
        .join(" / ");
      left.append(time, cmds);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "theme-toggle";
      del.textContent = "削除";
      del.addEventListener("click", async () => {
        del.disabled = true;
        try {
          const r = await callApi(CONFIG.GAS_ENDPOINT, idToken, {
            action: "delete",
            time: alarm.time,
          });
          if (!r.ok) throw new Error(r.error || "unknown error");
          await loadList();
        } catch (err) {
          listStatusEl.textContent = `削除に失敗しました: ${err.message}`;
          del.disabled = false;
        }
      });
      row.append(left, del);
      listEl.appendChild(row);
    });
  } catch (err) {
    listStatusEl.textContent = `取得に失敗しました: ${err.message}`;
  }
}

$("reload").addEventListener("click", loadList);

registerBtn.addEventListener("click", async () => {
  const apiTime = toApiTime(dateEl.value, timeEl.value);
  if (!apiTime) {
    setStatus("日付と時刻を入力してください。", true);
    return;
  }
  const mode = currentMode();
  const body = { action: "set", time: apiTime };
  if (mode === "speech") {
    body.text = speechTextEl.value.trim();
  } else {
    if (!commands.length) {
      setStatus("コマンドを1つ以上追加してください。", true);
      return;
    }
    body.commands = commands.map(toWireCommand);
  }
  registerBtn.disabled = true;
  setStatus("登録中…");
  try {
    const res = await callApi(CONFIG.GAS_ENDPOINT, idToken, body);
    if (!res.ok) throw new Error(res.error || "unknown error");
    setStatus(`${formatApiTime(res.time)} にアラームを登録しました。`);
    commands = [];
    renderCommands();
    await loadList();
  } catch (err) {
    setStatus(`登録に失敗しました: ${err.message}`, true);
  } finally {
    registerBtn.disabled = false;
  }
});

function initForm() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  dateEl.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  timeEl.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  fillSelect(speechDeviceEl, catalog.speech, "tatami");
  fillSelect(youtubeDeviceEl, catalog.youtube, "tatami");
  fillSelect(deviceSelectEl, [...catalog.devices, ...catalog.groups]);
  renderDeviceActions();
  renderCommands();
  renderMode();
}

function showMain(email) {
  gateEl.hidden = true;
  listSectionEl.hidden = false;
  formSectionEl.hidden = false;
  logoutBtn.hidden = false;
  accountEl.textContent = "ログイン中：" + email;
  initForm();
  loadList();
}

function showGate() {
  gateEl.hidden = false;
  listSectionEl.hidden = true;
  formSectionEl.hidden = true;
  logoutBtn.hidden = true;
}

function onCredential(response) {
  // No client-side authorization gate: alarm-gas verifies the token
  // and the account, and rejects unauthorized calls server-side.
  const payload = decodeJwtPayload(response.credential);
  idToken = response.credential;
  showMain(payload.email);
}

logoutBtn.addEventListener("click", () => {
  idToken = null;
  if (window.google) {
    google.accounts.id.disableAutoSelect();
  }
  showGate();
});

window.addEventListener("load", () => {
  google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: onCredential,
  });
  google.accounts.id.renderButton(document.getElementById("signin"), {
    theme: "outline",
    size: "large",
    text: "signin_with",
  });
});
