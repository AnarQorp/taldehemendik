const isProduction = process.env.NODE_ENV === "production";
const localOrigins = ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8000", "http://127.0.0.1:8000", "http://localhost:5173", "http://127.0.0.1:5173"];
export const config = {
  isProduction,
  databaseUrl: process.env.DATABASE_URL ?? "postgres://talde:talde_dev_only@127.0.0.1:55433/taldehemendik",
  authDatabaseUrl: process.env.AUTH_DATABASE_URL ?? process.env.DATABASE_URL,
  workerDatabaseUrl: process.env.WORKER_DATABASE_URL ?? process.env.OUTBOX_DATABASE_URL ?? process.env.DATABASE_URL,
  outboxDatabaseUrl: process.env.OUTBOX_DATABASE_URL ?? process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL,
  migrationDatabaseUrl: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  port: Number(process.env.PORT ?? 3101),
  exposeOtp: !isProduction && process.env.DEV_AUTH_EXPOSE_OTP === "true",
  devResetEnabled: !isProduction && process.env.DEV_RESET_ENABLED === "true",
  authSecret: isProduction ? process.env.AUTH_TOKEN_SECRET ?? "" : process.env.DEV_AUTH_TOKEN_SECRET ?? "development-only-secret-change-before-shared-use",
  authTokenIssuer: process.env.AUTH_TOKEN_ISSUER ?? "talde-hemendik",
  authTokenAudience: process.env.AUTH_TOKEN_AUDIENCE ?? "talde-private-api",
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",").map(value => value.trim()).filter(Boolean) ?? (isProduction ? [] : localOrigins),
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM ?? ""
  }
};

export function assertProductionConfiguration() {
  if (!config.isProduction) return;
  if (!process.env.DATABASE_URL || !process.env.AUTH_DATABASE_URL) throw new Error("Production requires separate DATABASE_URL and AUTH_DATABASE_URL");
  if (config.authSecret.length < 32 || /development|change.?me|example|dev.only/i.test(config.authSecret)) throw new Error("AUTH_TOKEN_SECRET must be a unique random secret of at least 32 characters");
  if (!config.smtp.host || !config.smtp.from || !Number.isInteger(config.smtp.port) || config.smtp.port < 1 || config.smtp.port > 65535) throw new Error("Production requires valid SMTP_HOST, SMTP_PORT and SMTP_FROM");
  if (Boolean(config.smtp.user) !== Boolean(config.smtp.pass)) throw new Error("SMTP_USER and SMTP_PASSWORD must be configured together");
  if (process.env.DEV_AUTH_EXPOSE_OTP === "true" || process.env.DEV_RESET_ENABLED === "true") throw new Error("Development authentication/endpoints cannot be enabled in production");
}
