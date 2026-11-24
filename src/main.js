import "./style.css";
import { CONFIG } from "./config.js";
import { decodeJwtPayload } from "./auth.js";
import { THEME_KEY, resolveTheme, nextTheme, applyTheme } from "./theme.js";
import { callApi } from "./api.js";
import {
  buildShareUrl,
  formatShareExpiry,
  formatShareRemaining,
  parseShareToken,
  shareSecondsLeft,
} from "./share.js";
import {
  MAX_COMMANDS,
  VOLUME_STEPS,
  WEEKDAY_LABELS,
  buildSpeechCommand,
  buildYouTubeCommand,
  defaultSelectIndex,
  describeCommand,
  describeExceptions,
  describeWeekdays,
  formatApiTime,
  formatUntilDate,
  apiDateToInput,
  fromWireCommand,
  prefixVolume,
  speechTextWithTime,
  toApiDate,
  toApiTime,
  toExecCurlBlock,
  toWireCommand,
  withVolume,
} from "./builder.js";
import { isStagingBuild, showStagingBanner } from "./staging-banner.js";
import {
  loadSavedSessionToken,
  loadSavedSessionEmail,
  saveSessionToken,
  saveSessionEmail,
  clearSavedSession,
} from "./session.js";

if (isStagingBuild()) {
  showStagingBanner();
}

const $ = (id) => document.getElementById(id);
const loadingEl = $("boot-loading");
const gateEl = $("gate");
const gateErrorEl = $("gate-error");
const mainTabsEl = $("main-tabs");
const listSectionEl = $("list-section");
const formSectionEl = $("form-section");
const accountEl = $("account");
const listEl = $("alarm-list");
const listStatusEl = $("list-status");
const logoutBtn = $("logout");
const themeBtn = $("theme-toggle");
const dateEl = $("date");
const dateLabelEl = $("date-label");
const timeEl = $("time");
const repeatPanelEl = $("repeat-panel");
const weekdayChipsEl = $("weekday-chips");
const untilEl = $("until");
const exceptionDateEl = $("exception-date");
const exceptionAddEl = $("exception-add");
const exceptionChipsEl = $("exception-chips");
const ruleListEl = $("rule-list");
const ruleStatusEl = $("rule-status");
const speechTextEl = $("speech-text");
const speechPanelEl = $("speech-panel");
const commandsPanelEl = $("commands-panel");
const speechDevicesEl = $("speech-devices");
const speechModeDevicesEl = $("speech-mode-devices");
const speechVolumeEl = $("speech-volume");
const speechCmdTextEl = $("speech-cmd-text");
const youtubeDeviceEl = $("youtube-device");
const youtubeVolumeEl = $("youtube-volume");
const youtubeUrlEl = $("youtube-url");
const deviceSelectEl = $("device-select");
const deviceActionsEl = $("device-actions");
const rawCommandEl = $("raw-command");
const cmdListEl = $("cmd-list");
const cmdCountEl = $("cmd-count");
const formStatusEl = $("form-status");
const statusEl = $("status");
const registerBtn = $("register");
const cancelEditBtn = $("cancel-edit");
const shareBannerEl = $("share-banner");
const shareExpiredEl = $("share-expired");
const shareSectionEl = $("share-section");
const shareCardErrorEl = $("share-card-error");
const shareIssueViewEl = $("share-issue-view");
const shareIssuedViewEl = $("share-issued-view");
const shareUrlEl = $("share-url");
const shareRemainingEl = $("share-remaining");
const shareExpiresEl = $("share-expires");
const shareCopyBtn = $("share-copy");

const catalog = CONFIG.COMMANDS;
let sessionToken = null;
let commands = [];
// Temporary access link state. shareToken is set when the page is
// opened via a #share= link (share mode); issuedShare holds the link
// the owner just issued (kept in memory only, like the health site).
let shareToken = null;
let issuedShare = null;
let shareTimer = null;

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

// One admin API call, authenticated with the share token in share
// mode and with the owner session token otherwise.
function api(body) {
  if (shareToken) {
    return callApi(CONFIG.GAS_ENDPOINT, null, { ...body, share_token: shareToken });
  }
  return callApi(CONFIG.GAS_ENDPOINT, null, { ...body, session_token: sessionToken });
}

function isShareAuthError(res) {
  return Boolean(
    shareToken && res && typeof res.error === "string" && res.error.includes("share session"),
  );
}

function isSessionAuthError(res) {
  return Boolean(sessionToken && res && res.error === "session expired or invalid");
}

// Shown on the gate when a saved owner session turned out to be
// dead and the visitor is asked to sign in again.
const SESSION_EXPIRED_TEXT =
  "ログインの有効期限が切れました。再度ログインしてください。";

// The saved owner session turned out to be dead (expired or
// revoked): drop it and return to the sign-in gate.
function expireSession() {
  sessionToken = null;
  clearSavedSession();
  gateErrorEl.textContent = SESSION_EXPIRED_TEXT;
  showGate();
  initGoogleSignIn();
}

// The GIS client script arrives async; poll for it briefly. If
// it never shows up — an ad blocker can swallow it — the gate
// says so after a few seconds instead of leaving the sign-in
// area silently empty forever.
const SIGNIN_SCRIPT_ERROR_TEXT =
  "Googleログインスクリプトの読み込みに失敗しました。広告ブロック等を解除して再読み込みしてください。";
let signInScriptWaitMs = 0;

function initGoogleSignIn() {
  if (!window.google || !window.google.accounts) {
    if (signInScriptWaitMs >= 3000) {
      gateErrorEl.textContent = SIGNIN_SCRIPT_ERROR_TEXT;
      return;
    }
    signInScriptWaitMs += 300;
    setTimeout(initGoogleSignIn, 300);
    return;
  }
  signInScriptWaitMs = 0;
  if (gateErrorEl.textContent === SIGNIN_SCRIPT_ERROR_TEXT) {
    gateErrorEl.textContent = "";
  }
  window.google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: onCredential,
  });
  window.google.accounts.id.renderButton(document.getElementById("signin"), {
    theme: "outline",
    size: "large",
    text: "signin_with",
    shape: "pill",
  });
}

// --- Main tabs （一覧 / 登録 / 共有） ---
// The page used to stack every section vertically and got very
// long. The tab bar switches between the list, the form, and the
// share card; the share tab exists only for the owner (a share
// session never sees it).
let mainTab = "list";
let shareTabAvailable = false;

function applyMainTab() {
  document.querySelectorAll("[data-main-tab]").forEach((btn) => {
    const active = btn.dataset.mainTab === mainTab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
    if (btn.dataset.mainTab === "share") {
      btn.hidden = !shareTabAvailable;
    }
  });
  listSectionEl.hidden = mainTab !== "list";
  formSectionEl.hidden = mainTab !== "form";
  shareSectionEl.hidden = mainTab !== "share" || !shareTabAvailable;
}

function selectMainTab(name) {
  mainTab = name;
  applyMainTab();
}

document.querySelectorAll("[data-main-tab]").forEach((btn) => {
  btn.addEventListener("click", () => selectMainTab(btn.dataset.mainTab));
});

function showShareExpired() {
  loadingEl.hidden = true;
  gateEl.hidden = true;
  mainTabsEl.hidden = true;
  listSectionEl.hidden = true;
  formSectionEl.hidden = true;
  shareSectionEl.hidden = true;
  logoutBtn.hidden = true;
  shareExpiredEl.hidden = false;
}

function updateShareBanner(res) {
  if (!shareToken || !res || !res._share) return;
  shareBannerEl.textContent = `一時リンクで表示中です（${formatShareExpiry(res._share.expires_at)} まで有効）`;
  shareBannerEl.hidden = false;
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

function currentKind() {
  return document.querySelector('input[name="kind"]:checked').value;
}

// Weekdays the rule fires on; all seven by default. The chips toggle
// days off (for example both weekend days for a weekday-only rule).
let activeWeekdays = new Set([0, 1, 2, 3, 4, 5, 6]);

function renderWeekdayChips() {
  weekdayChipsEl.innerHTML = "";
  WEEKDAY_LABELS.forEach((label, day) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "builder-tab" + (activeWeekdays.has(day) ? " active" : "");
    chip.textContent = label;
    chip.setAttribute("aria-pressed", String(activeWeekdays.has(day)));
    chip.addEventListener("click", () => {
      if (activeWeekdays.has(day)) {
        if (activeWeekdays.size === 1) {
          formStatusEl.textContent = "曜日は最低1つ必要です。";
          return;
        }
        activeWeekdays.delete(day);
      } else {
        activeWeekdays.add(day);
      }
      formStatusEl.textContent = "";
      renderWeekdayChips();
    });
    weekdayChipsEl.appendChild(chip);
  });
}

function renderKind() {
  const repeat = currentKind() === "repeat";
  repeatPanelEl.hidden = !repeat;
  dateLabelEl.hidden = repeat;
}

// Exception dates for the rule being composed ("YYYYMMDD" keys).
// The rule does not fire on these dates even when the weekday
// matches. Chips show the dates; tapping one removes it.
let formExceptions = [];

function renderFormExceptions() {
  exceptionChipsEl.innerHTML = "";
  [...formExceptions].sort().forEach((key) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "builder-tab active";
    chip.textContent = `${formatUntilDate(key)} ×`;
    chip.addEventListener("click", () => {
      formExceptions = formExceptions.filter((d) => d !== key);
      renderFormExceptions();
    });
    exceptionChipsEl.appendChild(chip);
  });
}

exceptionAddEl.addEventListener("click", () => {
  const key = toApiDate(exceptionDateEl.value);
  if (!key) {
    formStatusEl.textContent = "除外日の形式が不正です。";
    return;
  }
  if (!formExceptions.includes(key)) {
    formExceptions.push(key);
  }
  formStatusEl.textContent = "";
  exceptionDateEl.value = "";
  renderFormExceptions();
});
document.querySelectorAll('input[name="kind"]').forEach((radio) => {
  radio.addEventListener("change", renderKind);
});

// A list row's commands as curl lines that can be pasted into a
// terminal on the home server. The row's top-right action cluster gets
// two icon buttons: one toggles the code block under the row's label,
// the other copies every line without opening the block. Rendered only
// when an exec base is configured (CONFIG.EXEC_BASE) and at least one
// command converts.
const iconSvg_ = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const CODE_ICON = iconSvg_(
  '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
);
const COPY_ICON = iconSvg_(
  '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
);
const CHECK_ICON = iconSvg_('<polyline points="20 6 9 17 4 12"/>');

function iconButton(svg, label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn";
  btn.innerHTML = svg;
  btn.title = label;
  btn.setAttribute("aria-label", label);
  return btn;
}

function appendExecCurl(container, actions, wires) {
  const text = toExecCurlBlock(wires, CONFIG.EXEC_BASE);
  if (!text) return;
  const block = document.createElement("div");
  block.className = "exec-block";
  block.hidden = true;
  const pre = document.createElement("pre");
  pre.className = "exec-pre";
  pre.textContent = text;
  block.appendChild(pre);
  container.appendChild(block);
  const toggle = iconButton(CODE_ICON, "curlを表示");
  toggle.setAttribute("aria-expanded", "false");
  toggle.addEventListener("click", () => {
    block.hidden = !block.hidden;
    toggle.classList.toggle("active", !block.hidden);
    toggle.title = block.hidden ? "curlを表示" : "curlを隠す";
    toggle.setAttribute("aria-label", toggle.title);
    toggle.setAttribute("aria-expanded", String(!block.hidden));
  });
  const copy = iconButton(COPY_ICON, "curlをコピー");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.innerHTML = CHECK_ICON;
      copy.classList.add("active");
      setTimeout(() => {
        copy.innerHTML = COPY_ICON;
        copy.classList.remove("active");
      }, 1600);
    } catch {
      // Clipboard unavailable: open the block and select it instead.
      if (block.hidden) toggle.click();
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });
  actions.append(toggle, copy);
}

// The per-rule exception-date editor shown under a rule row: the
// current dates as removable chips, a date input to add more, and a
// save button that replaces the rule's dates in place
// (set_rule_exceptions) so the rule itself is not recreated.
function buildExceptionEditor(rule) {
  const editor = document.createElement("div");
  editor.className = "exception-editor";
  editor.hidden = true;
  let editing = (Array.isArray(rule.exceptions) ? rule.exceptions : []).filter(
    (d) => typeof d === "string" && /^\d{8}$/.test(d),
  );
  const chips = document.createElement("span");
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "theme-toggle";
  addBtn.textContent = "追加";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "theme-toggle";
  saveBtn.textContent = "保存";
  const status = document.createElement("p");
  status.className = "meta";
  const renderChips = () => {
    chips.innerHTML = "";
    [...editing].sort().forEach((key) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "builder-tab active";
      chip.textContent = `${formatUntilDate(key)} ×`;
      chip.addEventListener("click", () => {
        editing = editing.filter((d) => d !== key);
        renderChips();
      });
      chips.appendChild(chip);
    });
  };
  addBtn.addEventListener("click", () => {
    const key = toApiDate(dateInput.value);
    if (!key) {
      status.textContent = "除外日の形式が不正です。";
      return;
    }
    if (!editing.includes(key)) editing.push(key);
    status.textContent = "";
    dateInput.value = "";
    renderChips();
  });
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    try {
      const r = await api({
        action: "set_rule_exceptions",
        id: rule.id,
        exceptions: [...editing].sort(),
      });
      if (isShareAuthError(r)) {
        showShareExpired();
        return;
      }
      if (isSessionAuthError(r)) {
        expireSession();
        return;
      }
      if (!r.ok) throw new Error(r.error || "unknown error");
      await loadRules();
    } catch (err) {
      status.textContent = `保存に失敗しました: ${err.message}`;
      saveBtn.disabled = false;
    }
  });
  const editRow = document.createElement("div");
  editRow.className = "field-row";
  const label = document.createElement("span");
  label.textContent = "除外日";
  editRow.append(label, dateInput, addBtn, chips);
  const saveRow = document.createElement("div");
  saveRow.className = "field-row";
  saveRow.append(saveBtn);
  editor.append(editRow, saveRow, status);
  renderChips();
  return editor;
}

async function loadRules() {
  ruleStatusEl.textContent = "読み込み中…";
  try {
    const res = await api({ action: "list_rules" });
    if (isShareAuthError(res)) {
      showShareExpired();
      return;
    }
    if (isSessionAuthError(res)) {
      expireSession();
      return;
    }
    if (!res.ok) throw new Error(res.error || "unknown error");
    updateShareBanner(res);
    ruleListEl.innerHTML = "";
    // A deformed payload degrades entry by entry instead of
    // failing the whole list: non-array lists read as empty,
    // non-object entries are skipped, non-array commands as none.
    const rules = Array.isArray(res.rules) ? res.rules : [];
    if (!rules.length) {
      ruleStatusEl.textContent = "設定中の繰り返しはありません。";
      return;
    }
    ruleStatusEl.textContent = "";
    rules.forEach((rule) => {
      if (!rule || typeof rule !== "object") return;
      const commands = Array.isArray(rule.commands) ? rule.commands : [];
      const row = document.createElement("div");
      row.className = "alarm-row";
      const left = document.createElement("div");
      const time = document.createElement("div");
      time.className = "alarm-time";
      time.textContent = `${describeWeekdays(rule.weekdays)} ${rule.time}`;
      const cmds = document.createElement("div");
      cmds.className = "alarm-commands";
      const parts = commands
        .map((c) => describeCommand(fromWireCommand(c), catalog))
        .join(" / ");
      const suffixes = [];
      if (rule.until) suffixes.push(`${formatUntilDate(rule.until)}まで`);
      const exceptionsText = describeExceptions(rule.exceptions);
      if (exceptionsText) suffixes.push(exceptionsText);
      cmds.textContent = suffixes.length ? `${parts}（${suffixes.join("、")}）` : parts;
      left.append(time, cmds);
      const actions = document.createElement("div");
      actions.className = "row-actions";
      appendExecCurl(left, actions, commands);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "theme-toggle";
      del.textContent = "削除";
      del.addEventListener("click", async () => {
        del.disabled = true;
        try {
          const r = await api({ action: "delete_rule", id: rule.id });
          if (isShareAuthError(r)) {
            showShareExpired();
            return;
          }
          if (isSessionAuthError(r)) {
            expireSession();
            return;
          }
          if (!r.ok) throw new Error(r.error || "unknown error");
          await loadRules();
        } catch (err) {
          ruleStatusEl.textContent = `削除に失敗しました: ${err.message}`;
          del.disabled = false;
        }
      });
      actions.appendChild(del);
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "theme-toggle";
      editBtn.textContent = "編集";
      editBtn.addEventListener("click", () => startEditRule(rule));
      actions.appendChild(editBtn);
      const editor = buildExceptionEditor(rule);
      const excBtn = document.createElement("button");
      excBtn.type = "button";
      excBtn.className = "theme-toggle";
      excBtn.textContent = "除外日";
      excBtn.addEventListener("click", () => {
        editor.hidden = !editor.hidden;
      });
      actions.appendChild(excBtn);
      left.appendChild(editor);
      row.append(left, actions);
      ruleListEl.appendChild(row);
    });
  } catch (err) {
    ruleStatusEl.textContent = `取得に失敗しました: ${err.message}`;
  }
}

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

// Volume pulldowns (0-100 in steps of 10). The pulldown starts at
// the volume embedded in the selected catalog prefix and follows the
// speaker / target selection; the user can override it per command.
function fillVolumeSelect(el) {
  el.innerHTML = "";
  for (const v of VOLUME_STEPS) {
    const opt = document.createElement("option");
    opt.value = String(v);
    opt.textContent = `音量${v}`;
    el.appendChild(opt);
  }
}

function syncVolume(deviceEl, volumeEl, items) {
  const item = items[Number(deviceEl.value || 0)];
  const v = item ? prefixVolume(item.prefix) : null;
  if (v !== null) volumeEl.value = String(v);
}

youtubeDeviceEl.addEventListener("change", () =>
  syncVolume(youtubeDeviceEl, youtubeVolumeEl, catalog.youtube),
);

// Speech speakers are toggle chips (the same pattern as the weekday
// chips), shared by the simple speech panel and the builder's speech
// tab: one speech command is built per selected speaker, so the same
// text can go to Tatami and Nest together. At least one speaker stays
// selected. onSelect fires when a speaker is added (the builder uses
// it to adopt that speaker's default volume).
function renderSpeakerChips(container, active, onSelect) {
  container.innerHTML = "";
  catalog.speech.forEach((speaker, i) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "builder-tab" + (active.has(i) ? " active" : "");
    chip.textContent = speaker.label;
    chip.setAttribute("aria-pressed", String(active.has(i)));
    chip.addEventListener("click", () => {
      if (active.has(i)) {
        if (active.size === 1) {
          formStatusEl.textContent = "スピーカーは最低1つ必要です。";
          return;
        }
        active.delete(i);
      } else {
        active.add(i);
        if (onSelect) onSelect(speaker);
      }
      formStatusEl.textContent = "";
      renderSpeakerChips(container, active, onSelect);
    });
    container.appendChild(chip);
  });
}

// One speech command per selected speaker, in catalog order. With a
// volume the catalog prefix's volume is overridden; without one each
// speaker keeps its catalog default.
function speakerCommands(active, spoken, volume) {
  return [...active]
    .sort((a, b) => a - b)
    .filter((i) => catalog.speech[i])
    .map((i) => {
      const prefix = catalog.speech[i].prefix;
      return buildSpeechCommand(volume === null ? prefix : withVolume(prefix, volume), spoken);
    });
}

let activeSpeakers = new Set();
let simpleSpeakers = new Set();

function renderSpeechSpeakers() {
  renderSpeakerChips(speechDevicesEl, activeSpeakers, (speaker) => {
    const v = prefixVolume(speaker.prefix);
    if (v !== null) speechVolumeEl.value = String(v);
  });
}

$("add-speech").addEventListener("click", () => {
  const spoken = speechTextWithTime(timeEl.value, speechCmdTextEl.value.trim());
  const cmds = speakerCommands(activeSpeakers, spoken, speechVolumeEl.value);
  if (!cmds.length) return;
  addCommands(cmds);
  speechCmdTextEl.value = "";
});

$("add-youtube").addEventListener("click", () => {
  const target = catalog.youtube[Number(youtubeDeviceEl.value || 0)];
  if (!target) return;
  const cmd = buildYouTubeCommand(withVolume(target.prefix, youtubeVolumeEl.value), youtubeUrlEl.value);
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
    const res = await api({ action: "list" });
    if (isShareAuthError(res)) {
      showShareExpired();
      return;
    }
    if (isSessionAuthError(res)) {
      expireSession();
      return;
    }
    if (!res.ok) throw new Error(res.error || "unknown error");
    updateShareBanner(res);
    listEl.innerHTML = "";
    // Same degradation contract as loadRules.
    const alarms = Array.isArray(res.alarms) ? res.alarms : [];
    if (!alarms.length) {
      listStatusEl.textContent = "設定中のアラームはありません。";
      return;
    }
    listStatusEl.textContent = "";
    alarms.forEach((alarm) => {
      if (!alarm || typeof alarm !== "object") return;
      const commands = Array.isArray(alarm.commands) ? alarm.commands : [];
      const row = document.createElement("div");
      row.className = "alarm-row";
      const left = document.createElement("div");
      const time = document.createElement("div");
      time.className = "alarm-time";
      time.textContent = formatApiTime(alarm.time);
      const cmds = document.createElement("div");
      cmds.className = "alarm-commands";
      cmds.textContent = commands
        .map((c) => describeCommand(fromWireCommand(c), catalog))
        .join(" / ");
      left.append(time, cmds);
      const actions = document.createElement("div");
      actions.className = "row-actions";
      appendExecCurl(left, actions, commands);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "theme-toggle";
      del.textContent = "削除";
      del.addEventListener("click", async () => {
        del.disabled = true;
        try {
          const r = await api({
            action: "delete",
            time: alarm.time,
          });
          if (isShareAuthError(r)) {
            showShareExpired();
            return;
          }
          if (!r.ok) throw new Error(r.error || "unknown error");
          await loadList();
        } catch (err) {
          listStatusEl.textContent = `削除に失敗しました: ${err.message}`;
          del.disabled = false;
        }
      });
      actions.appendChild(del);
      row.append(left, actions);
      listEl.appendChild(row);
    });
  } catch (err) {
    listStatusEl.textContent = `取得に失敗しました: ${err.message}`;
  }
}

$("reload").addEventListener("click", () => {
  loadList();
  loadRules();
});

// The id of the recurring rule loaded into the form for editing, or
// null while the form composes a new rule. Editing always goes
// through the commands mode: the rule's stored commands are loaded
// into the builder list as they are.
let editingRuleId = null;

function startEditRule(rule) {
  editingRuleId = rule.id;
  selectMainTab("form");
  document.querySelector('input[name="kind"][value="repeat"]').checked = true;
  document.querySelectorAll('input[name="kind"]').forEach((radio) => {
    radio.disabled = true;
  });
  renderKind();
  timeEl.value = rule.time || "";
  activeWeekdays = new Set(
    Array.isArray(rule.weekdays) && rule.weekdays.length > 0
      ? rule.weekdays
      : [0, 1, 2, 3, 4, 5, 6],
  );
  renderWeekdayChips();
  untilEl.value = rule.until ? apiDateToInput(rule.until) : "";
  formExceptions = Array.isArray(rule.exceptions) ? [...rule.exceptions] : [];
  renderFormExceptions();
  document.querySelector('input[name="mode"][value="commands"]').checked = true;
  renderMode();
  commands = (Array.isArray(rule.commands) ? rule.commands : []).map(fromWireCommand);
  renderCommands();
  registerBtn.textContent = "更新する";
  cancelEditBtn.hidden = false;
  setStatus(`編集中： ${describeWeekdays(rule.weekdays)} ${rule.time} のルール`);
  formSectionEl.scrollIntoView?.();
}

function endEdit() {
  editingRuleId = null;
  document.querySelectorAll('input[name="kind"]').forEach((radio) => {
    radio.disabled = false;
  });
  registerBtn.textContent = "登録する";
  cancelEditBtn.hidden = true;
}

cancelEditBtn.addEventListener("click", () => {
  endEdit();
  commands = [];
  renderCommands();
  formExceptions = [];
  renderFormExceptions();
  setStatus("編集をやめました。");
});

registerBtn.addEventListener("click", async () => {
  const editingId = editingRuleId;
  const repeat = currentKind() === "repeat";
  const apiTime = toApiTime(dateEl.value, timeEl.value);
  if (!repeat && !apiTime) {
    setStatus("日付と時刻を入力してください。", true);
    return;
  }
  if (repeat && !/^\d{2}:\d{2}$/.test(timeEl.value || "")) {
    setStatus("時刻を入力してください。", true);
    return;
  }
  const mode = currentMode();
  const body = repeat
    ? { action: "set_rule", time: timeEl.value, weekdays: [...activeWeekdays].sort((a, b) => a - b) }
    : { action: "set", time: apiTime };
  if (repeat && untilEl.value) {
    const until = toApiDate(untilEl.value);
    if (!until) {
      setStatus("終了日の形式が不正です。", true);
      return;
    }
    body.until = until;
  }
  if (repeat && formExceptions.length) {
    body.exceptions = [...formExceptions].sort();
  }
  if (repeat && editingId) {
    // Editing rewrites the rule in place: until and exceptions are
    // always sent (an empty value clears them), unlike a fresh
    // registration where an omitted field simply starts empty.
    body.action = "update_rule";
    body.id = editingId;
    body.until = toApiDate(untilEl.value) || "";
    body.exceptions = [...formExceptions].sort();
  }
  if (mode === "speech") {
    const cmds = speakerCommands(
      simpleSpeakers,
      speechTextWithTime(timeEl.value, speechTextEl.value.trim()),
      null,
    );
    if (!cmds.length) {
      setStatus("スピーカーを選んでください。", true);
      return;
    }
    body.commands = cmds.map(toWireCommand);
  } else {
    if (!commands.length) {
      setStatus("コマンドを1つ以上追加してください。", true);
      return;
    }
    body.commands = commands.map(toWireCommand);
  }
  registerBtn.disabled = true;
  setStatus(editingId ? "更新中…" : "登録中…");
  try {
    const res = await api(body);
    if (isShareAuthError(res)) {
      showShareExpired();
      return;
    }
    if (!res.ok) throw new Error(res.error || "unknown error");
    updateShareBanner(res);
    if (repeat) {
      setStatus(
        `繰り返しを${editingId ? "更新" : "登録"}しました（${describeWeekdays(res.rule.weekdays)} ${res.rule.time}` +
          `${res.rule.until ? `、${formatUntilDate(res.rule.until)}まで` : ""}` +
          `${describeExceptions(res.rule.exceptions) ? `、${describeExceptions(res.rule.exceptions)}` : ""}）。`,
      );
      if (editingId) endEdit();
      await loadRules();
    } else {
      setStatus(`${formatApiTime(res.time)} にアラームを登録しました。`);
      await loadList();
    }
    commands = [];
    renderCommands();
    formExceptions = [];
    renderFormExceptions();
    selectMainTab("list");
  } catch (err) {
    setStatus(`${editingId ? "更新" : "登録"}に失敗しました: ${err.message}`, true);
  } finally {
    registerBtn.disabled = false;
  }
});

function initForm() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  dateEl.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  timeEl.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  activeSpeakers = catalog.speech.length
    ? new Set([defaultSelectIndex(catalog.speech, "tatami")])
    : new Set();
  simpleSpeakers = catalog.speech.length
    ? new Set([defaultSelectIndex(catalog.speech, "tatami")])
    : new Set();
  renderSpeechSpeakers();
  renderSpeakerChips(speechModeDevicesEl, simpleSpeakers, null);
  fillSelect(youtubeDeviceEl, catalog.youtube, "tatami");
  fillVolumeSelect(speechVolumeEl);
  fillVolumeSelect(youtubeVolumeEl);
  const defaultSpeaker = catalog.speech[defaultSelectIndex(catalog.speech, "tatami")];
  const defaultVolume = defaultSpeaker ? prefixVolume(defaultSpeaker.prefix) : null;
  if (defaultVolume !== null) speechVolumeEl.value = String(defaultVolume);
  syncVolume(youtubeDeviceEl, youtubeVolumeEl, catalog.youtube);
  fillSelect(deviceSelectEl, [...catalog.devices, ...catalog.groups]);
  renderDeviceActions();
  renderCommands();
  renderMode();
  renderKind();
  renderWeekdayChips();
  renderFormExceptions();
}

// --- Owner-side temporary access link card ---

function renderIssuedShare() {
  if (!issuedShare) {
    shareIssueViewEl.hidden = false;
    shareIssuedViewEl.hidden = true;
    if (shareTimer) {
      clearInterval(shareTimer);
      shareTimer = null;
    }
    return;
  }
  shareIssueViewEl.hidden = true;
  shareIssuedViewEl.hidden = false;
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`;
  shareUrlEl.value = buildShareUrl(base, issuedShare.token);
  shareExpiresEl.textContent = formatShareExpiry(issuedShare.expiresAt);
  const tick = () => {
    shareRemainingEl.textContent = formatShareRemaining(
      shareSecondsLeft(issuedShare.expiresAt, Date.now()),
    );
  };
  tick();
  if (!shareTimer) {
    shareTimer = setInterval(tick, 30000);
  }
}

function setShareButtonsDisabled(disabled) {
  ["share-issue", "share-reissue", "share-revoke", "share-copy"].forEach((id) => {
    $(id).disabled = disabled;
  });
}

async function issueShare() {
  setShareButtonsDisabled(true);
  shareCardErrorEl.textContent = "";
  try {
    const res = await api({ action: "issue_share" });
    if (!res.ok) throw new Error(res.error || "unknown error");
    issuedShare = { token: res.share_token, expiresAt: res.expires_at };
    renderIssuedShare();
  } catch (err) {
    shareCardErrorEl.textContent = `発行に失敗しました: ${err.message}`;
  } finally {
    setShareButtonsDisabled(false);
  }
}

async function revokeShare() {
  setShareButtonsDisabled(true);
  shareCardErrorEl.textContent = "";
  try {
    const res = await api({ action: "revoke_share" });
    if (!res.ok) throw new Error(res.error || "unknown error");
    issuedShare = null;
    renderIssuedShare();
  } catch (err) {
    shareCardErrorEl.textContent = `無効化に失敗しました: ${err.message}`;
  } finally {
    setShareButtonsDisabled(false);
  }
}

$("share-issue").addEventListener("click", issueShare);
$("share-reissue").addEventListener("click", issueShare);
$("share-revoke").addEventListener("click", revokeShare);
shareCopyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareUrlEl.value);
    shareCopyBtn.textContent = "コピーしました";
    setTimeout(() => {
      shareCopyBtn.textContent = "URLをコピー";
    }, 2000);
  } catch {
    shareUrlEl.select();
  }
});

// Boot starts on the loading screen, not the sign-in gate: while
// the saved session is being restored, showing the Google button
// would read as "not signed in yet". The gate appears only once
// sign-in is truly required — every transition below therefore
// hides the loading screen and lands on exactly one of
// gate / expired / main.
function showMain(email) {
  loadingEl.hidden = true;
  gateEl.hidden = true;
  shareExpiredEl.hidden = true;
  shareBannerEl.hidden = true;
  shareTabAvailable = true;
  mainTabsEl.hidden = false;
  applyMainTab();
  logoutBtn.hidden = false;
  accountEl.textContent = email ? `${email} でログイン中` : "";
  renderIssuedShare();
  initForm();
  loadList();
  loadRules();
}

function showShareMain() {
  loadingEl.hidden = true;
  gateEl.hidden = true;
  shareExpiredEl.hidden = true;
  shareTabAvailable = false;
  if (mainTab === "share") {
    mainTab = "list";
  }
  mainTabsEl.hidden = false;
  applyMainTab();
  logoutBtn.hidden = true;
  accountEl.textContent = "";
  initForm();
  loadList();
  loadRules();
}

function showGate() {
  loadingEl.hidden = true;
  gateEl.hidden = false;
  mainTabsEl.hidden = true;
  listSectionEl.hidden = true;
  formSectionEl.hidden = true;
  shareSectionEl.hidden = true;
  shareExpiredEl.hidden = true;
  shareBannerEl.hidden = true;
  logoutBtn.hidden = true;
}

async function onCredential(response) {
  // No client-side authorization gate: alarm-gas verifies the token
  // and the account, and rejects unauthorized calls server-side.
  const payload = decodeJwtPayload(response.credential);
  // Exchange the (1-hour) ID token for a 30-day owner session and
  // save that, so the next visit restores the session instead of
  // starting at the gate.
  let res = null;
  try {
    res = await callApi(CONFIG.GAS_ENDPOINT, response.credential, {
      action: "exchange_session",
    });
  } catch {
    res = null;
  }
  if (!res || !res.ok || !res.session_token) {
    gateErrorEl.textContent = "ログインに失敗しました。もう一度お試しください。";
    return;
  }
  sessionToken = res.session_token;
  saveSessionToken(sessionToken);
  saveSessionEmail(payload.email || "");
  showMain(payload.email);
}

logoutBtn.addEventListener("click", () => {
  const endingSession = sessionToken;
  sessionToken = null;
  clearSavedSession();
  if (endingSession) {
    // Revoke the owner session server-side; local logout proceeds
    // regardless of the outcome.
    callApi(CONFIG.GAS_ENDPOINT, null, {
      action: "revoke_session",
      session_token: endingSession,
    }).catch(() => {});
  }
  issuedShare = null;
  renderIssuedShare();
  if (window.google) {
    google.accounts.id.disableAutoSelect();
  }
  gateErrorEl.textContent = "";
  showGate();
});

window.addEventListener("load", () => {
  // A #share= link skips the sign-in gate entirely: the share token
  // authenticates the API calls instead of an owner session.
  const token = parseShareToken(window.location.hash);
  if (token) {
    shareToken = token;
    showShareMain();
    return;
  }
  const savedSession = loadSavedSessionToken();
  if (savedSession) {
    sessionToken = savedSession;
    showMain(loadSavedSessionEmail());
    return;
  }
  showGate();
  initGoogleSignIn();
});
