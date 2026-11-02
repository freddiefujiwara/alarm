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
  describeWeekdays,
  formatApiTime,
  formatUntilDate,
  fromWireCommand,
  prefixVolume,
  speechTextWithTime,
  toApiDate,
  toApiTime,
  toWireCommand,
  withVolume,
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
const dateLabelEl = $("date-label");
const timeEl = $("time");
const repeatPanelEl = $("repeat-panel");
const weekdayChipsEl = $("weekday-chips");
const untilEl = $("until");
const ruleListEl = $("rule-list");
const ruleStatusEl = $("rule-status");
const speechTextEl = $("speech-text");
const speechPanelEl = $("speech-panel");
const commandsPanelEl = $("commands-panel");
const speechDeviceEl = $("speech-device");
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
let idToken = null;
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
// mode and with the Google ID token otherwise.
function api(body) {
  if (shareToken) {
    return callApi(CONFIG.GAS_ENDPOINT, null, { ...body, share_token: shareToken });
  }
  return callApi(CONFIG.GAS_ENDPOINT, idToken, body);
}

function isShareAuthError(res) {
  return Boolean(
    shareToken && res && typeof res.error === "string" && res.error.includes("share session"),
  );
}

function showShareExpired() {
  gateEl.hidden = true;
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
document.querySelectorAll('input[name="kind"]').forEach((radio) => {
  radio.addEventListener("change", renderKind);
});

async function loadRules() {
  ruleStatusEl.textContent = "読み込み中…";
  try {
    const res = await api({ action: "list_rules" });
    if (isShareAuthError(res)) {
      showShareExpired();
      return;
    }
    if (!res.ok) throw new Error(res.error || "unknown error");
    updateShareBanner(res);
    ruleListEl.innerHTML = "";
    if (!res.rules.length) {
      ruleStatusEl.textContent = "設定中の繰り返しはありません。";
      return;
    }
    ruleStatusEl.textContent = "";
    res.rules.forEach((rule) => {
      const row = document.createElement("div");
      row.className = "alarm-row";
      const left = document.createElement("div");
      const time = document.createElement("div");
      time.className = "alarm-time";
      time.textContent = `${describeWeekdays(rule.weekdays)} ${rule.time}`;
      const cmds = document.createElement("div");
      cmds.className = "alarm-commands";
      const parts = rule.commands
        .map((c) => describeCommand(fromWireCommand(c), catalog))
        .join(" / ");
      cmds.textContent = rule.until ? `${parts}（${formatUntilDate(rule.until)}まで）` : parts;
      left.append(time, cmds);
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
          if (!r.ok) throw new Error(r.error || "unknown error");
          await loadRules();
        } catch (err) {
          ruleStatusEl.textContent = `削除に失敗しました: ${err.message}`;
          del.disabled = false;
        }
      });
      row.append(left, del);
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

speechDeviceEl.addEventListener("change", () =>
  syncVolume(speechDeviceEl, speechVolumeEl, catalog.speech),
);
youtubeDeviceEl.addEventListener("change", () =>
  syncVolume(youtubeDeviceEl, youtubeVolumeEl, catalog.youtube),
);

$("add-speech").addEventListener("click", () => {
  const speaker = catalog.speech[Number(speechDeviceEl.value || 0)];
  const text = speechCmdTextEl.value.trim();
  if (!speaker) return;
  addCommands([
    buildSpeechCommand(
      withVolume(speaker.prefix, speechVolumeEl.value),
      speechTextWithTime(timeEl.value, text),
    ),
  ]);
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
    if (!res.ok) throw new Error(res.error || "unknown error");
    updateShareBanner(res);
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
      row.append(left, del);
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

registerBtn.addEventListener("click", async () => {
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
    const res = await api(body);
    if (isShareAuthError(res)) {
      showShareExpired();
      return;
    }
    if (!res.ok) throw new Error(res.error || "unknown error");
    updateShareBanner(res);
    if (repeat) {
      setStatus(
        `繰り返しを登録しました（${describeWeekdays(res.rule.weekdays)} ${res.rule.time}` +
          `${res.rule.until ? `、${formatUntilDate(res.rule.until)}まで` : ""}）。`,
      );
      await loadRules();
    } else {
      setStatus(`${formatApiTime(res.time)} にアラームを登録しました。`);
      await loadList();
    }
    commands = [];
    renderCommands();
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
  fillVolumeSelect(speechVolumeEl);
  fillVolumeSelect(youtubeVolumeEl);
  syncVolume(speechDeviceEl, speechVolumeEl, catalog.speech);
  syncVolume(youtubeDeviceEl, youtubeVolumeEl, catalog.youtube);
  fillSelect(deviceSelectEl, [...catalog.devices, ...catalog.groups]);
  renderDeviceActions();
  renderCommands();
  renderMode();
  renderKind();
  renderWeekdayChips();
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
    const res = await callApi(CONFIG.GAS_ENDPOINT, idToken, { action: "issue_share" });
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
    const res = await callApi(CONFIG.GAS_ENDPOINT, idToken, { action: "revoke_share" });
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

function showMain(email) {
  gateEl.hidden = true;
  shareExpiredEl.hidden = true;
  shareBannerEl.hidden = true;
  listSectionEl.hidden = false;
  formSectionEl.hidden = false;
  shareSectionEl.hidden = false;
  logoutBtn.hidden = false;
  accountEl.textContent = "ログイン中：" + email;
  renderIssuedShare();
  initForm();
  loadList();
  loadRules();
}

function showShareMain() {
  gateEl.hidden = true;
  shareExpiredEl.hidden = true;
  shareSectionEl.hidden = true;
  logoutBtn.hidden = true;
  listSectionEl.hidden = false;
  formSectionEl.hidden = false;
  accountEl.textContent = "";
  initForm();
  loadList();
  loadRules();
}

function showGate() {
  gateEl.hidden = false;
  listSectionEl.hidden = true;
  formSectionEl.hidden = true;
  shareSectionEl.hidden = true;
  shareExpiredEl.hidden = true;
  shareBannerEl.hidden = true;
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
  issuedShare = null;
  renderIssuedShare();
  if (window.google) {
    google.accounts.id.disableAutoSelect();
  }
  showGate();
});

window.addEventListener("load", () => {
  // A #share= link skips the sign-in gate entirely: the share token
  // authenticates the API calls instead of a Google ID token.
  const token = parseShareToken(window.location.hash);
  if (token) {
    shareToken = token;
    showShareMain();
    return;
  }
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
