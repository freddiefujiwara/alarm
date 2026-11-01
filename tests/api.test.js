import { describe, expect, it, vi } from "vitest";
import { callApi } from "../src/api.js";

describe("callApi", () => {
  it("posts JSON with the ID token merged into the body", async () => {
    const fetchImpl = vi.fn(async () => ({ json: async () => ({ ok: true, alarms: [] }) }));
    const res = await callApi("https://example.com/exec", "token-1", { action: "list" }, fetchImpl);
    expect(res).toEqual({ ok: true, alarms: [] });
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://example.com/exec");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toContain("text/plain");
    expect(JSON.parse(options.body)).toEqual({ idToken: "token-1", action: "list" });
  });
});
