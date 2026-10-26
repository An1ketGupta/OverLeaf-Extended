import nodemailer from "nodemailer";
import type { Config } from "./config.js";

export function createMailer(config: Config) {
  const pending = new Set<Promise<void>>();
  const transport = nodemailer.createTransport({
    host: "127.0.0.1",
    port: config.MAIL_PORT,
    secure: false,
    ignoreTLS: true,
    connectionTimeout: 3000,
    greetingTimeout: 3000,
    socketTimeout: 5000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    send: async (to: string, url: string, kind: "verify" | "reset") => {
      // Queue acceptance is independent of SMTP timing and recipient existence.
      // This is bounded process-local work, not durable email delivery.
      if (config.MAIL_ENABLED !== "true" || pending.size >= 20) return;
      const task = transport
        .sendMail({
          from: "OverLeaf-Pro <accounts@overleaf-pro.test>",
          to,
          subject:
            kind === "verify" ? "Verify your email" : "Reset your password",
          text: `${kind === "verify" ? "Verify your email" : "Reset your password"} for OverLeaf-Pro. This link expires in one hour.\n\n${url}\n\nIf you did not request this, ignore this message.`,
        })
        .then(() => undefined)
        .catch(() => {
          // Never include SMTP errors, recipients, URLs or message bodies.
          console.warn(
            "Local account email delivery failed. Check the local inbox service and retry.",
          );
        });
      pending.add(task);
      void task.finally(() => pending.delete(task));
    },
    drain: async () => {
      await Promise.allSettled([...pending]);
      transport.close();
    },
  };
}
