import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Runtime coverage for the boot display contract: boots main.js
// in jsdom (its entry point is the window load event, which the
// test dispatches by hand) and checks that the page leaves the
// loading screen for exactly one landing screen — the main
// screen for a saved session, the gate otherwise — and that a
// Google sign-in script that never arrives is announced on the
// gate instead of leaving the sign-in area silently empty.
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
}

async function bootApp() {
  await import("../src/main.js");
  window.dispatchEvent(new Event("load"));
}

describe("boot display (runtime)", () => {
  it("restores a saved session onto the main screen, off the loading screen", async () => {
    bootPage();
    localStorage.setItem("alarm-session-token", "saved-session");
    localStorage.setItem("alarm-session-email", "owner@example.com");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: true, alarms: [], rules: [] })),
    );

    await bootApp();

    await until(() => document.getElementById("main-tabs").hidden === false);
    expect(document.getElementById("boot-loading").hidden).toBe(true);
    expect(document.getElementById("gate").hidden).toBe(true);
    expect(document.getElementById("account").textContent).toBe(
      "owner@example.com でログイン中",
    );
  });

  it("lands on the gate and announces a Google script that never arrives", async () => {
    vi.resetModules();
    bootPage();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: false, error: "unauthorized" })),
    );

    await bootApp();

    await until(() => document.getElementById("gate").hidden === false);
    expect(document.getElementById("boot-loading").hidden).toBe(true);
    // The script-wait gives up after about three seconds and
    // says why the sign-in area is empty.
    await until(
      () =>
        document.getElementById("gate-error").textContent ===
        "Googleログインスクリプトの読み込みに失敗しました。広告ブロック等を解除して再読み込みしてください。",
      8000,
    );
  });
});
