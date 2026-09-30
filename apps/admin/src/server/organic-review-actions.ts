"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdminPermission } from "./auth";
import { assertAdminHostnameRequest } from "./request";
import { createAdminSessionClient } from "./supabase";

const reviewInputSchema = z.object({
  candidateId: z.uuid(),
  action: z.enum(["request_review", "approve", "reject"]),
  reason: z.string().trim().min(1).max(500),
}).strict();

export async function recordOrganicCandidateReview(formData: FormData) {
  await assertAdminHostnameRequest();
  await requireAdminPermission("organic_intelligence.review");

  const parsed = reviewInputSchema.safeParse({
    candidateId: formData.get("candidateId"),
    action: formData.get("action"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) redirect("/publication-readiness?review=invalid");

  const session = await createAdminSessionClient();
  if (!session) redirect("/publication-readiness?review=unavailable");
  const { error } = await session.rpc("record_organic_candidate_review", {
    p_candidate_id: parsed.data.candidateId,
    p_action: parsed.data.action,
    p_reason: parsed.data.reason,
  });
  if (error) redirect("/publication-readiness?review=not-saved");

  redirect("/publication-readiness?review=saved");
}
