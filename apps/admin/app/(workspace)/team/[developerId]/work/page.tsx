import { redirect } from "next/navigation";
import MemberWorkClientScreen from "@/components/developers/member-work-client-screen";
import { MemberPageShell } from "@/components/developers/member-page-shell";
import { signalsProductEnabled } from "@/lib/region";

export default async function MemberWorkPage({
  params,
}: {
  params: Promise<{ developerId: string }>;
}) {
  if (!signalsProductEnabled()) {
    const { developerId } = await params;
    redirect(`/team/${developerId}`);
  }
  return (
    <MemberPageShell>
      <MemberWorkClientScreen />
    </MemberPageShell>
  );
}
