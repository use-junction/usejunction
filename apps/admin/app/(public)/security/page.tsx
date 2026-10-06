import { LegalDocument } from "@/components/public/legal-document";
import { securityPage } from "@/content/legal";
import { contentPageMetadata } from "@/lib/public/seo-metadata";

export const metadata = contentPageMetadata(securityPage);

export default function SecurityPage() {
  return <LegalDocument page={securityPage} />;
}
