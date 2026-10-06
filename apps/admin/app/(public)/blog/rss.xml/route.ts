import { BLOG_POSTS } from "@/content/blog";
import { absoluteUrl, getSiteUrl } from "@/lib/public/site-url";
import { siteConfig } from "@/lib/public/config";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function GET() {
  const base = getSiteUrl();
  const feedUrl = absoluteUrl("/blog/rss.xml");
  const items = [...BLOG_POSTS]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .map((post) => {
      const url = absoluteUrl(post.path);
      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${new Date(post.updatedAt).toUTCString()}</pubDate>
      <description>${escapeXml(post.description)}</description>
      <author>hello@usejunction.dev (${escapeXml(post.author.name)})</author>
      <category>${escapeXml(post.category)}</category>
      <enclosure url="${absoluteUrl(post.socialImage.src)}" type="image/png" length="0" />
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(`${siteConfig.name} Blog`)}</title>
    <link>${base}/blog</link>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />
    <description>${escapeXml("Field notes on AI coding observability, infrastructure, cost, and privacy.")}</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
