// Entorno de ejecución
const isProduction = process.env.NODE_ENV === "production";

/**
 * Configuración del Backend Talde Hemendik!
 *
 * ATENCIÓN - HERRAMIENTAS EXCLUSIVAS DE DESARROLLO / DEMO:
 * - exposeOtp: Entrega el OTP directamente en la respuesta HTTP para agilizar tests y pruebas en APK local.
 * - enableDevEndpoints: Habilita el endpoint POST /v1/dev/reset para reiniciar el dataset a estado limpio.
 * Ambos están terminantemente bloqueados si NODE_ENV === 'production' (Fail Closed).
 */
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://talde:talde_dev_only@127.0.0.1:55433/taldehemendik",
  port: Number(process.env.PORT ?? 3101),
  exposeOtp: !isProduction && process.env.DEV_AUTH_EXPOSE_OTP === "true",
  enableDevEndpoints: !isProduction && process.env.ENABLE_DEV_ENDPOINTS === "true",
  authSecret: process.env.DEV_AUTH_TOKEN_SECRET ?? "development-only-secret-change-before-shared-use"
};
