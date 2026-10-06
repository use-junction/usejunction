import { LegalDocument } from "@/components/public/legal-document";
import { gdprPage } from "@/content/legal";
import { contentPageMetadata } from "@/lib/public/seo-metadata";

export const metadata = contentPageMetadata(gdprPage);

export default function GdprPage() {
  return <LegalDocument page={gdprPage} />;
}
