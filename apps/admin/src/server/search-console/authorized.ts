import "server-only";

import { requireAdminPermission } from "../auth";
import { getSearchConsoleSnapshot } from "./snapshot";

export async function getAuthorizedSearchConsoleSnapshot() {
  const context = await requireAdminPermission("analytics.read");
  const snapshot = await getSearchConsoleSnapshot();
  return { context, snapshot };
}
