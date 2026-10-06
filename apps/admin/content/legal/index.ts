import { cookiesPage } from "./cookies";
import { dpaPage } from "./dpa";
import { gdprPage } from "./gdpr";
import { privacyPage } from "./privacy";
import { securityPage } from "./security";
import { subprocessorsPage, subprocessorsPageDefault } from "./subprocessors";
import { termsPage } from "./terms";

export { cookiesPage, dpaPage, gdprPage, privacyPage, securityPage, subprocessorsPage, termsPage };

export const LEGAL_PAGES = [
  privacyPage,
  termsPage,
  dpaPage,
  subprocessorsPageDefault,
  gdprPage,
  securityPage,
  cookiesPage,
];
