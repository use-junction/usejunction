/**
 * Send a sample empty-week team reminder email for review.
 *   pnpm exec tsx --env-file=.env scripts/send-test-team-reminder.ts you@example.com
 */
import { sendTeamReminderEmail } from "@/lib/email/daily-report";

const to = process.argv[2];
if (!to) throw new Error("usage: send-test-team-reminder.ts <email>");

void sendTeamReminderEmail({
  to,
  organizationName: "Dinuda Yaggahavita's workspace",
  weekStart: "2026-09-28",
  weekEnd: "2026-10-04",
  recipientName: "Dinuda",
}).then((doc) => console.log(`subject: ${doc.subject}\n\n${doc.text}`));
