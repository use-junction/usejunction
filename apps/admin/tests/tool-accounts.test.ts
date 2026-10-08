import { expect, test } from "vitest";
import { classifyAccount, companyDomains, maskPersonalEmail } from "@/lib/security/tool-accounts";

test("company domains come from verified domains and members' work domains, never free mail", () => {
  const domains = companyDomains(["acme.com"], ["ada@acme.io", "ben@gmail.com"]);
  expect([...domains].sort()).toEqual(["acme.com", "acme.io"]);
});

test("logins are company, personal, or unknown", () => {
  const domains = companyDomains(["acme.com"], []);
  expect(classifyAccount("ada@acme.com", domains)).toBe("company");
  expect(classifyAccount("ada@eng.acme.com", domains)).toBe("company");
  expect(classifyAccount("ada@gmail.com", domains)).toBe("personal");
  expect(classifyAccount("ada@other.dev", domains)).toBe("personal");
  expect(classifyAccount(null, domains)).toBe("unknown");
});

test("personal addresses are masked for admins", () => {
  expect(maskPersonalEmail("ada.lovelace@gmail.com")).toBe("a•••@gmail.com");
  expect(maskPersonalEmail("broken")).toBe("•••");
});
