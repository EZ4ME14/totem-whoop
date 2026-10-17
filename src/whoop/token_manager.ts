// Holds the current access token + refresh token, auto-refreshes via Cognito
// when the access token is within `refreshSkewSeconds` of expiry. Writes
// rotated tokens to an injected TokenStore so server restarts pick up fresh
// state without re-bootstrapping.
import { decodeJwtExp, refreshCognitoSession } from "./cognito.js";
import { EnvFileTokenStore, type StoredTokens, type TokenStore } from "./token_store.js";

export interface TokenManagerConfig {
  email: string;
  accessToken: string;
  refreshToken: string;
  /** How many seconds before exp to preemptively refresh. Default 60. */
  refreshSkewSeconds?: number;
  /**
   * Where to persist rotated tokens. Pass `EnvFileTokenStore(path)` (default
   * when `envPath` is given) or `MemoryTokenStore` for ephemeral hosts.
   */
  store?: TokenStore;
  /** Convenience: provide envPath instead of `store` to get the default file store. */
  envPath?: string;
}

export class TokenManager {
  private email: string;
  private accessToken: string;
  private refreshToken: string;
  private expiresAt: number; // epoch ms
  private skewMs: number;
  private store: TokenStore;
  private refreshing: Promise<void> | null = null;

  constructor(config: TokenManagerConfig) {
    this.email = config.email;
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.skewMs = (config.refreshSkewSeconds ?? 60) * 1000;
    this.expiresAt = decodeJwtExp(config.accessToken) * 1000;
    if (config.store) {
      this.store = config.store;
    } else if (config.envPath) {
      this.store = new EnvFileTokenStore(config.envPath);
    } else {
      throw new Error("TokenManager: pass either `store` or `envPath`");
    }
  }

  async getToken(): Promise<string> {
    if (this.isFresh()) return this.accessToken;
    // Single-flight: if a refresh is already running, wait on it
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    await this.refreshing;
    return this.accessToken;
  }

  private isFresh(): boolean {
    return Date.now() < this.expiresAt - this.skewMs;
  }

  // Several server processes (desktop chat, scheduled reports) can share one
  // .env. Cognito rotates the refresh token, so a long-lived process may hold a
  // stale one — adopt whatever another process last persisted before refreshing.
  // Returns true when it picked up a different refresh token.
  private async adoptPersisted(): Promise<boolean> {
    let saved: StoredTokens | null = null;
    try {
      saved = (await this.store.load?.()) ?? null;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[totem] could not re-read persisted tokens: ${detail}`);
      return false;
    }
    let adoptedRefresh = false;
    if (saved?.refreshToken && saved.refreshToken !== this.refreshToken) {
      this.refreshToken = saved.refreshToken;
      adoptedRefresh = true;
    }
    if (saved?.accessToken && saved.accessToken !== this.accessToken) {
      try {
        const exp = decodeJwtExp(saved.accessToken) * 1000;
        if (exp > this.expiresAt) {
          this.accessToken = saved.accessToken;
          this.expiresAt = exp;
        }
      } catch {
        // malformed persisted token — ignore and refresh normally
      }
    }
    return adoptedRefresh;
  }

  private async doRefresh(): Promise<void> {
    await this.adoptPersisted();
    if (this.isFresh()) return;
    let next;
    try {
      next = await refreshCognitoSession(this.email, this.refreshToken);
    } catch (error) {
      // Another process may have rotated the refresh token between our read and
      // our refresh. Re-read once; retry only if the stored token changed.
      if (!(await this.adoptPersisted())) throw error;
      if (this.isFresh()) return;
      next = await refreshCognitoSession(this.email, this.refreshToken);
    }
    this.accessToken = next.accessToken;
    // Cognito may rotate the refresh token; if it does, persist the new one.
    if (next.refreshToken && next.refreshToken !== this.refreshToken) {
      this.refreshToken = next.refreshToken;
      // Observable so a memory-store (non-persisting) deploy can tell when a
      // restart would strand the old token. See SECURITY.md → token hygiene.
      console.error("[totem] Cognito rotated the refresh token — persisting the new one.");
    }
    this.expiresAt = next.expiresAt;
    try {
      await this.store.save({ accessToken: this.accessToken, refreshToken: this.refreshToken });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[totem] refreshed the Whoop access token but could not persist it: ${detail}. This process will keep using the fresh in-memory token.`);
    }
  }
}
