import { describe, expect, it } from "vitest";
import {
  buildShareUrl,
  formatShareExpiry,
  formatShareRemaining,
  parseShareToken,
  shareSecondsLeft,
} from "../src/share.js";

describe("parseShareToken", () => {
  it("extracts the token from a share fragment", () => {
    expect(parseShareToken("#share=abc123")).toBe("abc123");
  });

  it("finds the token among other fragment parts", () => {
    expect(parseShareToken("#x=1&share=a%20b")).toBe("a b");
  });

  it("returns an empty string when there is no share token", () => {
    expect(parseShareToken("")).toBe("");
    expect(parseShareToken("#other=1")).toBe("");
    expect(parseShareToken(null)).toBe("");
  });
});

describe("buildShareUrl", () => {
  it("appends the token as a share fragment", () => {
    expect(buildShareUrl("https://example.com/alarm/", "tok en")).toBe(
      "https://example.com/alarm/#share=tok%20en",
    );
  });
});

describe("shareSecondsLeft", () => {
  it("counts whole seconds until expiry, floored at zero", () => {
    const now = Date.parse("2026-11-02T00:00:00.000Z");
    expect(shareSecondsLeft("2026-11-02T00:01:30.000Z", now)).toBe(90);
    expect(shareSecondsLeft("2026-11-01T23:59:00.000Z", now)).toBe(0);
  });

  it("returns null for an invalid date", () => {
    expect(shareSecondsLeft("not-a-date", 0)).toBeNull();
  });
});

describe("formatShareRemaining", () => {
  it("formats minutes", () => {
    expect(formatShareRemaining(1800)).toBe("残り約30分");
    expect(formatShareRemaining(61)).toBe("残り約2分");
    expect(formatShareRemaining(60)).toBe("残り約1分");
  });

  it("formats hours and days", () => {
    expect(formatShareRemaining(3600)).toBe("残り約1時間");
    expect(formatShareRemaining(5 * 3600)).toBe("残り約5時間");
    expect(formatShareRemaining(86400)).toBe("残り約1日");
    expect(formatShareRemaining(30 * 86400)).toBe("残り約30日");
  });

  it("formats under a minute", () => {
    expect(formatShareRemaining(59)).toBe("残り約1分未満");
    expect(formatShareRemaining(1)).toBe("残り約1分未満");
  });

  it("formats expired and unknown", () => {
    expect(formatShareRemaining(0)).toBe("期限切れ");
    expect(formatShareRemaining(null)).toBe("");
  });
});

describe("formatShareExpiry", () => {
  it("formats as YYYYMMDD HH:MM in local time", () => {
    const iso = new Date(2026, 11, 2, 7, 53).toISOString();
    expect(formatShareExpiry(iso)).toBe("20261202 07:53");
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatShareExpiry("not-a-date")).toBe("");
    expect(formatShareExpiry("")).toBe("");
  });
});
