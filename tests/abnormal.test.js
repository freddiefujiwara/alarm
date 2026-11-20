import { describe, expect, it } from "vitest";
import {
  buildShareUrl,
  formatShareExpiry,
  formatShareRemaining,
  parseShareToken,
  shareSecondsLeft,
} from "../src/share.js";
import {
  describeCommand,
  describeWeekdays,
  formatApiTime,
  formatUntilDate,
  fromWireCommand,
  toExecCurlBlock,
  toWireCommand,
} from "../src/builder.js";

// Abnormal-case tests: deformed values of the kind a broken or
// changed alarm-gas response (or a damaged share link) could deliver,
// fed to the shaping layer. The contract is graceful behaviour — no
// throw, no non-string leaking into a label, no "NaN"/"undefined"
// rendered as if it were data. Well-formed behaviour is pinned by
// builder.test.js / share.test.js and must not change.

// Producible via JSON.parse('{"toString":[]}'): an object whose
// toString is not a function makes String(), Number(), Date and
// RegExp coercion throw a TypeError.
const unstringifiable = { toString: [] };

const catalog = {
  speech: [{ id: "nest", label: "Nest", prefix: "/speak/-h/192.0.2.1/-v/60/-s/" }],
  youtube: [{ id: "tatami", label: "畳", prefix: "/youtube-play/-h/192.0.2.2/-v/10/-i/" }],
  devices: [
    {
      id: "fan",
      label: "Fan",
      actions: [{ label: "Off", commands: ["/fan/turnOff"] }],
    },
  ],
  groups: [],
};

describe("parseShareToken with a damaged share link", () => {
  it("treats a malformed percent-encoding as no token instead of throwing", () => {
    // A truncated copy-paste of a share link: decodeURIComponent
    // throws URIError, and parseShareToken runs unguarded in the
    // boot load handler, so the throw wedged the page on the
    // loading screen. The same defect was fixed in music-admin
    // and health.
    expect(parseShareToken("#share=%E0%A4%A")).toBe("");
    expect(parseShareToken("#share=%")).toBe("");
    expect(parseShareToken("#share=%zz")).toBe("");
  });

  it("treats non-string hashes as no token", () => {
    expect(parseShareToken(123)).toBe("");
    expect(parseShareToken(["#share=x"])).toBe("");
    expect(parseShareToken(unstringifiable)).toBe("");
    expect(parseShareToken(undefined)).toBe("");
  });
});

describe("share expiry helpers with deformed values", () => {
  it("reads an unstringifiable or object expiry as invalid, never throws", () => {
    expect(shareSecondsLeft(unstringifiable, 0)).toBeNull();
    expect(shareSecondsLeft({}, 0)).toBeNull();
    expect(formatShareExpiry(unstringifiable)).toBe("");
    expect(formatShareExpiry(null)).toBe("");
    expect(formatShareExpiry({})).toBe("");
  });

  it("never renders NaN or Infinity as a remaining-time label", () => {
    expect(formatShareRemaining(NaN)).toBe("");
    expect(formatShareRemaining(Infinity)).toBe("");
    expect(formatShareRemaining(undefined)).toBe("");
    expect(formatShareRemaining("abc")).toBe("");
  });

  it("builds no URL when the issue response carried no token", () => {
    // Same defect as music-admin / health: "#share=undefined".
    expect(buildShareUrl("https://example.com/alarm/", undefined)).toBe("");
    expect(buildShareUrl("https://example.com/alarm/", null)).toBe("");
    expect(buildShareUrl("https://example.com/alarm/", "")).toBe("");
  });
});

describe("wire command conversion with deformed commands", () => {
  it("reads non-string commands as blank instead of throwing", () => {
    // commands arrive from the alarm-gas payload; one deformed
    // entry must not take down the whole list render.
    expect(fromWireCommand(null)).toBe("");
    expect(fromWireCommand(undefined)).toBe("");
    expect(fromWireCommand(unstringifiable)).toBe("");
    expect(fromWireCommand(["hue lights off"])).toBe("");
    expect(toWireCommand(null)).toBe("");
    expect(toWireCommand(unstringifiable)).toBe("");
  });

  it("stringifies numeric commands", () => {
    expect(fromWireCommand(123)).toBe("123");
    expect(toWireCommand(42)).toBe("42");
  });
});

describe("describeCommand with deformed commands", () => {
  it("always returns a string label", () => {
    expect(describeCommand(null, catalog)).toBe("");
    expect(describeCommand(unstringifiable, catalog)).toBe("");
    expect(describeCommand(123, catalog)).toBe("123");
    expect(typeof describeCommand({}, catalog)).toBe("string");
  });
});

describe("describeWeekdays with deformed weekday lists", () => {
  it("reads a missing or non-array list as no description", () => {
    expect(describeWeekdays(null)).toBe("");
    expect(describeWeekdays(undefined)).toBe("");
    expect(describeWeekdays(5)).toBe("");
    expect(describeWeekdays("123")).toBe("");
  });

  it("ignores entries that are not valid day numbers", () => {
    expect(describeWeekdays([1, 7])).toBe("月");
    expect(describeWeekdays([1, null, 3])).toBe("月・水");
    expect(describeWeekdays([1.5, 2])).toBe("火");
    expect(describeWeekdays([true, 2])).toBe("火");
    expect(describeWeekdays([unstringifiable, 0])).toBe("日");
  });

  it("describes a set with duplicates once", () => {
    expect(describeWeekdays([1, 1, 2, 3, 4, 5])).toBe("平日のみ");
    expect(describeWeekdays([0, 6, 6, 0])).toBe("土日のみ");
  });
});

describe("time and date formatting with deformed values", () => {
  it("formatApiTime always returns a string", () => {
    expect(formatApiTime(20261102)).toBe("20261102");
    expect(formatApiTime(unstringifiable)).toBe("");
    expect(formatApiTime(null)).toBe("");
    expect(formatApiTime(["20261102-06:52"])).toBe("");
    expect(typeof formatApiTime(true)).toBe("string");
  });

  it("formatUntilDate always returns a string", () => {
    expect(formatUntilDate(null)).toBe("");
    expect(formatUntilDate(undefined)).toBe("");
    expect(formatUntilDate(unstringifiable)).toBe("");
    // A numeric date from a sheet cell still formats, as before.
    expect(formatUntilDate(20261231)).toBe("2026/12/31");
  });
});

describe("toExecCurlBlock with deformed command lists", () => {
  const base = "https://exec.example.test";

  it("reads a non-array list as no lines instead of throwing", () => {
    expect(toExecCurlBlock("hue lights off", base)).toBe("");
    expect(toExecCurlBlock(42, base)).toBe("");
    expect(toExecCurlBlock(unstringifiable, base)).toBe("");
  });

  it("skips non-string entries and keeps the convertible ones", () => {
    expect(toExecCurlBlock([null, 42, {}, "hue lights off"], base)).toBe(
      `curl -s "${base}/hue/lights/off"`,
    );
  });
});
