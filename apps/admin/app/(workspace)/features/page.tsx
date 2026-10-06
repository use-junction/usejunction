import { redirect } from "next/navigation";

export default async function FeaturesPage({ searchParams }: { searchParams: Promise<{ days?: string; repositoryId?: string }> }) {
  const search = await searchParams;
  const params = new URLSearchParams();
  if (search.days === "30" || search.days === "90") params.set("days", search.days);
  if (typeof search.repositoryId === "string" && search.repositoryId.length <= 128) params.set("repositoryId", search.repositoryId);
  redirect(`/work-spend${params.size ? `?${params}` : ""}`);
}
