import { describe, expect, it, vi } from "vitest";
import { applyTheme, nextTheme, resolveTheme } from "../src/theme.js";

describe("theme", () => {
  it("resolves dark by default and light only when stored", () => {
    expect(resolveTheme(null)).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
  });
  it("applies the theme attribute and the target label", () => {
    const root = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
    const button = { textContent: "" };
    applyTheme(root, button, "light");
    expect(root.setAttribute).toHaveBeenCalledWith("data-theme", "light");
    expect(button.textContent).toBe("ダーク");
    applyTheme(root, button, "dark");
    expect(root.removeAttribute).toHaveBeenCalledWith("data-theme");
    expect(button.textContent).toBe("ライト");
  });
});
