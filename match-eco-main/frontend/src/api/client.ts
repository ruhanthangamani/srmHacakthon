import type { PortalRecord, MatchResponse } from "@/types/portal";

const BASE = import.meta.env.VITE_API_BASE || "http://localhost:5050/api";

export async function postMatch(records: PortalRecord[]): Promise<MatchResponse> {
  const res = await fetch(`${BASE}/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(records),
  });
  if (!res.ok) throw new Error(`Match failed: ${res.status}`);
  return res.json();
}
