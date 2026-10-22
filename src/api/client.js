import { DomainError } from "./errors.js";
import { API_BASE_URL } from "./config.js";

export class ApiClient {
  constructor(baseUrl = API_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = null;
    this.sessionContext = null;
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

    if (this.token && !headers["Authorization"]) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    if (options.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    const dispatchSessionId = options.scope?.sessionId || options.sessionId || options.sessionContext?.sessionId || this.sessionContext?.sessionId || null;
    const dispatchCredentialEpoch = options.scope?.credentialEpoch ?? options.credentialEpoch ?? options.sessionContext?.credentialEpoch ?? this.sessionContext?.credentialEpoch ?? null;
    const dispatchToken = headers["Authorization"] ? headers["Authorization"].replace(/^Bearer\s+/i, "") : (this.token || null);

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
      const isOtpAuthEndpoint = path.includes("/auth/otp/verify") || path.includes("/auth/otp/request") || path.includes("/auth/dev/login");
      err.wasAuthenticated = !isOtpAuthEndpoint && Boolean(headers["Authorization"]);
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
