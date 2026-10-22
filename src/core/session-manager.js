/**
 * Talde Hemendik! — Core Session Manager (REV-02)
 * Propietario único de credenciales, identificador de sesión y épocas de credencial.
 * Regla M01: 401 sobre credencial activa expira sesión; 401 de sesión obsoleta o unauth OTP no.
 */

export class SessionManager {
  constructor(initial = {}) {
    this.currentSessionId = initial.currentSessionId || null;
    this.credentialEpoch = initial.credentialEpoch || 0;
    this.accessToken = initial.accessToken || null;
    this.appMode = initial.appMode || null;
  }

  getCurrentSessionId() {
    return this.currentSessionId;
  }

  getCredentialEpoch() {
    return this.credentialEpoch;
  }

  getToken() {
    return this.accessToken;
  }

  getAppMode() {
    return this.appMode;
  }

  setSession(sessionId, token, mode = "BETA_NORMAL") {
    this.currentSessionId = sessionId ? String(sessionId) : null;
    this.accessToken = token ? String(token) : null;
    this.appMode = mode;
    this.credentialEpoch += 1;
  }

  clearSession() {
    this.currentSessionId = null;
    this.accessToken = null;
    this.appMode = null;
    this.credentialEpoch += 1;
  }

  /**
   * Evalúa si un error 401 debe expirar la sesión activa.
   * @param {Object} [dispatchScope] - El scope capturado al momento del despacho.
   * @param {boolean} [isUserAuthenticated=true] - Si la petición se realizó bajo autenticación.
   * @returns {boolean} true si la sesión activa fue expirada; false si fue ignorado/obsoleto.
   */
  handleUnauthorized(dispatchScope = null, isUserAuthenticated = true) {
    if (!isUserAuthenticated) {
      // Unauth OTP failure or public endpoint 401: no-op para la sesión activa
      return false;
    }

    if (dispatchScope) {
      if (dispatchScope.credentialEpoch !== undefined && dispatchScope.credentialEpoch !== this.credentialEpoch) {
        return false;
      }
      // Petición originada en otra sesión distinta ya reemplazada: la nueva sesión sobrevive
      const reqSession = dispatchScope.sessionId || dispatchScope.currentSessionId || null;
      if (reqSession && this.currentSessionId && reqSession !== this.currentSessionId) {
        return false;
      }
      const reqToken = dispatchScope.bearerToken || dispatchScope.requestToken || dispatchScope.token || null;
      if (reqToken && this.accessToken && reqToken !== this.accessToken) {
        return false;
      }
    }

    // Misma sesión o credencial activa: expira de inmediato
    if (this.currentSessionId !== null || this.accessToken !== null) {
      this.clearSession();
      return true;
    }

    return false;
  }
}
