import { describe, expect, it } from "vitest";
import {
  buildSpeechCommand,
  buildYouTubeCommand,
  describeCommand,
  formatApiTime,
  parseYouTubeId,
  toApiTime,
} from "./builder.js";

const catalog = {
  speech: [{ id: "nest", label: "Nest", prefix: "/speak/-h/192.0.2.1/-v/60/-s/" }],
  youtube: [{ id: "tatami", label: "畳", prefix: "/youtube-play/-h/192.0.2.2/-v/10/-i/" }],
  devices: [
    {
      id: "fan",
      label: "Fan",
      actions: [
        { label: "S", commands: ["/fan/turnOn", "/fan/setWindSpeed/-p/11"] },
        { label: "M", commands: ["/fan/turnOn", "/fan/setWindSpeed/-p/50"] },
        { label: "L", commands: ["/fan/turnOn", "/fan/setWindSpeed/-p/100"] },
        { label: "Off", commands: ["/fan/turnOff"] },
      ],
    },
  ],
  groups: [],
};

describe("parseYouTubeId", () => {
  it("reads watch, youtu.be, shorts and live URLs", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=abc123&t=5")).toBe("abc123");
    expect(parseYouTubeId("https://youtu.be/abc123")).toBe("abc123");
    expect(parseYouTubeId("https://www.youtube.com/shorts/abc123")).toBe("abc123");
    expect(parseYouTubeId("https://www.youtube.com/live/abc123")).toBe("abc123");
  });
  it("rejects other hosts and empty input", () => {
    expect(parseYouTubeId("https://example.com/watch?v=abc123")).toBeNull();
    expect(parseYouTubeId("")).toBeNull();
    expect(parseYouTubeId("not a url")).toBeNull();
  });
});

describe("command builders", () => {
  it("builds an encoded speech command with folded whitespace", () => {
    expect(buildSpeechCommand("/speak/-s/", "おはよう ございます")).toBe(
      "/speak/-s/" + encodeURIComponent("おはよう　ございます"),
    );
  });
  it("builds a YouTube command or returns null", () => {
    expect(buildYouTubeCommand("/yt/-i/", "https://youtu.be/xyz")).toBe("/yt/-i/xyz");
    expect(buildYouTubeCommand("/yt/-i/", "https://example.com/")).toBeNull();
  });
});

describe("time conversion", () => {
  it("converts input values to the API format and back", () => {
    expect(toApiTime("2026-11-02", "06:52")).toBe("20261102-06:52");
    expect(toApiTime("", "06:52")).toBeNull();
    expect(formatApiTime("20261102-06:52")).toBe("11/2 06:52");
    expect(formatApiTime("bogus")).toBe("bogus");
  });
});

describe("describeCommand", () => {
  it("labels speech and YouTube commands", () => {
    const speech = buildSpeechCommand(catalog.speech[0].prefix, "テスト");
    expect(describeCommand(speech, catalog)).toBe("発話（Nest）: テスト");
    expect(describeCommand(catalog.youtube[0].prefix + "vid9", catalog)).toBe(
      "YouTube（畳）: vid9",
    );
  });
  it("labels a command unique to one action, else falls back to the path", () => {
    expect(describeCommand("/fan/setWindSpeed/-p/11", catalog)).toBe("Fan S");
    expect(describeCommand("/fan/turnOn", catalog)).toBe("/fan/turnOn");
    expect(describeCommand("/unknown/x", catalog)).toBe("/unknown/x");
  });
});
