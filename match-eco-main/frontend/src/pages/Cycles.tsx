// src/pages/Cycles.tsx
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/store/useAppStore";
import { Network, TrendingUp, RefreshCcw } from "lucide-react";
import { toast } from "sonner";

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:5050/api";

type MaterialsRow = {
  factory_id: number;
  factory_name: string;
  role: string; // "Waste Generator" | "Receiver"
  waste_type_name?: string | null;
  raw_material_name?: string | null;
  raw_material_category?: string | null;
  waste_category?: string | null;
  created_at?: string;
  [k: string]: any;
};

export default function Cycles() {
  const tokenFromStore = useAppStore((s) => s.token) as string | null;
  const token = tokenFromStore ?? (typeof window !== "undefined" ? localStorage.getItem("token") : null);

  const [loading, setLoading] = useState(false);
  const [materials, setMaterials] = useState<MaterialsRow[]>([]);
  const [cycles, setCycles] = useState<string[][]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  // local filter (search cycles list)
  const [query, setQuery] = useState("");

  // ---- helpers ----
  const norm = (s: any) => (s ? String(s).trim().toLowerCase() : "");

  async function fetchMaterialsAndCycles() {
    if (!token) {
      toast.error("Please sign in");
      return;
    }
    setLoading(true);
    try {
      // 1) Get normalized materials list from /match/all
      const res = await fetch(`${API_BASE}/match/all?scope=global`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Failed to fetch materials (${res.status})`);

      const materials_full = Array.isArray(data?.materials_full) ? data.materials_full : [];
      setMaterials(materials_full);

      // 2) Build directed graph: Generator -> Receiver when waste == raw material (name match)
      const gens = materials_full.filter((m: MaterialsRow) => norm(m.role).includes("generator") && norm(m.waste_type_name));
      const recs = materials_full.filter((m: MaterialsRow) => norm(m.role).includes("receiver") && norm(m.raw_material_name));

      const graph: Record<string, string[]> = {};
      for (const g of gens) {
        const gName = g.factory_name || `Factory#${g.factory_id}`;
        for (const r of recs) {
          const sameMaterial = norm(g.waste_type_name) === norm(r.raw_material_name);
          if (!sameMaterial) continue;
          const rName = r.factory_name || `Factory#${r.factory_id}`;
          if (gName === rName) continue; // skip self-loop here; remove if you want self loops considered
          if (!graph[gName]) graph[gName] = [];
          if (!graph[gName].includes(rName)) graph[gName].push(rName);
        }
      }

      // 3) Ask backend to detect cycles
      const cycRes = await fetch(`${API_BASE}/cycles`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ graph }),
      });
      const cyc = await cycRes.json().catch(() => ({}));
      if (!cycRes.ok) throw new Error(cyc?.error || `Cycle detection failed (${cycRes.status})`);

      const out: string[][] = Array.isArray(cyc?.cycles) ? cyc.cycles : [];
      setCycles(out);
      setSelectedIdx(out.length ? 0 : null);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to load cycles");
      setCycles([]);
      setSelectedIdx(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchMaterialsAndCycles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Demo generator hook-up
  async function handleGenerateDemo() {
    if (!token) {
      toast.error("Please sign in");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/demo/cyclic-data`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `Seeder failed (${res.status})`);
      }
      toast.success("Demo cyclic data seeded");
      await fetchMaterialsAndCycles();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to seed demo data");
    } finally {
      setLoading(false);
    }
  }

  // Filter cycles by factory name presence
  const filteredCycles = useMemo(() => {
    const q = norm(query);
    if (!q) return cycles;
    return cycles.filter((cycle) => cycle.some((node) => norm(node).includes(q)));
  }, [cycles, query]);

  const selected = selectedIdx !== null ? filteredCycles[selectedIdx] : null;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold">Cycles</h1>
            <p className="text-muted-foreground">Circular economy opportunities (Generator → Receiver → … → Generator)</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={fetchMaterialsAndCycles} disabled={loading} title="Refresh">
              <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button onClick={handleGenerateDemo} disabled={loading}>
              Seed Demo Cyclic Data
            </Button>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Cycle List */}
          <Card className="p-4 lg:col-span-1">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Network className="h-5 w-5" />
                Detected Cycles
              </h2>
              <Input
                placeholder="Search by factory…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIdx(0);
                }}
                className="w-40"
              />
            </div>

            {loading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : filteredCycles.length === 0 ? (
              <p className="text-muted-foreground text-sm">No cycles detected</p>
            ) : (
              <div className="space-y-2 overflow-y-auto max-h-[70vh] pr-1">
                {filteredCycles.map((cycle, idx) => {
                  const active = idx === (selectedIdx ?? -1);
                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedIdx(idx)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">Cycle {idx + 1}</span>
                        <TrendingUp className="h-4 w-4" />
                      </div>
                      <p className="text-xs opacity-80">{cycle.length} nodes</p>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Cycle Details */}
          <Card className="p-6 lg:col-span-2">
            {selected ? (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold mb-2">
                    Cycle {selectedIdx !== null ? selectedIdx + 1 : ""}
                  </h2>
                  <p className="text-muted-foreground">Nodes: {selected.length}</p>
                </div>

                <div>
                  <h3 className="font-semibold mb-3">Path</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    {selected.map((node, i) => (
                      <div key={`${node}-${i}`} className="flex items-center gap-2">
                        <span className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm whitespace-nowrap">
                          {node}
                        </span>
                        {i < selected.length - 1 && (
                          <span className="opacity-60 select-none">→</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                Select a cycle to view details
              </div>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
