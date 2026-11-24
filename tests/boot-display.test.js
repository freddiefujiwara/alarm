import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Guards for the boot display contract, which the unit tests over
// src modules cannot see — the same arrangement as the social app:
//   - the page must open on the loading screen, never on the
//     sign-in gate — while a saved session is restored in the
//     background, a visible Google button reads as "not signed
//     in yet" and makes the visitor anxious;
//   - the gate (and its button) appears only once sign-in is
//     truly required, so main.js must hide the loading screen in
//     every transition that shows the gate, the expired screen
//     or the main screen;
//   - the gate's messages and the Google button match the other
//     apps word for word.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const mainJs = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "style.css"), "utf8");

const sectionTag = (id) => {
  const match = html.match(new RegExp(`<section id="${id}"[^>]*>`));
  return match ? match[0] : "";
};

const fnBody = (name) =>
  mainJs.match(new RegExp(`function ${name}\\([^)]*\\) \\{[^}]*\\}`))?.[0] ?? "";

describe("boot display", () => {
  it("opens on the loading screen, not the sign-in gate", () => {
    expect(sectionTag("boot-loading")).not.toBe("");
    expect(sectionTag("boot-loading")).not.toContain("hidden");
    expect(sectionTag("gate")).toContain("hidden");
    expect(html).toContain('<div class="spinner" aria-hidden="true"></div>');
    expect(html).toContain("読み込んでいます…");
  });

  it("keeps the expired screen hidden at open", () => {
    expect(sectionTag("share-expired")).toContain("hidden");
  });

  it("styles the spinner like the other apps", () => {
    expect(css).toMatch(/\.spinner \{[^}]*width: 28px/);
    expect(css).toContain("animation: spinner-rotate 0.8s linear infinite;");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.spinner \{\s*animation-duration: 2\.4s;/,
    );
  });

  it("lets the hidden attribute win over class display rules", () => {
    // .theme-toggle sets display: inline-flex, which would otherwise
    // keep hidden buttons (logout, cancel-edit) visible.
    expect(css).toMatch(/\[hidden\] \{\s*display: none !important;/);
  });

  it("hides the loading screen on every landing screen", () => {
    for (const fn of ["showGate", "showMain", "showShareMain", "showShareExpired"]) {
      expect(fnBody(fn)).toContain("loadingEl.hidden = true");
    }
    expect(mainJs).toContain('$("boot-loading")');
  });

  it("renders the Google button with the unified options", () => {
    const call = mainJs.match(
      /renderButton\(document\.getElementById\("signin"\), \{[^}]*\}\)/,
    )?.[0];
    expect(call).toContain('theme: "outline"');
    expect(call).toContain('size: "large"');
    expect(call).toContain('text: "signin_with"');
    expect(call).toContain('shape: "pill"');
  });

  it("shows the account as <email> でログイン中", () => {
    expect(mainJs).toContain("`${email} でログイン中`");
    expect(mainJs).not.toContain("ログイン中：");
  });

  it("announces an expired session when expireSession returns to the gate", () => {
    expect(mainJs).toContain(
      "ログインの有効期限が切れました。再度ログインしてください。",
    );
    expect(fnBody("expireSession")).toContain(
      "gateErrorEl.textContent = SESSION_EXPIRED_TEXT;",
    );
  });

  it("gives up waiting for the Google script and says so on the gate", () => {
    expect(mainJs).toContain(
      "Googleログインスクリプトの読み込みに失敗しました。広告ブロック等を解除して再読み込みしてください。",
    );
    expect(mainJs).toMatch(/signInScriptWaitMs >= 3000/);
  });
});
