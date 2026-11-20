import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  buildShareUrl,
  formatShareExpiry,
  formatShareRemaining,
  parseShareToken,
  shareSecondsLeft,
} from "../src/share.js";
import {
  EMPTY_TEXT_SUFFIX,
  VOLUME_STEPS,
  buildSpeechCommand,
  describeCommand,
  describeWeekdays,
  formatApiTime,
  formatUntilDate,
  fromWireCommand,
  parseYouTubeId,
  prefixVolume,
  speechTextWithTime,
  toApiDate,
  toApiTime,
  toExecCurlBlock,
  toWireCommand,
  withVolume,
} from "../src/builder.js";

// Property-based tests (fast-check) over the shaping layer that
// consumes the alarm-gas payload and the share link. The properties
// pin the contracts the abnormal-case tests spot-check: shaping
// never throws, never leaks a non-string / NaN / undefined into a
// label, and the format conversions round-trip.

// Any value JSON can carry, plus the JSON-producible object whose
// toString is not a function ({"toString":[]} — String(), Number(),
// Date and RegExp coercion throw on it), undefined and NaN.
const unstringifiable = { toString: [] };
const anyPayloadValue = fc.oneof(
  fc.jsonValue(),
  fc.constant(unstringifiable),
  fc.constant(undefined),
  fc.constant(NaN),
  fc.constant(Infinity),
);

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

describe("share token properties", () => {
  it("parseShareToken never throws on fragment-like strings", () => {
    // Fragments biased toward malformed percent-encodings: a
    // damaged share link must read as "no token", never throw
    // (it runs unguarded in the boot load handler).
    const fragment = fc
      .array(
        fc.constantFrom("%", "%E0", "%A4", "share=", "&", "a", "b", "=", "%zz", "#", "x"),
        { maxLength: 10 },
      )
      .map((parts) => parts.join(""));
    fc.assert(
      fc.property(fragment, (hash) => {
        expect(typeof parseShareToken(hash)).toBe("string");
      }),
      { numRuns: 100 },
    );
  });

  it("round-trips a token through buildShareUrl", () => {
    // Grapheme strings only: encodeURIComponent rejects lone
    // surrogates outright, and server-issued tokens never contain
    // them (the list-of-stuff-admin precedent). The token is read
    // back from the built URL's hash portion only — parseShareToken's
    // contract, like its one caller, is a location.hash fragment,
    // not a full URL (feeding it the URL was a test-domain error;
    // the counterexample was a single-space token).
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (token) => {
        const url = buildShareUrl("https://example.com/alarm/", token);
        const hash = url.slice(url.indexOf("#"));
        expect(parseShareToken(hash)).toBe(token);
      }),
      { numRuns: 100 },
    );
  });

  it("share expiry helpers never throw and keep their output shapes", () => {
    fc.assert(
      fc.property(anyPayloadValue, fc.integer(), (value, nowMs) => {
        const left = shareSecondsLeft(value, nowMs);
        expect(left === null || (Number.isInteger(left) && left >= 0)).toBe(true);
        expect(typeof formatShareExpiry(value)).toBe("string");
      }),
      { numRuns: 100 },
    );
    fc.assert(
      fc.property(
        fc.date({
          noInvalidDate: true,
          min: new Date(1970, 0, 1),
          max: new Date(2100, 11, 31),
        }),
        (date) => {
          expect(formatShareExpiry(date.toISOString())).toMatch(/^\d{8} \d{2}:\d{2}$/);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("formatShareRemaining never leaks NaN, Infinity or undefined into a label", () => {
    fc.assert(
      fc.property(anyPayloadValue, (value) => {
        const label = formatShareRemaining(value);
        expect(typeof label).toBe("string");
        expect(label).not.toMatch(/NaN|Infinity|undefined/);
      }),
      { numRuns: 100 },
    );
  });

  it("formatShareRemaining produces the known label shapes over plausible seconds", () => {
    // Domain: seconds within a year. Real values come from
    // shareSecondsLeft over actual dates, and issued links expire
    // within 30 days; at unreachable magnitudes (~1e21 days) the
    // count prints in exponential notation — the same
    // unreachable-magnitude class as music-admin's formatDuration,
    // so the strict shape is pinned over the plausible range only.
    fc.assert(
      fc.property(
        fc.double({ min: -86400, max: 366 * 86400, noNaN: true }),
        (seconds) => {
          const label = formatShareRemaining(seconds);
          expect(
            label === "" ||
              label === "期限切れ" ||
              /^残り約\d+(分未満|分|時間|日)$/.test(label),
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("wire command properties", () => {
  it("fromWireCommand and toWireCommand never throw and return strings", () => {
    fc.assert(
      fc.property(anyPayloadValue, (value) => {
        expect(typeof fromWireCommand(value)).toBe("string");
        expect(typeof toWireCommand(value)).toBe("string");
      }),
      { numRuns: 100 },
    );
  });

  it("round-trips path-form commands through the wire form", () => {
    // The first segment is always a command name: fromWireCommand
    // by design leaves a string whose first token is not an ASCII
    // command name unchanged, so a leading flag segment ("-d …")
    // is outside the round-trip domain (a test-domain correction;
    // the counterexample was ["-d", "hue"]).
    const first = fc.constantFrom("hue", "switchbot-command", "youtube-play", "google-home-speaker-wrapper");
    const rest = fc.array(
      fc.constantFrom("lights", "off", "-d", "X1", "turnOff", "-c", "-v", "60"),
      { minLength: 1, maxLength: 5 },
    );
    fc.assert(
      fc.property(first, rest, (head, tail) => {
        const segs = [head, ...tail];
        const path = `/${segs.join("/")}`;
        expect(fromWireCommand(toWireCommand(path))).toBe(path);
        const wire = segs.join(" ");
        expect(toWireCommand(fromWireCommand(wire))).toBe(wire);
      }),
      { numRuns: 100 },
    );
  });

  it("describeCommand always returns a string label", () => {
    fc.assert(
      fc.property(anyPayloadValue, (value) => {
        expect(typeof describeCommand(value, catalog)).toBe("string");
      }),
      { numRuns: 100 },
    );
  });

  it("toExecCurlBlock always returns a string of curl lines", () => {
    fc.assert(
      fc.property(anyPayloadValue, (value) => {
        expect(typeof toExecCurlBlock(value, "https://exec.example.test")).toBe("string");
      }),
      { numRuns: 100 },
    );
    fc.assert(
      fc.property(fc.array(anyPayloadValue, { maxLength: 6 }), (wires) => {
        const block = toExecCurlBlock(wires, "https://exec.example.test");
        for (const line of block.split("\n").filter((l) => l !== "")) {
          expect(line.startsWith('curl -s "')).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("weekday description properties", () => {
  const labelShape = /^$|^毎日$|^平日のみ$|^土日のみ$|^[日月火水木金土](・[日月火水木金土])*$/;

  it("is order- and duplicate-insensitive over day numbers", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -2, max: 9 }), { maxLength: 12 }), (days) => {
        const label = describeWeekdays(days);
        expect(label).toMatch(labelShape);
        expect(describeWeekdays([...days].reverse())).toBe(label);
        expect(describeWeekdays(days.concat(days))).toBe(label);
      }),
      { numRuns: 100 },
    );
  });

  it("never throws and returns a string for any payload value", () => {
    fc.assert(
      fc.property(anyPayloadValue, (value) => {
        expect(typeof describeWeekdays(value)).toBe("string");
      }),
      { numRuns: 100 },
    );
  });
});

describe("time and date conversion properties", () => {
  const pad = (n) => String(n).padStart(2, "0");
  const dateParts = fc.tuple(
    fc.integer({ min: 1000, max: 9999 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  );
  const timeParts = fc.tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }));

  it("round-trips date/time inputs through the API formats", () => {
    fc.assert(
      fc.property(dateParts, timeParts, ([y, mo, d], [h, mi]) => {
        const apiTime = toApiTime(`${y}-${pad(mo)}-${pad(d)}`, `${pad(h)}:${pad(mi)}`);
        expect(apiTime).toBe(`${y}${pad(mo)}${pad(d)}-${pad(h)}:${pad(mi)}`);
        expect(formatApiTime(apiTime)).toBe(`${mo}/${d} ${pad(h)}:${pad(mi)}`);
        const apiDate = toApiDate(`${y}-${pad(mo)}-${pad(d)}`);
        expect(apiDate).toBe(`${y}${pad(mo)}${pad(d)}`);
        expect(formatUntilDate(apiDate)).toBe(`${y}/${pad(mo)}/${pad(d)}`);
      }),
      { numRuns: 100 },
    );
  });

  it("formatApiTime and formatUntilDate always return strings", () => {
    fc.assert(
      fc.property(anyPayloadValue, (value) => {
        expect(typeof formatApiTime(value)).toBe("string");
        expect(typeof formatUntilDate(value)).toBe("string");
      }),
      { numRuns: 100 },
    );
  });

  it("toApiTime and toApiDate reject garbage strings as null", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const t = toApiTime(s, s);
        expect(t === null || /^\d{8}-\d{2}:\d{2}$/.test(t)).toBe(true);
        const d = toApiDate(s);
        expect(d === null || /^\d{8}$/.test(d)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe("speech and YouTube builder properties", () => {
  it("buildSpeechCommand encodes the folded text after the prefix", () => {
    // Grapheme strings only: encodeURIComponent rejects lone
    // surrogates outright, and text typed or pasted into the
    // speech form is well-formed in practice (the same domain
    // narrowing as the share-token round-trip above).
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (text) => {
        const cmd = buildSpeechCommand("/speak/-s/", text);
        expect(cmd.startsWith("/speak/-s/")).toBe(true);
        const folded = text.replace(/\s+/g, "　").trim();
        expect(decodeURIComponent(cmd.slice("/speak/-s/".length))).toBe(folded);
      }),
      { numRuns: 100 },
    );
  });

  it("speechTextWithTime keeps the body and prefixes valid times", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (time, text) => {
        const out = speechTextWithTime(time, text);
        expect(typeof out).toBe("string");
        expect(out.endsWith(text ? text : EMPTY_TEXT_SUFFIX)).toBe(true);
      }),
      { numRuns: 100 },
    );
    const pad = (n) => String(n).padStart(2, "0");
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        fc.string(),
        (h, mi, text) => {
          const out = speechTextWithTime(`${pad(h)}:${pad(mi)}`, text);
          const hour12 = h % 12 || 12;
          const head = `${hour12}時${mi ? `${mi}分` : "ちょうど"}です。`;
          expect(out.startsWith(head)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("parseYouTubeId extracts generated ids and never throws on strings", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9_-]{1,20}$/), (id) => {
        expect(parseYouTubeId(`https://www.youtube.com/watch?v=${id}`)).toBe(id);
        expect(parseYouTubeId(`https://youtu.be/${id}`)).toBe(id);
        expect(parseYouTubeId(`https://www.youtube.com/shorts/${id}`)).toBe(id);
      }),
      { numRuns: 100 },
    );
    fc.assert(
      fc.property(fc.string(), (s) => {
        const id = parseYouTubeId(s);
        expect(id === null || typeof id === "string").toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("withVolume and prefixVolume round-trip the offered steps", () => {
    const prefix = fc
      .integer({ min: 0, max: 100 })
      .map((n) => `/speak/-h/192.0.2.1/-v/${n}/-s/`);
    fc.assert(
      fc.property(prefix, fc.constantFrom(...VOLUME_STEPS), (p, v) => {
        expect(prefixVolume(withVolume(p, v))).toBe(v);
      }),
      { numRuns: 100 },
    );
    fc.assert(
      fc.property(
        prefix,
        fc.integer({ min: -1000, max: 1000 }).filter((v) => v < 0 || v > 100),
        (p, v) => {
          expect(withVolume(p, v)).toBe(p);
        },
      ),
      { numRuns: 100 },
    );
  });
});
