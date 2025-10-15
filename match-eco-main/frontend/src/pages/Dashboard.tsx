// Dashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/useAppStore";
import { Factory, Users, TrendingUp, Leaf, Plus, GitMerge, Network } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { composePortalRecords } from "@/utils/composePortalRecords";
import { postMatch } from "@/api/client";
import { toast } from "sonner";

// In .env: VITE_API_URL=http://127.0.0.1:5050/api
const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:5050/api";

// ---- helpers to normalize API shapes ----
type RolesRaw = string[] | string | null | undefined;
function normalizeRoles(r: RolesRaw): ("Waste Generator" | "Receiver")[] {
  if (Array.isArray(r)) return r as any;
  if (typeof r === "string") return r.split(",").map((s) => s.trim()).filter(Boolean) as any;
  return [];
}

// API rows we can handle
type ApiRow =
  | { id: number; created_at: string; records: any[] }
  | {
      id: number;
      created_at: string;
      common?: any;
      generator?: any | null;
      receiver?: any | null;
      roles?: RolesRaw;
      payload?: any;
      roles_csv?: string;
    };

// safe getters for new/old matcher result shapes
function getCompScore(m: any): number {
  return Number(
    m?.scores?.compatibility_score ??
      m?.score ?? // legacy fallback
      0
  );
}
function getEcoEff(m: any): number {
  return Number(
    m?.economics?.eco_efficiency_score ??
      m?.eco_efficiency ?? // legacy fallback
      0
  );
}

export default function Dashboard() {
  const navigate = useNavigate();

  // token from store or localStorage
  const tokenFromStore = useAppStore((s) => s.token) as string | null;
  const token = tokenFromStore ?? (typeof window !== "undefined" ? localStorage.getItem("token") : null);

  const [loading, setLoading] = useState(true);
  const [wasteMaterials, setWasteMaterials] = useState<any[]>([]); // flattened PortalRecord[]
  const [matchResults, setMatchResults] = useState<any | null>(null);

  // Fetch from API on mount / token change
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!token) {
        toast.error("Please sign in");
        navigate("/auth/login");
        return;
      }

      setLoading(true);
      try {
        // ✅ backend route is /api/waste-materials (plural, kebab)
        const res = await fetch(`${API_BASE}/waste-materials`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.status === 401) {
          toast.error("Session expired. Please sign in again.");
          navigate("/auth/login");
          return;
        }

        if (!res.ok) {
          const msg = await res.text().catch(() => "");
          throw new Error(msg || `Failed to load waste materials (${res.status})`);
        }

        const rows: ApiRow[] = await res.json();

        // Flatten into PortalRecord[]
        const flattened: any[] = rows.flatMap((row: any) => {
          // Preferred: records[] already is PortalRecord[]
          if (Array.isArray(row?.records)) return row.records;

          // Sometimes payload contains records or parts
          const payload = row?.payload;
          if (Array.isArray(payload)) return payload;
          if (payload && Array.isArray(payload.records)) return payload.records;

          // Fallback: rebuild from {common,generator,receiver,roles}
          const common = row?.common ?? payload?.common ?? {};
          const generator = row?.generator ?? payload?.generator ?? null;
          const receiver = row?.receiver ?? payload?.receiver ?? null;
          const roles = normalizeRoles(row?.roles ?? payload?.roles ?? row?.roles_csv);

          if (common && Object.keys(common).length) {
            return composePortalRecords(common, generator, receiver, roles);
          }
          return [];
        });

        if (cancelled) return;
        setWasteMaterials(flattened);

        // Optional: recompute matches to populate KPIs
        try {
          const result = await postMatch(flattened); // should POST to `${API_BASE}/match`
          if (cancelled) return;
          setMatchResults(result);
        } catch {
          toast.message("Loaded waste materials. Matching analytics unavailable.");
          setMatchResults(null);
        }
      } catch (err: any) {
        console.error("[Dashboard] Fetch error:", err);
        toast.error(err?.message || "Failed to load data from server");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  // KPIs
  const generators = useMemo(() => wasteMaterials.filter((f) => f.GENERATOR), [wasteMaterials]);
  const receivers = useMemo(() => wasteMaterials.filter((f) => f.RECEIVER), [wasteMaterials]);

  const topScore = useMemo(() => {
    const first = matchResults?.ranked_matches?.[0];
    return first ? getCompScore(first) : 0;
  }, [matchResults]);

  const avgEcoEff = useMemo(() => {
    const arr = matchResults?.ranked_matches ?? [];
    if (arr.length === 0) return 0;
    const sum = arr.reduce((acc: number, m: any) => acc + getEcoEff(m), 0);
    return sum / arr.length;
  }, [matchResults]);

  const chartData = useMemo(
    () => [
      { name: "Generators", value: generators.length },
      { name: "Receivers", value: receivers.length },
      { name: "Matches", value: matchResults?.ranked_matches?.length || 0 },
      { name: "Cycles", value: matchResults?.detected_cycles?.length || 0 },
    ],
    [generators.length, receivers.length, matchResults]
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground">Overview of your waste material matching network</p>
          </div>
          <Button asChild>
            {/* keep routes consistent across the app */}
            <Link to="/factories/new">
              <Plus className="h-4 w-4 mr-2" />
              New Waste Material
            </Link>
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Waste Material</p>
                <p className="text-3xl font-bold">{loading ? "…" : wasteMaterials.length}</p>
              </div>
              <Factory className="h-8 w-8 text-primary" />
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Generators</p>
                <p className="text-3xl font-bold">{loading ? "…" : generators.length}</p>
              </div>
              <Users className="h-8 w-8 text-yellow-500" />
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Top Match Score</p>
                <p className="text-3xl font-bold">
                  {loading ? "…" : `${Math.max(0, topScore || 0).toFixed(0)}%`}
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-emerald-500" />
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Avg Eco-Efficiency</p>
                <p className="text-3xl font-bold">{loading ? "…" : (avgEcoEff || 0).toFixed(2)}</p>
              </div>
              <Leaf className="h-8 w-8 text-sky-500" />
            </div>
          </Card>
        </div>

        {/* Chart */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Network Overview</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Quick Actions */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="p-6 hover:shadow-lg transition-shadow">
            <GitMerge className="h-10 w-10 text-primary mb-4" />
            <h3 className="font-semibold text-lg mb-2">View Matches</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Browse ranked matches with detailed analytics
            </p>
            <Button variant="outline" asChild className="w-full">
              <Link to="/match">Go to Matches</Link>
            </Button>
          </Card>

          <Card className="p-6 hover:shadow-lg transition-shadow">
            <Network className="h-10 w-10 text-emerald-500 mb-4" />
            <h3 className="font-semibold text-lg mb-2">Explore Cycles</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Visualize circular economy opportunities
            </p>
            <Button variant="outline" asChild className="w-full">
              <Link to="/cycles">Go to Cycles</Link>
            </Button>
          </Card>

          <Card className="p-6 hover:shadow-lg transition-shadow">
            <Factory className="h-10 w-10 text-sky-500 mb-4" />
            <h3 className="font-semibold text-lg mb-2">Add Waste Material</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Register a new waste generator or receiver
            </p>
            <Button variant="outline" asChild className="w-full">
              <Link to="/factories/new">Add Waste Material</Link>
            </Button>
          </Card>
        </div>

        {/* Recent Submissions */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Submissions</h2>
          {loading ? (
            <p className="text-muted-foreground text-center py-8">Loading…</p>
          ) : wasteMaterials.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No Waste Material registered yet</p>
          ) : (
            <div className="space-y-3">
              {wasteMaterials.slice(-5).reverse().map((wm: any, idx: number) => {
                const type =
                  wm?.COMMON?.["Factory Type"] ||
                  (wm.GENERATOR ? "Waste Generator" : wm.RECEIVER ? "Receiver" : "Waste Material");
                return (
                  <div key={idx} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <p className="font-medium">{wm.COMMON?.["Factory Name"] || "Unnamed Waste Material"}</p>
                      <p className="text-sm text-muted-foreground">
                        {type} • {wm.COMMON?.["Industry Type"] ?? "—"}
                      </p>
                    </div>
                    <span className="text-xs px-2 py-1 bg-primary/10 text-primary rounded">
                      {type}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
