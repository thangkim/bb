import { describe, expect, it } from "vitest";
import { parseTypedUrl } from "./url.js";

describe("parseTypedUrl", () => {
  it("keeps http and https links as typed", () => {
    expect(parseTypedUrl("https://example.com/a?b=1#c")).toBe(
      "https://example.com/a?b=1#c",
    );
    expect(parseTypedUrl("  HTTP://Example.com  ")).toBe("http://example.com/");
  });

  it("opens localhost and IPv4 hosts over http", () => {
    expect(parseTypedUrl("localhost:3000")).toBe("http://localhost:3000/");
    expect(parseTypedUrl("127.0.0.1:8080/health")).toBe(
      "http://127.0.0.1:8080/health",
    );
  });

  it("adds https to www hosts and common top-level domains", () => {
    expect(parseTypedUrl("www.example.museum/x")).toBe(
      "https://www.example.museum/x",
    );
    expect(parseTypedUrl("docs.example.dev")).toBe("https://docs.example.dev/");
    expect(parseTypedUrl("github.com/anthropics?tab=repos")).toBe(
      "https://github.com/anthropics?tab=repos",
    );
  });

  it("leaves file names, paths and plain words to file search", () => {
    for (const text of [
      "",
      "app.tsx",
      "README.md",
      "src/index.ts",
      "docs/guide.dev.md",
      "package.json",
      "open browser",
      "example.com is down",
      "ftp://example.com",
      "javascript:alert(1)",
      "file:///etc/passwd",
    ]) {
      expect(parseTypedUrl(text)).toBeNull();
    }
  });

  it("rejects links with no host", () => {
    expect(parseTypedUrl("https://")).toBeNull();
    expect(parseTypedUrl("localhost:99999999")).toBeNull();
  });
});
