import nodemailer from "nodemailer";
import { config } from "../config.js";

export type MailDelivery = {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
};

export function createDefaultMailDelivery(): MailDelivery {
  if (!config.smtp.host) {
    return {
      async sendMail(msg) {
        console.log(`[Notification Delivery Local Log] To: ${msg.to} | Subject: ${msg.subject}`);
        return {};
      }
    };
  }
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    requireTLS: true,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    ...(config.smtp.user ? { auth: { user: config.smtp.user, pass: config.smtp.pass } } : {})
  });
}
