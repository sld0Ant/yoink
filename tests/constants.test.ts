import { describe, it, expect } from "bun:test";
import { CDN_HOSTNAMES, USER_AGENT, ANSI } from "../src/constants";

describe("CDN_HOSTNAMES", () => {
  it("is a Set", () => {
    expect(CDN_HOSTNAMES).toBeInstanceOf(Set);
  });

  it("contains known CDNs", () => {
    expect(CDN_HOSTNAMES.has("cdnjs.cloudflare.com")).toBe(true);
    expect(CDN_HOSTNAMES.has("fonts.googleapis.com")).toBe(true);
    expect(CDN_HOSTNAMES.has("unpkg.com")).toBe(true);
  });

  it("does not match partial hostnames like rbcdn.ru", () => {
    expect(CDN_HOSTNAMES.has("static.rbcdn.ru")).toBe(false);
    expect(CDN_HOSTNAMES.has("rbcdn.ru")).toBe(false);
  });
});

describe("USER_AGENT", () => {
  it("looks like a Chrome browser", () => {
    expect(USER_AGENT).toContain("Chrome");
    expect(USER_AGENT).toContain("Mozilla");
  });
});

describe("ANSI", () => {
  it("has required escape codes", () => {
    expect(ANSI.reset).toBe("\x1b[0m");
    expect(ANSI.bold).toBe("\x1b[1m");
    expect(ANSI.red).toContain("\x1b[");
  });
});
