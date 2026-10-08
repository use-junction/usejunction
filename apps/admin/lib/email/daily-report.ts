import { Resend } from "resend";
import { credentialFingerprint } from "@/lib/security";
import { logServerError } from "@/lib/errors/public";
import { buildDailyReportEmailDocument } from "@/lib/email/daily-report-html";
import { buildDailyReportPdfHtml } from "@/lib/email/daily-report-pdf";
import { renderHtmlToPdf } from "@/lib/email/render-pdf";
import {
  UndeliverableEmailRecipientError,
  isResendUndeliverableToError,
  isUndeliverableEmailRecipient,
} from "@/lib/email/recipient";
import type { DailyReportPayload } from "@/lib/reports/daily-report";
import { getPublicAppUrl } from "@/lib/public-url";

export function reportsEmailFrom() {
  return (
    process.env.REPORTS_EMAIL_FROM ??
    (process.env.NODE_ENV === "production"
      ? "UseJunction <reporting@usejunction.dev>"
      : "UseJunction <onboarding@resend.dev>")
  );
}

export function buildDailyReportEmail(input: {
  report: DailyReportPayload;
  recipientName?: string | null;
}) {
  return buildDailyReportEmailDocument({
    ...input,
    appOrigin: getPublicAppUrl(),
  });
}

export function buildReportEmailText(input: {
  report: DailyReportPayload;
  recipientName?: string | null;
}) {
  const { report } = input;
  const isTeamWeek = report.kind === "org" && report.period === "week";
  const first = input.recipientName?.trim().split(/\s+/)[0];
  const greeting = first ? `Hi ${first},` : "Hi,";
  const blurb = isTeamWeek
    ? "Please find your team's AI use report for this week attached as a PDF."
    : report.kind === "org"
      ? "Please find your team's AI use report for today attached as a PDF."
      : "Please find your AI use report for today attached as a PDF.";

  return [
    greeting,
    "",
    blurb,
    "",
    "Best regards,",
    "Junction AI Assistant",
    "AI Analytics Team",
  ].join("\n");
}

export async function sendDailyReportEmail(input: {
  to: string;
  report: DailyReportPayload;
  recipientName?: string | null;
}) {
  if (isUndeliverableEmailRecipient(input.to)) {
    console.info(`[daily report email] skipped undeliverable recipient to=${input.to}`);
    throw new UndeliverableEmailRecipientError(input.to);
  }

  const appOrigin = getPublicAppUrl();
  const pdfDoc = buildDailyReportPdfHtml({
    report: input.report,
    recipientName: input.recipientName,
    appOrigin,
  });
  const pdfBuffer = await renderHtmlToPdf(pdfDoc.html);
  const text = buildReportEmailText({
    report: input.report,
    recipientName: input.recipientName,
  });

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(
      `[daily report email] RESEND_API_KEY not set; subject=${pdfDoc.subject} to=${input.to} pdfBytes=${pdfBuffer.byteLength} tokenFingerprint=${credentialFingerprint(pdfDoc.url)}`,
    );
    return { ...pdfDoc, text, pdfBytes: pdfBuffer.byteLength };
  }

  const from = reportsEmailFrom();
  const resend = new Resend(key);
  const { data, error } = await resend.emails.send({
    from,
    to: input.to,
    subject: pdfDoc.subject,
    text,
    attachments: [
      {
        filename: pdfDoc.filename,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });

  if (error) {
    if (isResendUndeliverableToError(error)) {
      console.info(`[daily report email] skipped undeliverable recipient to=${input.to}`);
      throw new UndeliverableEmailRecipientError(input.to);
    }
    logServerError("daily report email", error);
    throw new Error("Unable to send daily report email");
  }

  console.info(
    `[daily report email] sent id=${data?.id} to=${input.to} from=${from} pdf=${pdfDoc.filename} bytes=${pdfBuffer.byteLength}`,
  );
  return { ...pdfDoc, text, pdfBytes: pdfBuffer.byteLength };
}

/**
 * Sent to team admins instead of the weekly team report when the team logged
 * no AI usage that week. Same sender, voice, and plain-text shape as the report
 * email — just no PDF, and a nudge back into the app.
 */
export function buildTeamReminderEmail(input: {
  organizationName: string;
  weekStart: string;
  weekEnd: string;
  recipientName?: string | null;
  appOrigin?: string;
}) {
  const origin = (input.appOrigin ?? getPublicAppUrl()).replace(/\/$/, "");
  const url = `${origin}/dashboard`;
  const org = input.organizationName.trim() || "your team";
  const first = input.recipientName?.trim().split(/\s+/)[0];
  const greeting = first ? `Hi ${first},` : "Hi,";
  const subject = `No team AI usage this week · ${input.weekStart} – ${input.weekEnd}`;

  const text = [
    greeting,
    "",
    `We didn't record any AI usage for ${org} this week (${input.weekStart} – ${input.weekEnd}), so there's no team report to send.`,
    "",
    "If your team has been using AI tools, their devices may not be connected yet. Check UseJunction to see who's set up:",
    url,
    "",
    "Best regards,",
    "Junction AI Assistant",
    "AI Analytics Team",
  ].join("\n");

  return { subject, text, url };
}

export async function sendTeamReminderEmail(input: {
  to: string;
  organizationName: string;
  weekStart: string;
  weekEnd: string;
  recipientName?: string | null;
}) {
  if (isUndeliverableEmailRecipient(input.to)) {
    console.info(`[team reminder email] skipped undeliverable recipient to=${input.to}`);
    throw new UndeliverableEmailRecipientError(input.to);
  }

  const doc = buildTeamReminderEmail(input);

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(
      `[team reminder email] RESEND_API_KEY not set; subject=${doc.subject} to=${input.to}`,
    );
    return doc;
  }

  const from = reportsEmailFrom();
  const resend = new Resend(key);
  const { data, error } = await resend.emails.send({
    from,
    to: input.to,
    subject: doc.subject,
    text: doc.text,
  });

  if (error) {
    if (isResendUndeliverableToError(error)) {
      console.info(`[team reminder email] skipped undeliverable recipient to=${input.to}`);
      throw new UndeliverableEmailRecipientError(input.to);
    }
    logServerError("team reminder email", error);
    throw new Error("Unable to send team reminder email");
  }

  console.info(`[team reminder email] sent id=${data?.id} to=${input.to} from=${from}`);
  return doc;
}
