import { LegalDocument } from "@/components/public/legal-document";
import { subprocessorsPage } from "@/content/legal";
import { contentPageMetadata } from "@/lib/public/seo-metadata";

const page = subprocessorsPage();

export const metadata = contentPageMetadata(page);

export default function SubprocessorsPage() {
  return <LegalDocument page={page} />;
}
