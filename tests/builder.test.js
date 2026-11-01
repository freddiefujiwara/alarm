import { describe, expect, it } from "vitest";
import {
  buildSpeechCommand,
  buildYouTubeCommand,
  defaultSelectIndex,
  describeCommand,
  formatApiTime,
  fromWireCommand,
  parseYouTubeId,
  speechTextWithTime,
  toApiTime,
  toWireCommand,
} from "../src/builder.js";

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

describe("defaultSelectIndex", () => {
  it("prefers the entry with the matching id", () => {
    const items = [{ id: "nest" }, { id: "tatami" }, { id: "tv" }];
    expect(defaultSelectIndex(items, "tatami")).toBe(1);
  });

  it("falls back to the first entry when the id is absent", () => {
    const items = [{ id: "nest" }, { id: "tv" }];
    expect(defaultSelectIndex(items, "tatami")).toBe(0);
  });

  it("returns 0 for an empty list", () => {
    expect(defaultSelectIndex([], "tatami")).toBe(0);
  });
});

describe("speechTextWithTime", () => {
  it("prefixes the alarm time in the backend wording", () => {
    expect(speechTextWithTime("07:30", "行ってきます")).toBe("7時30分です。行ってきます");
  });

  it("uses ちょうど on the hour, a 12-hour clock, and the nudge for empty text", () => {
    expect(speechTextWithTime("13:00", "")).toBe(
      "1時ちょうどです。時間ですよ。時間ですよ。そろそろ時間ですよ。"
    );
    expect(speechTextWithTime("00:05", "テスト")).toBe("12時5分です。テスト");
  });

  it("returns the text unchanged without a valid time", () => {
    expect(speechTextWithTime("", "テスト")).toBe("テスト");
  });
});

describe("wire command forms", () => {
  it("converts path form to space form for the backend", () => {
    expect(toWireCommand("/switchbot-command/-d/X/-c/turnOff")).toBe(
      "switchbot-command -d X -c turnOff"
    );
    expect(toWireCommand("/hue/lights/off")).toBe("hue lights off");
  });

  it("round-trips a speech command whose text is URL-encoded", () => {
    const cmd = buildSpeechCommand("/speak/-h/192.0.2.1/-v/60/-s/", "行ってきます");
    expect(fromWireCommand(toWireCommand(cmd))).toBe(cmd);
  });

  it("converts the space form back and passes other input through", () => {
    expect(fromWireCommand("hue lights off")).toBe("/hue/lights/off");
    expect(fromWireCommand("/hue/lights/off")).toBe("/hue/lights/off");
    expect(fromWireCommand("https://example.com/x")).toBe("https://example.com/x");
    expect(fromWireCommand("おはよう")).toBe("おはよう");
  });
});
