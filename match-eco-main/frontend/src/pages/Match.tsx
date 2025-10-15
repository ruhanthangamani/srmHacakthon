import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAppStore } from "@/store/useAppStore";
import { Download, RefreshCcw, MessageSquare } from "lucide-react";
import { toast } from "sonner";

// dialog + textarea
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:5050/api";

/** ---------- utils ---------- */
const isPrimitive = (v: any) => v === null || ["string", "number", "boolean"].includes(typeof v);
const toCell = (v: any) => (isPrimitive(v) ? v : JSON.stringify(v));

function flatten(obj: any, prefix = "", out: Record<string, any> = {}) {
  if (obj === null || obj === undefined) return out;
  if (Array.isArray(obj)) {
    out[prefix || "value"] = obj;
    return out;
  }
  if (typeof obj !== "object") {
    out[prefix || "value"] = obj;
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flatten(v, key, out);
    } else {
      out[key] = v;
    }
  }
  return out;
}

function unionKeysWithPreferred(rows: any[], preferred: string[] = []) {
  const s = new Set<string>();
  for (const r of rows) if (r && typeof r === "object") Object.keys(r).forEach((k) => s.add(k));
  const all = [...s];
  const orderedPref = preferred.filter((k) => s.has(k));
  const rest = all.filter((k) => !preferred.includes(k)).sort();
  return orderedPref.concat(rest);
}

/** ---------- main ---------- */
export default function Match() {
  const navigate = useNavigate();

  const tokenFromStore = useAppStore((s) => s.token) as string | null;
  const token = tokenFromStore ?? (typeof window !== "undefined" ? localStorage.getItem("token") : null);
  const setStoreMatchResults = useAppStore((s) => s.setMatchResults as (r: any) => void);

  const [scope, setScope] = useState<"user" | "global">("global");
  const [loading, setLoading] = useState(false);

  const [materialsFull, setMaterialsFull] = useState<any[]>([]);
  const [matchesRaw, setMatchesRaw] = useState<any[]>([]);
  const [cyclesRaw, setCyclesRaw] = useState<any[]>([]);

  // searches
  const [materialsQuery, setMaterialsQuery] = useState("");
  const [matchesQuery, setMatchesQuery] = useState("");
  const [cyclesQuery, setCyclesQuery] = useState("");

  // paging (100 at a time)
  const PAGE = 100;
  const [visMaterials, setVisMaterials] = useState(PAGE);
  const [visMatches, setVisMatches] = useState(PAGE);
  const [visCycles, setVisCycles] = useState(PAGE);

  // messaging modal
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgTargetFactoryId, setMsgTargetFactoryId] = useState<number | null>(null);
  const [msgTargetName, setMsgTargetName] = useState<string>("");
  const [msgFromFactoryId, setMsgFromFactoryId] = useState<number | null>(null);
  const [msgBody, setMsgBody] = useState("");

  async function fetchAll(selScope: "user" | "global" = scope) {
    if (!token) {
      toast.error("Please sign in");
      navigate("/auth/login");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/match/all?scope=${selScope}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(raw?.error || `Failed to fetch matches (${res.status})`);

      const ranked = Array.isArray(raw?.ranked_matches) ? raw.ranked_matches : [];
      const materials = Array.isArray(raw?.materials_full) ? raw.materials_full : [];
      const cycles = Array.isArray(raw?.detected_cycles) ? raw.detected_cycles : [];

      setMatchesRaw(ranked);
      setMaterialsFull(materials);
      setCyclesRaw(cycles);
      setStoreMatchResults(raw);

      setVisMaterials(PAGE);
      setVisMatches(PAGE);
      setVisCycles(PAGE);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to load");
      setMatchesRaw([]);
      setMaterialsFull([]);
      setCyclesRaw([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll("global");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ---------- FACTORY INDEXES ---------- */
  const byName = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const r of materialsFull) {
      const name = (r?.factory_name || "").toLowerCase().trim();
      const id = r?.factory_id;
      if (!name || typeof id !== "number") continue;
      const arr = m.get(name) || [];
      if (!arr.includes(id)) arr.push(id);
      m.set(name, arr);
    }
    return m;
  }, [materialsFull]);

  // In case you want to list user's factories for "From Factory" picker later
  const myFactories = useMemo(() => {
    // If you embed the user's factories in a user-specific endpoint, populate here.
    return [] as { id: number; name: string }[];
  }, [materialsFull]);

  /** ---------- MATERIALS TABLE (full details) ---------- */
  const materialsFiltered = useMemo(() => {
    if (!materialsQuery.trim()) return materialsFull;
    const q = materialsQuery.toLowerCase();
    return materialsFull.filter((r) => JSON.stringify(r || {}).toLowerCase().includes(q));
  }, [materialsFull, materialsQuery]);

  const materialsCols = useMemo(() => {
    const preferred = [
      "role",
      "factory_name",
      "industry_type",
      "raw_material_name",
      "waste_type_name",
      "raw_material_category",
      "waste_category",
      "quantity_required",
      "quantity_generated",
      "frequency_requirement",
      "frequency_generation",
      "location_text",
      "location_lat",
      "location_lon",
      "production_capacity",
      "certification",
      "sustainability_goal",
      "email",
      "created_at",
      "factory_id",
      "receiver_id",
      "generator_id",
    ];
    return unionKeysWithPreferred(materialsFiltered, preferred);
  }, [materialsFiltered]);

  /** ---------- MATCHES (flatten pairs to retain original for messaging) ---------- */
  const matchesPaired = useMemo(() => matchesRaw.map((orig) => ({ orig, flat: flatten(orig) })), [matchesRaw]);

  const matchesFiltered = useMemo(() => {
    if (!matchesQuery.trim()) return matchesPaired;
    const q = matchesQuery.toLowerCase();
    return matchesPaired.filter((p) => JSON.stringify(p.flat || {}).toLowerCase().includes(q));
  }, [matchesPaired, matchesQuery]);

  const matchesCols = useMemo(() => {
    const rows = matchesFiltered.map((p) => p.flat);
    const preferred = [
      "supplier_name",
      "receiver_name",
      "material_type",
      "distance_km",
      "scores.compatibility_score",
      "scores.material_score",
      "scores.distance_score",
      "scores.quantity_score",
      "economics.matched_quantity_tons",
      "economics.transport_cost",
      "economics.total_cost",
      "economics.co2_saved_kg",
      "economics.eco_efficiency_score",
    ];
    return unionKeysWithPreferred(rows, preferred);
  }, [matchesFiltered]);

  /** ---------- CYCLES TABLE (flatten) ---------- */
  const cyclesFlat = useMemo(() => cyclesRaw.map((c) => flatten(c)), [cyclesRaw]);

  const cyclesFiltered = useMemo(() => {
    if (!cyclesQuery.trim()) return cyclesFlat;
    const q = cyclesQuery.toLowerCase();
    return cyclesFlat.filter((r) => JSON.stringify(r || {}).toLowerCase().includes(q));
  }, [cyclesFlat, cyclesQuery]);

  const cyclesCols = useMemo(() => {
    const preferred = [
      "cycle_nodes",
      "aggregate_total_cost",
      "aggregate_co2_saved_kg",
      "aggregate_eco_efficiency_score",
    ];
    return unionKeysWithPreferred(cyclesFiltered, preferred);
  }, [cyclesFiltered]);

  /** ---------- CSV exports ---------- */
  const csvDownload = (rows: any[], headers: string[], filename: string) => {
    if (!rows.length) return;
    const outRows = rows.map((r) => headers.map((h) => toCell(r?.[h])));
    const csv = [headers, ...outRows]
      .map((row) =>
        row
          .map((cell) => {
            const s = String(cell ?? "");
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  };

  /** ---------- Messaging actions ---------- */
  function resolveFactoryIdByName(name: string | undefined): number | null {
    if (!name) return null;
    const ids = byName.get(name.toLowerCase().trim());
    return ids && ids.length > 0 ? ids[0] : null;
  }

  function openMessageModalFor(paired: { orig: any }, target: "supplier" | "receiver") {
    const m = paired.orig || {};
    const targetName =
      target === "supplier"
        ? m.supplier_name || m.supplier || m.supplierId || ""
        : m.receiver_name || m.receiver || m.receiverId || "";

    const explicitId =
      target === "supplier" ? m.supplier_id || m.supplierFactoryId : m.receiver_id || m.receiverFactoryId;

    let fid: number | null = typeof explicitId === "number" ? explicitId : resolveFactoryIdByName(String(targetName));

    if (!fid) {
      toast.error("Couldn't resolve target factory. Try messaging from the Materials table instead.");
      return;
    }

    setMsgTargetFactoryId(fid);
    setMsgTargetName(String(targetName) || `Factory #${fid}`);
    setMsgBody("");
    setMsgFromFactoryId(null);
    setMsgOpen(true);
  }

  async function sendMessage() {
    if (!token) {
      toast.error("Please sign in");
      navigate("/auth/login");
      return;
    }
    if (!msgTargetFactoryId) return;

    try {
      const res = await fetch(`${API_BASE}/messages/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          target_factory_id: msgTargetFactoryId,
          from_factory_id: msgFromFactoryId || undefined,
          body: msgBody,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Send failed (${res.status})`);
      toast.success("Message sent!");
      setMsgOpen(false);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to send");
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold">Materials & Matches</h1>
            <p className="text-muted-foreground">Search, page 100 at a time, export, and message factories</p>
          </div>

          <div className="flex items-center gap-2">
            <Select value={scope} onValueChange={(v: any) => setScope(v)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">My Data</SelectItem>
                <SelectItem value="global">All Data</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              onClick={() => fetchAll(scope)}
              disabled={loading}
              className="flex items-center gap-2"
              title="Refresh from server"
            >
              <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        </div>

        {/* ---------- MATERIALS FULL ---------- */}
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div>
              <h2 className="text-lg font-semibold">All Materials (Full Details)</h2>
              <p className="text-sm text-muted-foreground">
                Showing <b>{Math.min(visMaterials, materialsFiltered.length)}</b> of{" "}
                <b>{materialsFiltered.length}</b> (scope: {scope})
              </p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Input
                placeholder="Search materials…"
                value={materialsQuery}
                onChange={(e) => {
                  setMaterialsQuery(e.target.value);
                  setVisMaterials(PAGE);
                }}
              />
              <Button
                variant="outline"
                onClick={() => csvDownload(materialsFiltered, materialsCols, "materials_full.csv")}
                disabled={materialsFiltered.length === 0}
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>

          <div className="rounded-md border">
            {/* Only the table scrolls horizontally */}
            <div className="overflow-x-auto">
              {/* And vertically within a fixed height */}
              <div className="max-h-[60vh] overflow-y-auto">
                <table className="w-full min-w-[1000px] text-sm">
                  <thead className="sticky top-0 z-10 border-b bg-background">
                    <tr>
                      {materialsCols.length === 0 ? (
                        <th className="px-4 py-3 text-left font-medium">No columns</th>
                      ) : (
                        materialsCols.map((k) => (
                          <th key={k} className="px-4 py-3 text-left font-medium whitespace-nowrap">
                            {k}
                          </th>
                        ))
                      )}
                      <th className="px-4 py-3 text-left font-medium whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td
                          colSpan={Math.max(1, materialsCols.length + 1)}
                          className="px-4 py-8 text-center text-muted-foreground"
                        >
                          Loading…
                        </td>
                      </tr>
                    ) : materialsFiltered.length === 0 ? (
                      <tr>
                        <td
                          colSpan={Math.max(1, materialsCols.length + 1)}
                          className="px-4 py-8 text-center text-muted-foreground"
                        >
                          No materials found.
                        </td>
                      </tr>
                    ) : (
                      materialsFiltered.slice(0, visMaterials).map((row, i) => (
                        <tr key={i} className="border-b hover:bg-muted/30 transition-colors">
                          {materialsCols.map((k) => (
                            <td key={k} className="px-4 py-3 align-top whitespace-nowrap">
                              {toCell(row?.[k])}
                            </td>
                          ))}
                          <td className="px-4 py-3">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const fid =
                                  typeof row?.factory_id === "number"
                                    ? row.factory_id
                                    : (() => {
                                        const ids = byName.get((row?.factory_name || "").toLowerCase().trim());
                                        return ids && ids.length > 0 ? ids[0] : null;
                                      })();
                                if (!fid) return toast.error("Could not resolve factory id");
                                setMsgTargetFactoryId(fid);
                                setMsgTargetName(row?.factory_name || `Factory #${fid}`);
                                setMsgBody("");
                                setMsgFromFactoryId(null);
                                setMsgOpen(true);
                              }}
                            >
                              <MessageSquare className="h-4 w-4 mr-2" />
                              Message
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {visMaterials < materialsFiltered.length && (
            <div className="flex justify-center mt-3">
              <Button onClick={() => setVisMaterials((v) => v + PAGE)}>Load more</Button>
            </div>
          )}
        </Card>

        {/* ---------- MATCHES (ALL FIELDS, FLATTENED) ---------- */}
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div>
              <h2 className="text-lg font-semibold">Ranked Matches (All Fields)</h2>
              <p className="text-sm text-muted-foreground">
                Showing <b>{Math.min(visMatches, matchesFiltered.length)}</b> of <b>{matchesFiltered.length}</b>
              </p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Input
                placeholder="Search matches…"
                value={matchesQuery}
                onChange={(e) => {
                  setMatchesQuery(e.target.value);
                  setVisMatches(PAGE);
                }}
              />
              <Button
                variant="outline"
                onClick={() =>
                  csvDownload(
                    matchesFiltered.map((p) => p.flat),
                    matchesCols,
                    "matches_all_fields.csv",
                  )
                }
                disabled={matchesFiltered.length === 0}
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>

          <div className="rounded-md border">
            <div className="overflow-x-auto">
              <div className="max-h-[60vh] overflow-y-auto">
                <table className="w-full min-w-[1200px] text-sm">
                  <thead className="sticky top-0 z-10 border-b bg-background">
                    <tr>
                      {matchesCols.length === 0 ? (
                        <th className="px-4 py-3 text-left font-medium">No columns</th>
                      ) : (
                        matchesCols.map((k) => (
                          <th key={k} className="px-4 py-3 text-left font-medium whitespace-nowrap">
                            {k}
                          </th>
                        ))
                      )}
                      <th className="px-4 py-3 text-left font-medium whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td
                          colSpan={Math.max(1, matchesCols.length + 1)}
                          className="px-4 py-8 text-center text-muted-foreground"
                        >
                          Loading…
                        </td>
                      </tr>
                    ) : matchesFiltered.length === 0 ? (
                      <tr>
                        <td
                          colSpan={Math.max(1, matchesCols.length + 1)}
                          className="px-4 py-8 text-center text-muted-foreground"
                        >
                          No matches found.
                        </td>
                      </tr>
                    ) : (
                      matchesFiltered.slice(0, visMatches).map((pair, i) => (
                        <tr key={i} className="border-b hover:bg-muted/30 transition-colors">
                          {matchesCols.map((k) => (
                            <td key={k} className="px-4 py-3 align-top whitespace-nowrap">
                              {toCell(pair.flat?.[k])}
                            </td>
                          ))}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" onClick={() => openMessageModalFor(pair, "supplier")}>
                                <MessageSquare className="h-4 w-4 mr-2" />
                                Message Supplier
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => openMessageModalFor(pair, "receiver")}>
                                <MessageSquare className="h-4 w-4 mr-2" />
                                Message Receiver
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {visMatches < matchesFiltered.length && (
            <div className="flex justify-center mt-3">
              <Button onClick={() => setVisMatches((v) => v + PAGE)}>Load more</Button>
            </div>
          )}
        </Card>

        {/* ---------- CYCLES (ALL FIELDS, FLATTENED) ---------- */}
        
      </div>

      {/* --------- MESSAGE MODAL --------- */}
      <Dialog open={msgOpen} onOpenChange={setMsgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Message {msgTargetName || "Factory"}</DialogTitle>
          </DialogHeader>

          {myFactories.length > 0 && (
            <div className="space-y-2">
              <Label>From Factory (optional)</Label>
              <Select
                value={msgFromFactoryId ? String(msgFromFactoryId) : ""}
                onValueChange={(v) => setMsgFromFactoryId(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose factory" />
                </SelectTrigger>
                <SelectContent>
                  {myFactories.map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.name} (#{f.id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Your message</Label>
            <Textarea
              rows={5}
              value={msgBody}
              onChange={(e) => setMsgBody(e.target.value)}
              placeholder="Hi, we’re interested in your material. Can we connect?"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMsgOpen(false)}>
              Cancel
            </Button>
            <Button onClick={sendMessage} disabled={!msgBody.trim() || !msgTargetFactoryId}>
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
