/**
 * Talde Hemendik! - Configuración Centralizada de API y Dataset Maestro
 *
 * Jerarquía de resolución para API_BASE_URL:
 * 1. window.__TALDE_API_URL__ (inyección runtime global / capacitor / tag HTML)
 * 2. localStorage.getItem("TALDE_API_BASE_URL") (ajuste dinámico en testing LAN / APK)
 * 3. process.env.API_BASE_URL / process.env.TALDE_API_URL (Node / testing suite)
 * 4. "http://127.0.0.1:3101/v1" (valor por defecto desarrollo local)
 */

export const MASTER_DATASET = {
  CLUB_NAME: "C.D. Indautxu",
  TEAM_NAME: "Infantil A",
  SEASON: "2026/27",
  INVITE_CODE: "INDA16",
  MAIN_EVENT_NAME: "Torneo Indautxu",
  VENUE: "Polideportivo Municipal Indautxu",
  COACH: {
    NAME: "Mikel Zubeldia",
    EMAIL: "mikel@example.test"
  },
  GUARDIAN: {
    NAME: "Elena Gómez",
    EMAIL: "elena@example.test"
  },
  PLAYER: {
    NAME: "Ibai Aranguren",
    NUMBER: 9,
    ROLE: "Delantero Centro"
  },
  SUBSTITUTE: {
    NAME: "Ane Mintegi",
    NUMBER: 16,
    ROLE: "Centrocampista"
  }
};

export function resolveApiBaseUrl() {
  if (typeof window !== "undefined") {
    if (window.__TALDE_API_URL__) {
      return window.__TALDE_API_URL__.replace(/\/$/, "");
    }
    try {
      const stored = window.localStorage?.getItem("TALDE_API_BASE_URL");
      if (stored) return stored.replace(/\/$/, "");
    } catch {
      // Ignorar excepciones si cookies/localStorage están bloqueados
    }
  }

  if (typeof process !== "undefined" && process?.env) {
    if (process.env.API_BASE_URL) return process.env.API_BASE_URL.replace(/\/$/, "");
    if (process.env.TALDE_API_URL) return process.env.TALDE_API_URL.replace(/\/$/, "");
  }

  return "http://127.0.0.1:3101/v1";
}

export const API_BASE_URL = resolveApiBaseUrl();

export function setApiBaseUrl(newUrl) {
  const cleaned = newUrl.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    window.__TALDE_API_URL__ = cleaned;
    try {
      window.localStorage?.setItem("TALDE_API_BASE_URL", cleaned);
    } catch {
      // no-op
    }
  }
  return cleaned;
}
