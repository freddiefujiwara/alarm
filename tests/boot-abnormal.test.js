import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Boot-level abnormal cases: a deformed alarm-gas payload must not
// take down the whole list. The healthy entries still render and
// the deformed ones degrade, instead of one bad entry failing the
// entire load with an error message. A damaged share link must
// land on the sign-in gate, not wedge the page on the loading
// screen (parseShareToken runs unguarded in the load handler).
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

describe("boot with a deformed payload (runtime)", () => {
  it("renders the healthy entries and skips the deformed ones", async () => {
    bootPage();
    localStorage.setItem("alarm-session-token", "saved-session");
    localStorage.setItem("alarm-session-email", "owner@example.com");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          ok: true,
          alarms: [
            null,
            { time: "20261102-06:52", commands: "oops" },
            { time: 12345, commands: [null, "hue lights off"] },
          ],
          rules: [
            null,
            { weekdays: null, time: "07:00", commands: null, until: null },
            { weekdays: [1, 7], time: "08:00", commands: ["hue lights off"] },
          ],
        }),
      ),
    );

    await bootApp();

    await until(() => document.getElementById("main-tabs").hidden === false);
    await until(() => document.getElementById("alarm-list").children.length === 2);
    expect(document.getElementById("list-status").textContent).not.toContain(
      "取得に失敗しました",
    );
    const listText = document.getElementById("alarm-list").textContent;
    expect(listText).toContain("/hue/lights/off");
    await until(() => document.getElementById("rule-list").children.length === 2);
    expect(document.getElementById("rule-status").textContent).not.toContain(
      "取得に失敗しました",
    );
    const ruleText = document.getElementById("rule-list").textContent;
    expect(ruleText).toContain("07:00");
    expect(ruleText).toContain("08:00");
  });

  it("reads non-array lists as empty instead of failing the load", async () => {
    vi.resetModules();
    bootPage();
    localStorage.setItem("alarm-session-token", "saved-session");
    localStorage.setItem("alarm-session-email", "owner@example.com");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: true, alarms: "oops", rules: 42 })),
    );

    await bootApp();

    await until(
      () =>
        document.getElementById("list-status").textContent ===
        "設定中のアラームはありません。",
    );
    await until(
      () =>
        document.getElementById("rule-status").textContent ===
        "設定中の繰り返しはありません。",
    );
  });

  it("lands on the gate for a share link with a damaged token", async () => {
    vi.resetModules();
    bootPage();
    window.location.hash = "#share=%E0%A4%A";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: false, error: "unauthorized" })),
    );

    await bootApp();

    await until(() => document.getElementById("gate").hidden === false);
    expect(document.getElementById("boot-loading").hidden).toBe(true);
    window.location.hash = "";
  });
});
