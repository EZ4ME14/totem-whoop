// Persistence layer for Cognito tokens. The TokenManager writes the rotated
// access + refresh tokens after every refresh so server restarts pick up the
// latest state without re-bootstrapping (until the refresh token itself
// expires, ~30 days).
//
// Three implementations:
//   - EnvFileTokenStore: writes to a .env file. Used in local dev and on any
//     host that lets you persist a small file (Fly volumes, Railway disks,
//     a VPS). The default.
//   - UpstashTokenStore: writes to an Upstash Redis key over its REST API. For
//     free hosts with an ephemeral disk (Hugging Face Spaces, Render free) —
//     Cognito rotates the refresh token on every refresh, so without a durable
//     store the first restart after a refresh strands a dead token. Opt in via
//     WHOOP_TOKEN_STORE=upstash + UPSTASH_REDIS_REST_URL / _TOKEN. Several
//     processes (a cloud server and a local stdio one) can share one key.
//   - MemoryTokenStore: no persistence. Used on hosts with read-only file
//     systems (Cloudflare Workers, read-only container disks). Accept that you'll
//     re-bootstrap every 30 days. Opt in via WHOOP_TOKEN_STORE=memory.

import { existsSync, readFileSync } from "node:fs";
import { parse as parseEnv } from "dotenv";
import { upsertEnvFile } from "../lib/env_file.js";

export interface StoredTokens {
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
}

export interface TokenStore {
  save(updates: { accessToken: string; refreshToken: string }): void | Promise<void>;
  /** Optional: re-read persisted tokens (another process may have rotated them). */
  load?(): StoredTokens | null | Promise<StoredTokens | null>;
}

export class EnvFileTokenStore implements TokenStore {
  constructor(private path: string) {}

  save(updates: { accessToken: string; refreshToken: string }): void {
    // Deliberately does nothing when the file is absent (memory-store hosts).
    if (!existsSync(this.path)) return;
    // Shared writer: quotes anything dotenv would otherwise mangle on read-back,
    // preserves comments/unrelated keys, and writes 0600 (see issue #27).
    upsertEnvFile(this.path, {
      WHOOP_IOS_BEARER_TOKEN: updates.accessToken,
      WHOOP_COGNITO_REFRESH_TOKEN: updates.refreshToken,
    });
  }

  load(): StoredTokens | null {
    if (!existsSync(this.path)) return null;
    const env = parseEnv(readFileSync(this.path, "utf8"));
    return { accessToken: env.WHOOP_IOS_BEARER_TOKEN, refreshToken: env.WHOOP_COGNITO_REFRESH_TOKEN };
  }
}

export class UpstashTokenStore implements TokenStore {
  constructor(
    private url: string,
    private token: string,
    private key = "totem:whoop:tokens",
    /** Optional local mirror (the .env) so a later stdio start sees fresh tokens too. */
    private mirror?: EnvFileTokenStore,
  ) {}

  private async command(args: string[]): Promise<unknown> {
    const res = await fetch(this.url.replace(/\/+$/, ""), {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
    if (!res.ok || body.error) throw new Error(`Upstash ${args[0]} failed (${res.status}): ${body.error ?? "no body"}`);
    return body.result;
  }

  async save(updates: { accessToken: string; refreshToken: string }): Promise<void> {
    this.mirror?.save(updates);
    await this.command(["SET", this.key, JSON.stringify({ ...updates, savedAt: new Date().toISOString() })]);
  }

  async load(): Promise<StoredTokens | null> {
    const raw = await this.command(["GET", this.key]);
    if (typeof raw !== "string") return null;
    const parsed = JSON.parse(raw) as StoredTokens;
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
  }
}

export class MemoryTokenStore implements TokenStore {
  save(_updates: { accessToken: string; refreshToken: string }): void {
    // intentionally no-op; tokens persist only for the lifetime of this process
  }
}
