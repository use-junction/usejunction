import { redirect } from "next/navigation";

/** Legacy workspace report URL; reports have their own page now. */
export default async function DailyWorkspaceReportRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
  }
  if (!query.has("scope")) query.set("scope", "team");
  redirect(`/reports?${query.toString()}`);
}
