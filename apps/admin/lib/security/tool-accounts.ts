/* Pure rules for classifying AI-tool logins as company or personal. No database imports. */

/** Consumer mail providers; a login on one of these is a personal account. */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.net",
  "gmx.de", "web.de", "yandex.com", "yandex.ru", "mail.com", "zoho.com", "fastmail.com", "hey.com", "qq.com",
  "163.com", "126.com", "naver.com",
]);

export type AccountOwnership = "company" | "personal" | "unknown";

export function emailDomain(email: string | null | undefined) {
  const at = email?.lastIndexOf("@") ?? -1;
  if (!email || at < 0) return null;
  return email.slice(at + 1).trim().toLowerCase() || null;
}

export function isFreeMailDomain(domain: string | null) {
  return Boolean(domain && FREE_MAIL_DOMAINS.has(domain));
}

/**
 * Company domains are the workspace's verified domains plus the work domains its members sign in
 * with (skipping free-mail ones, so one gmail-based member cannot make gmail "company").
 */
export function companyDomains(verified: string[], memberEmails: string[]) {
  const domains = new Set(verified.map((domain) => domain.toLowerCase()));
  for (const email of memberEmails) {
    const domain = emailDomain(email);
    if (domain && !isFreeMailDomain(domain)) domains.add(domain);
  }
  return domains;
}

export function classifyAccount(email: string | null | undefined, company: Set<string>): AccountOwnership {
  const domain = emailDomain(email);
  if (!domain) return "unknown";
  if (company.has(domain) || [...company].some((root) => domain.endsWith(`.${root}`))) return "company";
  return "personal";
}

/** Admins need to know an account is personal, not the address itself: j•••@gmail.com. */
export function maskPersonalEmail(email: string) {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}
