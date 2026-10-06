import { redirect } from "next/navigation";
import { signalsProductEnabled } from "@/lib/region";

export default function SignalsLayout({ children }: { children: React.ReactNode }) {
  if (!signalsProductEnabled()) redirect("/dashboard");
  return children;
}
