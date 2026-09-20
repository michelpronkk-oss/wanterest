import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/modules/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? "/app" : "/login");
}
