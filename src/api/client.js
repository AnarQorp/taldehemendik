import { DomainError } from "./errors.js";
import { API_BASE_URL } from "./config.js";

function findHeaderKey(headers, target) {
  if (!headers || typeof headers !== "object") return null;
  const targetLower = target.toLowerCase();
  return Object.keys(headers).find(k => k.toLowerCase() === targetLower) || null;
}

export class ApiClient {
  constructor(baseUrl = API_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = null;
    this.sessionContext = null;
    this.appMode = "BETA_NORMAL";
  }

  setAppMode(mode) {
    this.appMode = mode || "BETA_NORMAL";
  }

  getAppMode() {
    return this.appMode;
  }

  setToken(token) {
    this.token = token;
  }

  getToken() {
    return this.token;
  }

  setSessionContext(sessionContext) {
    this.sessionContext = sessionContext ? { ...sessionContext } : null;
  }

  getSessionContext() {
    return this.sessionContext;
  }

  async request(path, options = {}) {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = {
      ...(options.headers || {})
    };

    const existingAuthKey = findHeaderKey(headers, "authorization");
    if (this.token && !existingAuthKey) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const existingContentType = findHeaderKey(headers, "content-type");
    if (options.body && !existingContentType) {
      headers["Content-Type"] = "application/json";
    }

    const existingIdempotency = findHeaderKey(headers, "idempotency-key");
    if (options.idempotencyKey && !existingIdempotency) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    const activeAuthKey = findHeaderKey(headers, "authorization");
    const dispatchToken = activeAuthKey ? headers[activeAuthKey].replace(/^Bearer\s+/i, "") : (this.token || null);
    const dispatchSessionId = options.scope?.sessionId || options.sessionId || options.sessionContext?.sessionId || this.sessionContext?.sessionId || null;
    const dispatchCredentialEpoch = options.scope?.credentialEpoch ?? options.credentialEpoch ?? options.sessionContext?.credentialEpoch ?? this.sessionContext?.credentialEpoch ?? null;

    const cleanPath = (path.split("?")[0] || "").replace(/\/+$/, "");
    const publicAuthPaths = new Set(["/auth/otp/request", "/auth/otp/verify"]);
    const isPublicAuth = publicAuthPaths.has(cleanPath);

    const fetchOptions = {
      method: options.method || "GET",
      headers,
      body: options.body ? (typeof options.body === "string" ? options.body : JSON.stringify(options.body)) : undefined,
      signal: options.signal
    };

    let response;
    try {
      response = await fetch(url, fetchOptions);
    } catch (networkError) {
      if (networkError.name === "AbortError" || options.signal?.aborted) {
        throw networkError;
      }
      throw new DomainError("NETWORK_ERROR", `No se pudo conectar con el servidor: ${networkError.message}`, 0);
    }

    let data = null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        data = await response.json();
      } catch (err) {
        data = null;
      }
    } else {
      const text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
    }

    if (!response.ok) {
      const errPayload = data?.error || {};
      const code = errPayload.code || `HTTP_${response.status}`;
      const message = errPayload.message || (typeof data === "string" ? data : response.statusText);
      const details = errPayload.issues || data;
      const err = new DomainError(code, message, response.status, details);
      err.wasAuthenticated = !isPublicAuth && Boolean(activeAuthKey && headers[activeAuthKey]);
      err.path = path;
      err.requestToken = dispatchToken;
      err.requestSessionId = dispatchSessionId;
      err.requestCredentialEpoch = dispatchCredentialEpoch;
      err.scope = options.scope || options.sessionContext || (dispatchSessionId ? { sessionId: dispatchSessionId, credentialEpoch: dispatchCredentialEpoch } : null);
      err.sessionContext = options.sessionContext || options.context || (dispatchSessionId ? { sessionId: dispatchSessionId, credentialEpoch: dispatchCredentialEpoch } : null);
      throw err;
    }

    return data;
  }

  get(path, options = {}) {
    return this.request(path, { ...options, method: "GET" });
  }

  post(path, body, options = {}) {
    return this.request(path, { ...options, method: "POST", body });
  }

  put(path, body, options = {}) {
    return this.request(path, { ...options, method: "PUT", body });
  }

  patch(path, body, options = {}) {
    return this.request(path, { ...options, method: "PATCH", body });
  }

  delete(path, options = {}) {
    return this.request(path, { ...options, method: "DELETE" });
  }
}

export const defaultClient = new ApiClient();
