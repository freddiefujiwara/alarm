import { describe, expect, it } from "vitest";
import { decodeJwtPayload } from "./auth.js";

describe("decodeJwtPayload", () => {
  it("decodes the payload segment of a JWT", () => {
    const payload = { email: "owner@example.com", sub: "123" };
    const segment = btoa(JSON.stringify(payload))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeJwtPayload(`header.${segment}.signature`)).toEqual(payload);
  });
});
