import { z } from "zod";

const loginResponseSchema = z.object({
  accessToken: z.string(),
  accessExpiresAt: z.number(),
  user: z.object({ id: z.string(), username: z.string(), totpEnabled: z.boolean(), bootstrapPending: z.boolean() }),
});
const refreshResponseSchema = z.object({ accessToken: z.string(), accessExpiresAt: z.number() });
const devicesResponseSchema = z.object({
  devices: z.array(z.object({
    id: z.string(),
    name: z.string(),
    publicKey: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })),
});
const accountSchema = z.object({
  user: z.object({ id: z.string(), username: z.string(), totpEnabled: z.boolean(), bootstrapPending: z.boolean() }),
});
const totpSetupSchema = z.object({ secret: z.string(), otpauthUri: z.string(), expiresAt: z.number() });

export type Account = z.infer<typeof accountSchema>["user"];

export interface WebSession {
  accessToken: string;
  accessExpiresAt: number;
  user: Account;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

async function parseError(response: Response): Promise<ApiError> {
  let code = `http_${response.status}`;
  try {
    const value: unknown = await response.json();
    if (typeof value === "object" && value !== null && "error" in value && typeof value.error === "string") {
      code = value.error;
    }
  } catch {
    // The status code remains the stable fallback when the body is not JSON.
  }
  return new ApiError(response.status, code);
}

export class ApiClient {
  private accessToken: string | undefined;

  setAccessToken(token: string | undefined): void {
    this.accessToken = token;
  }

  async login(username: string, password: string, totp?: string): Promise<WebSession> {
    const response = await fetch("/api/v1/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password, ...(totp ? { totp } : {}), clientType: "web" }),
    });
    if (!response.ok) throw await parseError(response);
    const result = loginResponseSchema.parse(await response.json());
    this.accessToken = result.accessToken;
    return result;
  }

  async refresh(): Promise<{ accessToken: string; accessExpiresAt: number }> {
    const response = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw await parseError(response);
    const result = refreshResponseSchema.parse(await response.json());
    this.accessToken = result.accessToken;
    return result;
  }

  async logout(all = false): Promise<void> {
    if (!this.accessToken) return;
    const response = await this.authorizedFetch(all ? "/api/v1/auth/logout-all" : "/api/v1/auth/logout", { method: "POST" });
    this.accessToken = undefined;
    if (!response.ok && response.status !== 401) throw await parseError(response);
  }

  async getAccount(): Promise<Account> {
    const response = await this.authorizedFetch("/api/v1/account");
    if (!response.ok) throw await parseError(response);
    return accountSchema.parse(await response.json()).user;
  }

  async updateCredentials(body: { currentPassword: string; newUsername?: string; newPassword?: string; totp?: string }): Promise<Account> {
    const response = await this.authorizedFetch("/api/v1/account/credentials", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    if (!response.ok) throw await parseError(response);
    return accountSchema.parse(await response.json()).user;
  }

  async setupTotp(currentPassword: string, totp?: string): Promise<z.infer<typeof totpSetupSchema>> {
    const response = await this.authorizedFetch("/api/v1/account/totp/setup", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, ...(totp ? { totp } : {}) }),
    });
    if (!response.ok) throw await parseError(response);
    return totpSetupSchema.parse(await response.json());
  }

  async confirmTotp(code: string): Promise<Account> {
    const response = await this.authorizedFetch("/api/v1/account/totp/confirm", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }),
    });
    if (!response.ok) throw await parseError(response);
    return accountSchema.parse(await response.json()).user;
  }

  async disableTotp(currentPassword: string, totp: string): Promise<Account> {
    const response = await this.authorizedFetch("/api/v1/account/totp", {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword, totp }),
    });
    if (!response.ok) throw await parseError(response);
    return accountSchema.parse(await response.json()).user;
  }

  async listDevices(): Promise<z.infer<typeof devicesResponseSchema>["devices"]> {
    const response = await this.authorizedFetch("/api/v1/devices");
    if (!response.ok) throw await parseError(response);
    return devicesResponseSchema.parse(await response.json()).devices;
  }

  async renameDevice(id: string, name: string): Promise<void> {
    const response = await this.authorizedFetch(`/api/v1/devices/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) throw await parseError(response);
  }

  async revokeDevice(id: string): Promise<void> {
    const response = await this.authorizedFetch(`/api/v1/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) throw await parseError(response);
  }

  private authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.accessToken) throw new ApiError(401, "missing_access_token");
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.accessToken}`);
    return fetch(path, { ...init, headers, credentials: "include" });
  }
}
