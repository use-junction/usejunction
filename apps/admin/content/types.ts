export type ContentFaq = {
  question: string;
  answer: string;
};

export type ContentSection = {
  heading: string;
  body: string[];
};

export type HowToStep = {
  name: string;
  text: string;
};

export type ContentPage = {
  kind: "guide" | "compare" | "for" | "solution" | "blog" | "legal";
  slug: string;
  /** Path without leading domain, e.g. /guides/foo */
  path: string;
  title: string;
  description: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  updatedAt: string;
  /** Whether search engines should index this page and include it in the sitemap. */
  indexable?: boolean;
  /** First ~100 words — AEO answer block */
  answer: string;
  images?: ContentImage[];
  sections: ContentSection[];
  faq: ContentFaq[];
  relatedPaths: string[];
  howTo?: {
    name: string;
    description: string;
    steps: HowToStep[];
  };
  compareRows?: { feature: string; usejunction: string; other: string }[];
  compareOtherName?: string;
};

export type SitemapEntry = {
  path: string;
  lastModified: string;
  changeFrequency: "weekly" | "monthly" | "yearly";
  priority: number;
};

export type Author = {
  slug: string;
  name: string;
  role: string;
  bio: string;
  initials: string;
  path: string;
  links: { label: string; href: string }[];
};

export type BlogInline = {
  text: string;
  strong?: boolean;
  href?: string;
};

export type BlogImage = {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption?: string;
};

export type ContentImage = {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption?: string;
};

export type BlogBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; content: BlogInline[] }
  | { type: "list"; items: BlogInline[][] }
  | { type: "quote"; content: BlogInline[] }
  | { type: "image"; image: BlogImage };

export type BlogPost = {
  slug: string;
  /** Primary category chip shown on cards and the article header. */
  category: string;
  /** Highlighted on the blog index when true; otherwise the newest post is featured. */
  featured?: boolean;
  path: string;
  title: string;
  description: string;
  answer: string;
  /** 3–6 one-sentence takeaways rendered under the answer — the block answer engines quote most. */
  takeaways: string[];
  primaryKeyword: string;
  secondaryKeywords?: string[];
  topics: string[];
  publishedAt: string;
  updatedAt: string;
  readingMinutes: number;
  author: Author;
  heroImage: BlogImage;
  socialImage: BlogImage;
  blocks: BlogBlock[];
  faq?: ContentFaq[];
  relatedPaths: string[];
};
