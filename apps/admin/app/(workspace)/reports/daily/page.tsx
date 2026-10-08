import { redirect } from "next/navigation";

/** Legacy route; reports have their own page now. */
export default async function DailyReportRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
  }
  // Map legacy kind= to scope=
  if (!query.has("scope") && query.get("kind") === "personal") query.set("scope", "you");
  if (!query.has("scope") && query.get("kind") === "org") query.set("scope", "team");
  query.delete("kind");
  const suffix = query.toString();
  redirect(suffix ? `/reports?${suffix}` : "/reports");
}
