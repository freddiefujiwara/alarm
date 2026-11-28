import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Boot-level rule editing: the 編集 button loads a rule into the
// form, and submitting sends update_rule with the rule's id instead
// of creating a new rule. Cancelling returns the form to create
// mode.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

const jsonResponse = (data) => ({
  ok: true,
  json: async () => data,
  text: async () => JSON.stringify(data),
});

async function until(fn, timeoutMs = 5000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function bootPage() {
  document.documentElement.innerHTML = html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!doctype html>/i, "");
  localStorage.clear();
  sessionStorage.clear();
  window.location.hash = "";
}

async function bootApp() {
  await import("../src/main.js");
  window.dispatchEvent(new Event("load"));
}

const rule = {
  id: "rule-1",
  time: "07:30",
  weekdays: [1, 2, 3, 4, 5],
  until: "20261231",
  exceptions: ["20261225"],
  last_fired: null,
  commands: ["switchbot-command -d DEVICE1 -c turnOff"],
};

function stubFetch(onUpdate) {
  return vi.fn(async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.action === "list") return jsonResponse({ ok: true, alarms: [] });
    if (body.action === "list_rules") return jsonResponse({ ok: true, rules: [rule] });
    if (body.action === "update_rule") {
      onUpdate(body);
      return jsonResponse({ ok: true, rule: { ...rule, time: body.time } });
    }
    return jsonResponse({ ok: true });
  });
}

function clickButton(container, text) {
  const btn = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );
  if (!btn) throw new Error(`button not found: ${text}`);
  btn.click();
  return btn;
}

describe("boot rule editing (runtime)", () => {
  it("loads a rule into the form and submits update_rule", async () => {
    vi.resetModules();
    bootPage();
    localStorage.setItem("alarm-session-token", "saved-session");
    localStorage.setItem("alarm-session-email", "owner@example.com");
    let updateBody = null;
    vi.stubGlobal("fetch", stubFetch((body) => { updateBody = body; }));

    await bootApp();

    await until(() => document.getElementById("rule-list").children.length === 1);
    clickButton(document.getElementById("rule-list"), "編集");

    await until(() => document.getElementById("register").textContent === "更新する");
    expect(document.getElementById("cancel-edit").hidden).toBe(false);
    expect(document.getElementById("time").value).toBe("07:30");
    expect(document.getElementById("until").value).toBe("2026-12-31");
    expect(document.getElementById("cmd-count").textContent).toBe("1");
    expect(document.getElementById("exception-chips").textContent).toContain("2026/12/25");

    document.getElementById("time").value = "08:00";
    document.getElementById("register").click();

    await until(() => updateBody !== null);
    expect(updateBody.action).toBe("update_rule");
    expect(updateBody.id).toBe("rule-1");
    expect(updateBody.time).toBe("08:00");
    expect(updateBody.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(updateBody.until).toBe("20261231");
    expect(updateBody.exceptions).toEqual(["20261225"]);
    expect(updateBody.commands).toEqual(["switchbot-command -d DEVICE1 -c turnOff"]);

    await until(() => document.getElementById("register").textContent === "登録する");
    expect(document.getElementById("cancel-edit").hidden).toBe(true);
    expect(document.getElementById("time").value).toBe("");
    expect(document.getElementById("until").value).toBe("");
  });

  it("cancelling an edit returns the form to create mode", async () => {
    vi.resetModules();
    bootPage();
    localStorage.setItem("alarm-session-token", "saved-session");
    localStorage.setItem("alarm-session-email", "owner@example.com");
    vi.stubGlobal("fetch", stubFetch(() => {}));

    await bootApp();

    await until(() => document.getElementById("rule-list").children.length === 1);
    clickButton(document.getElementById("rule-list"), "編集");
    await until(() => document.getElementById("register").textContent === "更新する");

    const activeChips = () =>
      [...document.getElementById("weekday-chips").children].filter((c) =>
        c.classList.contains("active"),
      ).length;
    expect(activeChips()).toBe(5);
    expect(document.getElementById("time").value).toBe("07:30");
    expect(document.getElementById("until").value).toBe("2026-12-31");

    document.getElementById("cancel-edit").click();

    await until(() => document.getElementById("register").textContent === "登録する");
    expect(document.getElementById("cancel-edit").hidden).toBe(true);
    expect(document.getElementById("status").textContent).toBe("編集をやめました。");
    expect(document.getElementById("time").value).toBe("");
    expect(document.getElementById("until").value).toBe("");
    expect(activeChips()).toBe(7);
    expect(document.getElementById("form-section").hidden).toBe(true);
    expect(document.getElementById("list-section").hidden).toBe(false);
  });

  it("switching to the list tab ends the edit and clears its status", async () => {
    vi.resetModules();
    bootPage();
    localStorage.setItem("alarm-session-token", "saved-session");
    localStorage.setItem("alarm-session-email", "owner@example.com");
    vi.stubGlobal("fetch", stubFetch(() => {}));

    await bootApp();

    await until(() => document.getElementById("rule-list").children.length === 1);
    clickButton(document.getElementById("rule-list"), "編集");
    await until(() => document.getElementById("register").textContent === "更新する");
    expect(document.getElementById("status").textContent).toContain("編集中");

    document.querySelector('[data-main-tab="list"]').click();

    await until(() => document.getElementById("list-section").hidden === false);
    expect(document.getElementById("status").textContent).toBe("編集をやめました。");
    expect(document.getElementById("register").textContent).toBe("登録する");
    expect(document.getElementById("cancel-edit").hidden).toBe(true);
    expect(document.getElementById("time").value).toBe("");
  });
});

it("renders both alarm row types while keeping their distinct controls and delete actions", async () => {
  vi.resetModules();
  bootPage();
  localStorage.setItem("alarm-session-token", "saved-session");
  localStorage.setItem("alarm-session-email", "owner@example.com");
  const alarmTime = "20261223-06:52";
  const commands = ["switchbot-command -d DEVICE1 -c turnOff", "echo sample"];
  const deletes = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.action === "list") {
      return jsonResponse({ ok: true, alarms: [{ time: alarmTime, commands }] });
    }
    if (body.action === "list_rules") {
      return jsonResponse({ ok: true, rules: [{ ...rule, commands }] });
    }
    if (body.action === "delete" || body.action === "delete_rule") {
      deletes.push(body);
    }
    return jsonResponse({ ok: true });
  }));

  vi.stubEnv("VITE_ALARM_EXEC_BASE", "https://exec.example.test");
  try {
    await bootApp();
  } finally {
    vi.unstubAllEnvs();
  }
  await until(() => document.querySelector("#alarm-list .alarm-row")
    && document.querySelector("#rule-list .alarm-row"));
  const single = document.querySelector("#alarm-list .alarm-row");
  const repeat = document.querySelector("#rule-list .alarm-row");
  const label = (row, selector) => row.querySelector(selector).textContent;
  const buttons = (row) => [...row.querySelectorAll(".row-actions > button")]
    .map((button) => button.getAttribute("aria-label") || button.textContent);

  expect(label(single, ".alarm-time")).toBe("12/23 06:52");
  expect(label(repeat, ".alarm-time")).toBe("平日のみ 07:30");
  const commandLabel = "/switchbot-command/-d/DEVICE1/-c/turnOff / /echo/sample";
  expect(label(single, ".alarm-commands")).toBe(commandLabel);
  expect(label(repeat, ".alarm-commands")).toBe(
    `${commandLabel}（2026/12/31まで、2026/12/25を除く）`,
  );
  expect(buttons(single)).toEqual(["curlを表示", "curlをコピー", "削除"]);
  expect(buttons(repeat)).toEqual(["curlを表示", "curlをコピー", "削除", "編集", "除外日"]);
  for (const row of [single, repeat]) {
    const block = row.querySelector(".exec-block");
    const toggle = row.querySelector('[aria-label="curlを表示"]');
    expect(block.hidden).toBe(true);
    expect(label(row, ".exec-pre")).toContain("DEVICE1");
    toggle.click();
    expect(block.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  }

  clickButton(single, "削除");
  clickButton(repeat, "削除");
  await until(() => deletes.length === 2);
  expect(deletes).toEqual([
    expect.objectContaining({ action: "delete", time: alarmTime }),
    expect.objectContaining({ action: "delete_rule", id: rule.id }),
  ]);
});
