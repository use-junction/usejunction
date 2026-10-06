import { LegalDocument } from "@/components/public/legal-document";
import { cookiesPage } from "@/content/legal";
import { contentPageMetadata } from "@/lib/public/seo-metadata";

export const metadata = contentPageMetadata(cookiesPage);

export default function CookiesPage() {
  return <LegalDocument page={cookiesPage} />;
}
