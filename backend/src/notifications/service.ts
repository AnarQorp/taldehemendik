import type pg from "pg";
import type { MailDelivery } from "./delivery.js";
import { config } from "../config.js";

export class NotificationService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly delivery: MailDelivery,
    private readonly from: string = config.smtp.from || "notificaciones@taldehemendik.test"
  ) {}

  /**
   * Notifies all active members of the team when an official notice is published.
   * Privacy guarantee: No minor's personal data or sensitive health info is included.
   */
  async notifyTeamNotice(teamSeasonId: string, authorUserId: string, title: string, urgent: boolean): Promise<number> {
    try {
      const members = await this.pool.query<{ email: string; display_name: string }>(
        `SELECT DISTINCT u.email, u.display_name
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.team_season_id = $1 AND m.status = 'ACTIVE' AND u.id <> $2 AND u.email IS NOT NULL`,
        [teamSeasonId, authorUserId]
      );

      const prefix = urgent ? "[URGENTE] " : "";
      const subject = `${prefix}Talde Hemendik! — Nuevo aviso del equipo`;
      const text = `Hola,\n\nEl cuerpo técnico ha publicado un aviso oficial en Talde Hemendik!:\n\n"${title}"\n\nPuedes consultar el contenido completo y todos los detalles accediendo a la aplicación con tu correo electrónico.\n\nAtentamente,\nCuerpo Técnico\nTalde Hemendik!`;

      let delivered = 0;
      for (const member of members.rows) {
        if (!member.email) continue;
        try {
          await this.delivery.sendMail({
            from: this.from,
            to: member.email,
            subject,
            text
          });
          delivered++;
        } catch (err: any) {
          console.error(`Failed to deliver notice email to ${member.email}:`, err?.message || err);
        }
      }
      return delivered;
    } catch (err) {
      console.error("Failed to process team notice notifications:", err);
      return 0;
    }
  }

  /**
   * Notifies active guardians of a specific player when a coach creates a direct note.
   * Privacy guarantee: The message content and minor details are strictly omitted from unencrypted transit.
   */
  async notifyPlayerDirectMessage(teamSeasonId: string, playerId: string): Promise<number> {
    try {
      const guardians = await this.pool.query<{ email: string; display_name: string }>(
        `SELECT DISTINCT u.email, u.display_name
         FROM guardian_links gl
         JOIN users u ON u.id = gl.guardian_user_id
         WHERE gl.player_id = $1 AND gl.status = 'ACTIVE' AND u.email IS NOT NULL`,
        [playerId]
      );

      const subject = "Talde Hemendik! — Nueva comunicación privada del cuerpo técnico";
      const text = `Hola,\n\nEl cuerpo técnico ha registrado una nueva comunicación privada para tu familia en Talde Hemendik!.\n\nPor seguridad y estricta protección de la privacidad del menor, el contenido no se envía a través de correo electrónico sin cifrar. Por favor, accede a la aplicación con tu correo para consultarla de forma confidencial.\n\nAtentamente,\nCuerpo Técnico\nTalde Hemendik!`;

      let delivered = 0;
      for (const guardian of guardians.rows) {
        if (!guardian.email) continue;
        try {
          await this.delivery.sendMail({
            from: this.from,
            to: guardian.email,
            subject,
            text
          });
          delivered++;
        } catch (err: any) {
          console.error(`Failed to deliver direct message email to ${guardian.email}:`, err?.message || err);
        }
      }
      return delivered;
    } catch (err) {
      console.error("Failed to process player direct message notifications:", err);
      return 0;
    }
  }
}
