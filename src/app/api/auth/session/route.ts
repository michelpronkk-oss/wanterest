import { getCurrentUser } from "@/server/modules/auth";
import { jsonError } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";

export async function GET(request: Request) {
  const traceId = getTraceId(request);
  try {
    const user = await getCurrentUser();
    return Response.json(
      { user: user ? { id: user.id, email: user.email ?? null } : null, traceId },
      { headers: { "x-request-id": traceId } },
    );
  } catch (error) {
    return jsonError(error, traceId);
  }
}
