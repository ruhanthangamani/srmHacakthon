// ManageWasteMaterials.tsx
import { useEffect, useState, useMemo } from "react";
import { useAppStore } from "@/store/useAppStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useNavigate, Link } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:5050/api";

type ApiRow =
  | { id: number; created_at: string; records: any[] } // legacy snapshot (not deletable here)
  | {
      id: number;
      created_at: string;
      common?: Record<string, any> | null;
      generator?: any | null;
      receiver?: any | null;
      roles?: string[] | string | null;
      roles_csv?: string | null;
      payload?: any;
    };

export default function ManageWasteMaterials() {
  const navigate = useNavigate();
  const tokenFromStore = useAppStore((s) => s.token) as string | null;
  const token =
    tokenFromStore ?? (typeof window !== "undefined" ? localStorage.getItem("token") : null);

  const [rows, setRows] = useState<ApiRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Show only normalized (deletable) items: they include `common`
  const deletable = useMemo(
    () => rows.filter((r: any) => r && r.common && typeof r.id === "number"),
    [rows]
  );

  useEffect(() => {
    if (!token) {
      toast.error("Please sign in");
      navigate("/auth/login");
      return;
    }

    setLoading(true);
    (async () => {
      try {
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

        const data: ApiRow[] = await res.json();
        setRows(Array.isArray(data) ? data : []);
      } catch (e: any) {
        console.error(e);
        toast.error(e?.message || "Failed to load waste materials");
      } finally {
        setLoading(false);
      }
    })();
  }, [token, navigate]);

  const handleDelete = async (factoryId: number) => {
    if (!token) {
      toast.error("Please sign in");
      navigate("/auth/login");
      return;
    }
    if (!window.confirm("Delete this waste material (factory) permanently?")) return;

    try {
      const res = await fetch(`${API_BASE}/factories/${factoryId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 401) {
        toast.error("Session expired. Please sign in again.");
        navigate("/auth/login");
        return;
      }

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Delete failed");
      }

      toast.success("Deleted");
      setRows((prev) => prev.filter((r: any) => r?.id !== factoryId));
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Could not delete");
    }
  };

  // helpers
  const asList = (v: any): string[] =>
    Array.isArray(v) ? v : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];

  const locToText = (v: any): string => {
    if (!v) return "—";
    if (typeof v === "string") return v;
    const lat = v?.lat ?? v?.latitude;
    const lon = v?.lon ?? v?.lng ?? v?.longitude;
    if (lat != null && lon != null) return `${lat}, ${lon}`;
    return "—";
  };

  const Pill = ({ children, tone = "default" }: { children: any; tone?: "default" | "info" | "warn" }) => {
    const tones: Record<string, string> = {
      default: "bg-muted text-foreground",
      info: "bg-primary/10 text-primary",
      warn: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    };
    return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${tones[tone]}`}>{children}</span>;
  };

  const Field = ({ label, value }: { label: string; value: any }) => (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className="col-span-2 break-words">{value ?? "—"}</div>
    </div>
  );

  return (
    <div className="min-h-screen p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Manage Waste Materials</h1>
        <Button asChild>
          <Link to="/factories/new">Add Waste Material</Link>
        </Button>
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : deletable.length === 0 ? (
        <div>No deletable waste materials found.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {deletable.map((wm: any) => {
            const c = wm.common || {};
            const g = wm.generator || null;
            const r = wm.receiver || null;

            const name =
              c["WasteMaterial Name"] ||
              c["Factory Name"] ||
              `#${wm.id}`;

            const industry = c["Industry Type"] ?? "—";
            const created = wm?.created_at ?? "—";
            const roles = asList(wm.roles ?? wm.roles_csv);
            const certs = asList(c["Certification"]);
            const location = c["Location"];

            // Summary chips
            const chipRoles = roles.length ? roles : (g && r ? ["Waste Generator", "Receiver"] : g ? ["Waste Generator"] : r ? ["Receiver"] : []);

            return (
              <Card key={wm.id} className="p-6 flex flex-col gap-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-semibold text-lg">{name}</div>
                    <div className="text-sm text-muted-foreground">{industry}</div>
                    <div className="text-xs mt-1">Created: {created}</div>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end">
                    {chipRoles.map((r: string) => (
                      <Pill key={r} tone={r.toLowerCase().includes("generator") ? "warn" : "info"}>
                        {r}
                      </Pill>
                    ))}
                  </div>
                </div>

                {/* Common */}
                <div className="space-y-2">
                  <h4 className="font-semibold">Common</h4>
                  <div className="space-y-1">
                    <Field label="Location" value={locToText(location)} />
                    <Field label="Production Capacity" value={c["Production Capacity"]} />
                    <Field label="Certification" value={certs.join(", ") || "—"} />
                    <Field label="Sustainability Goal" value={c["Sustainability Goal"]} />
                    <Field label="Email" value={c["Email"]} />
                  </div>
                </div>

                {/* Generator */}
                {g && (
                  <div className="space-y-2">
                    <h4 className="font-semibold">Generator</h4>
                    <div className="space-y-1">
                      <Field label="Waste Category" value={g["Waste Category"]} />
                      <Field label="Waste Type Name" value={g["Waste Type Name"]} />
                      <Field label="Quantity Generated" value={g["Quantity Generated"]} />
                      <Field label="Frequency of Generation" value={g["Frequency of Generation"]} />
                      <Field label="Waste Composition" value={g["Waste Composition"]} />
                      <Field label="Waste Properties" value={asList(g["Waste Properties"]).join(", ")} />
                      <Field label="Storage Condition" value={g["Storage Condition"]} />
                      <Field label="Disposal Cost" value={g["Disposal Cost"]} />
                      <Field label="Hazard Rating" value={g["Certification / Hazard Rating"]} />
                      <Field label="Preferred Buyer Type" value={g["Preferred Buyer Type"]} />
                    </div>
                  </div>
                )}

                {/* Receiver */}
                {r && (
                  <div className="space-y-2">
                    <h4 className="font-semibold">Receiver</h4>
                    <div className="space-y-1">
                      <Field label="Raw Material Name" value={r["Raw Material Name"]} />
                      <Field label="Raw Material Category" value={r["Raw Material Category"]} />
                      <Field label="Quantity Required" value={r["Quantity Required"]} />
                      <Field label="Frequency of Requirement" value={r["Frequency of Requirement"]} />
                      <Field label="Required Composition" value={r["Required Chemical Composition"]} />
                      <Field label="Required Properties" value={asList(r["Required Physical Properties"]).join(", ")} />
                      <Field label="Minimum Purity Level" value={r["Minimum Purity Level"]} />
                      <Field label="Contaminant Tolerance" value={r["Contaminant Tolerance"]} />
                      <Field label="Form Needed" value={r["Form of Material Needed"]} />
                      <Field label="Particle Size / Viscosity" value={r["Particle Size / Viscosity"]} />
                      <Field label="Temperature Requirement" value={r["Temperature Requirement"]} />
                      <Field label="Odor/Color Tolerance" value={r["Odor or Color Tolerance"]} />
                      <Field label="Quality Tolerance Range" value={r["Quality Tolerance Range"]} />
                      <Field label="Budget per Ton" value={r["Budget per Ton"]} />
                      <Field label="Contract Type" value={r["Contract Type"]} />
                      <Field label="Certification Needed" value={r["Certification Needed"]} />
                      <Field label="Max Distance (km)" value={r["Max Distance (km)"]} />
                    </div>
                  </div>
                )}

                {/* Raw JSON toggle */}
                <details className="rounded border bg-muted/30 p-3">
                  <summary className="cursor-pointer text-sm font-medium">Show raw JSON</summary>
                  <pre className="mt-2 text-xs overflow-auto max-h-64">
                    {JSON.stringify(wm, null, 2)}
                  </pre>
                </details>

                {/* Actions */}
                <div className="mt-auto flex gap-2">
                  <Button variant="destructive" className="w-full" onClick={() => handleDelete(wm.id)}>
                    Delete
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
