import { describe, it, expect, vi, afterEach } from "vitest";
import { TokenManager } from "../../src/whoop/token_manager.js";
import { UpstashTokenStore } from "../../src/whoop/token_store.js";

const jwt = (exp: number) =>
  `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;

afterEach(() => vi.unstubAllGlobals());

describe("TokenManager adopts tokens persisted by another process", () => {
  it("uses a fresher persisted access token instead of refreshing", async () => {
    const fresh = jwt(Math.floor(Date.now() / 1000) + 3600);
    const store = { save: () => { throw new Error("should not refresh"); }, load: async () => ({ accessToken: fresh, refreshToken: "rt2" }) };
    const tm = new TokenManager({ email: "x@y.z", accessToken: jwt(1), refreshToken: "rt1", store });
    expect(await tm.getToken()).toBe(fresh);
  });
});

describe("UpstashTokenStore", () => {
  it("round-trips tokens through the Upstash REST API", async () => {
    const db = new Map<string, string>();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
      const [cmd, key, value] = JSON.parse(String(init.body)) as string[];
      if (cmd === "SET") db.set(key!, value!);
      const result = cmd === "GET" ? (db.get(key!) ?? null) : "OK";
      return new Response(JSON.stringify({ result }), { status: 200 });
    }));
    const store = new UpstashTokenStore("https://example.upstash.io/", "tok");
    expect(await store.load()).toBeNull();
    await store.save({ accessToken: "a1", refreshToken: "r1" });
    expect(await store.load()).toEqual({ accessToken: "a1", refreshToken: "r1" });
  });

  it("surfaces Upstash errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "WRONGPASS" }), { status: 401 })));
    await expect(new UpstashTokenStore("https://x", "bad").load()).rejects.toThrow(/WRONGPASS/);
  });
});
