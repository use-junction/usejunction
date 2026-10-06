import { LegalDocument } from "@/components/public/legal-document";
import { dpaPage } from "@/content/legal";
import { contentPageMetadata } from "@/lib/public/seo-metadata";

export const metadata = contentPageMetadata(dpaPage);

export default function DpaPage() {
  return <LegalDocument page={dpaPage} />;
}
