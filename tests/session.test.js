import { describe, it, expect } from "vitest";
import {
  SESSION_TOKEN_STORAGE_KEY,
  loadSavedSessionToken,
  saveSessionToken,
  loadSavedSessionEmail,
  saveSessionEmail,
  clearSavedSession,
  sessionKey,
} from "../src/session.js";

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    map,
  };
}

describe("session storage", () => {
  it("round-trips the session token and email", () => {
    const storage = fakeStorage();
    saveSessionToken("sess-1", storage, false);
    saveSessionEmail("owner@example.com", storage, false);
    expect(storage.map.get("alarm-session-token")).toBe("sess-1");
    expect(loadSavedSessionToken(storage, false)).toBe("sess-1");
    expect(loadSavedSessionEmail(storage, false)).toBe("owner@example.com");
  });

  it("clears both values", () => {
    const storage = fakeStorage();
    saveSessionToken("sess-1", storage, false);
    saveSessionEmail("owner@example.com", storage, false);
    clearSavedSession(storage, false);
    expect(loadSavedSessionToken(storage, false)).toBe("");
    expect(loadSavedSessionEmail(storage, false)).toBe("");
  });

  it("keeps staging and production sessions apart", () => {
    const storage = fakeStorage();
    saveSessionToken("prod", storage, false);
    saveSessionToken("staging", storage, true);
    expect(sessionKey(SESSION_TOKEN_STORAGE_KEY, true)).toBe("alarm-session-token:staging");
    expect(loadSavedSessionToken(storage, false)).toBe("prod");
    expect(loadSavedSessionToken(storage, true)).toBe("staging");
    clearSavedSession(storage, true);
    expect(loadSavedSessionToken(storage, false)).toBe("prod");
  });

  it("tolerates unavailable storage", () => {
    const throwing = {
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("denied"); },
      removeItem() { throw new Error("denied"); },
    };
    expect(loadSavedSessionToken(throwing, false)).toBe("");
    expect(() => saveSessionToken("t", throwing, false)).not.toThrow();
    expect(() => clearSavedSession(throwing, false)).not.toThrow();
  });
});
