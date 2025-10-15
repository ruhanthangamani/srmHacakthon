// WasteMaterialWizard.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckboxGroup } from "@/components/forms/CheckboxGroup";
import { GeoLocationInput } from "@/components/forms/GeoLocationInput";
import { JsonPreview } from "@/components/JsonPreview";
import { ChevronLeft, ChevronRight, Send } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { composePortalRecords } from "@/utils/composePortalRecords";
import { postMatch } from "@/api/client";
import { toast } from "sonner";
import type { PortalRecord } from "@/types/portal";

const INDUSTRIES = ["Chemical", "Textile", "Cement", "Plastic", "Metal", "Paper", "Food Processing", "Electronics", "Other"];
const CERTIFICATIONS = ["None", "BIS Certified", "ISO 9001", "ISO 14001", "Pollution Board Approved"];
const WASTE_CATEGORIES = ["Solid", "Liquid", "Gas", "Sludge"];
const WASTE_TYPES = ["Plastic Scrap", "Fly Ash", "Metal Shavings", "Dye Sludge", "Used Oil", "Paper Waste", "E-waste", "Other"];
const WASTE_PROPERTIES = ["pH Neutral", "Moisture <10%", "Non-hazardous", "Flammable", "High Density", "Fine Particles"];
const FREQUENCIES = ["Daily", "Weekly", "Monthly"];
const MATERIAL_CATEGORIES = ["Solid", "Liquid", "Powder", "Slurry"];
const MATERIAL_NAMES = ["Fly Ash", "HDPE Pellets", "Iron Scrap", "Waste Paper", "Used Oil", "Plastic Flakes", "Metal Dust", "Other"];
const PHYSICAL_PROPS = ["High Density", "Low Moisture", "Neutral pH", "Fine Powder", "Non-toxic"];

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:5050/api";

export default function WasteMaterialWizard() {
  const navigate = useNavigate();
  const addWasteMaterial = useAppStore((s) => s.addWasteMaterial);
  const setMatchResults = useAppStore((s) => s.setMatchResults);

  // auth
  const tokenFromStore = useAppStore((s) => s.token) as string | null;
  const userFromStore = useAppStore((s) => (s as any).user) as { email?: string } | null;
  const token = tokenFromStore ?? (typeof window !== "undefined" ? localStorage.getItem("token") : null);
  const [userEmail, setUserEmail] = useState<string>(userFromStore?.email || "");

  // roles
  const [step, setStep] = useState(1);
  const [roles, setRoles] = useState<("Waste Generator" | "Receiver")[]>([]);

  // Common fields (email removed – taken from auth)
  const [wasteMaterialName, setWasteMaterialName] = useState("");
  const [industryType, setIndustryType] = useState("");
  const [location, setLocation] = useState<string | { lat: number; lon: number }>("");
  const [productionCapacity, setProductionCapacity] = useState<"Low" | "Medium" | "High">("Medium");
  const [certification, setCertification] = useState<string[]>([]);
  const [sustainabilityGoal, setSustainabilityGoal] = useState("");

  // Generator fields
  const [wasteCategory, setWasteCategory] = useState("");
  const [wasteTypeName, setWasteTypeName] = useState("");
  const [wasteComposition, setWasteComposition] = useState("");
  const [wasteProperties, setWasteProperties] = useState<string[]>([]);
  const [quantityGenerated, setQuantityGenerated] = useState("");
  const [frequencyGeneration, setFrequencyGeneration] = useState<"Daily" | "Weekly" | "Monthly">("Weekly");
  const [storageCondition, setStorageCondition] = useState("");
  const [disposalCost, setDisposalCost] = useState("");
  const [hazardRating, setHazardRating] = useState("");
  const [preferredBuyer, setPreferredBuyer] = useState("");

  // Receiver fields
  const [rawMaterialName, setRawMaterialName] = useState("");
  const [rawMaterialCategory, setRawMaterialCategory] = useState("");
  const [requiredComposition, setRequiredComposition] = useState("");
  const [requiredProperties, setRequiredProperties] = useState<string[]>([]);
  const [minPurity, setMinPurity] = useState<"70%" | "80%" | "90%" | "95%" | "99%">("80%");
  const [contaminantTolerance, setContaminantTolerance] = useState<"<5%" | "<10%" | "<20%">("<10%");
  const [formNeeded, setFormNeeded] = useState("");
  const [particleSize, setParticleSize] = useState("");
  const [temperatureReq, setTemperatureReq] = useState("");
  const [odorColor, setOdorColor] = useState("");
  const [quantityRequired, setQuantityRequired] = useState("");
  const [frequencyRequirement, setFrequencyRequirement] = useState<"Daily" | "Weekly" | "Monthly">("Weekly");
  const [qualityTolerance, setQualityTolerance] = useState<"±2%" | "±5%" | "±10%" | "±15%">("±5%");
  const [budgetPerTon, setBudgetPerTon] = useState("");
  const [contractType, setContractType] = useState<"One-time" | "Recurring">("Recurring");
  const [certificationNeeded, setCertificationNeeded] = useState("");
  const [maxDistance, setMaxDistance] = useState(150);

  const totalSteps = useMemo(
    () => 2 + (roles.includes("Waste Generator") ? 1 : 0) + (roles.includes("Receiver") ? 1 : 0),
    [roles]
  );

  // fetch email from backend if not in store
  useEffect(() => {
    if (!token) {
      toast.error("Please sign in");
      navigate("/auth/login");
      return;
    }
    if (userEmail) return;

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) {
          toast.error("Session expired. Please sign in again.");
          navigate("/auth/login");
          return;
        }
        if (!res.ok) throw new Error("Failed to fetch profile");
        const me = await res.json();
        setUserEmail(me?.email || "");
      } catch (e: any) {
        console.error(e);
        toast.error("Could not fetch profile");
      }
    })();
  }, [token, userEmail, navigate]);

  const handleNext = () => {
    if (step === 1 && roles.length === 0) {
      toast.error("Please select at least one role");
      return;
    }
    setStep((s) => s + 1);
  };

  const handlePrev = () => setStep((s) => s - 1);

  const buildCommon = (): PortalRecord["COMMON"] => ({
    "Factory Name": wasteMaterialName,
    "Industry Type": industryType,
    "Location": location,
    "Certification": certification.join(", "),
    "Email": userEmail, // ← from auth, not user input
    "Production Capacity": productionCapacity,
    "Sustainability Goal": sustainabilityGoal,
  });

  const buildGenerator = () =>
    roles.includes("Waste Generator")
      ? {
          "Waste Category": wasteCategory,
          "Waste Type Name": wasteTypeName,
          "Waste Composition": wasteComposition,
          "Waste Properties": wasteProperties,
          "Quantity Generated": quantityGenerated,
          "Frequency of Generation": frequencyGeneration,
          "Storage Condition": storageCondition,
          "Disposal Cost": disposalCost,
          "Certification / Hazard Rating": hazardRating,
          "Preferred Buyer Type": preferredBuyer,
        }
      : null;

  const buildReceiver = () =>
    roles.includes("Receiver")
      ? {
          "Raw Material Name": rawMaterialName,
          "Raw Material Category": rawMaterialCategory,
          "Required Chemical Composition": requiredComposition,
          "Required Physical Properties": requiredProperties,
          "Minimum Purity Level": minPurity,
          "Contaminant Tolerance": contaminantTolerance,
          "Form of Material Needed": formNeeded,
          "Particle Size / Viscosity": particleSize,
          "Temperature Requirement": temperatureReq,
          "Odor or Color Tolerance": odorColor,
          "Quantity Required": quantityRequired,
          "Frequency of Requirement": frequencyRequirement,
          "Quality Tolerance Range": qualityTolerance,
          "Budget per Ton": budgetPerTon,
          "Contract Type": contractType,
          "Certification Needed": certificationNeeded,
          "Max Distance (km)": maxDistance,
        }
      : null;

  const getPayload = () => composePortalRecords(buildCommon(), buildGenerator(), buildReceiver(), roles);

  const handleSubmit = async () => {
    if (!token) {
      toast.error("Please sign in");
      navigate("/auth/login");
      return;
    }
    if (!userEmail) {
      toast.error("Your account email is missing");
      return;
    }
    if (!wasteMaterialName || !industryType || !location) {
      toast.error("Please complete required fields");
      return;
    }

    // store locally
    const records = getPayload();
    records.forEach((record) => addWasteMaterial(record));

    try {
      // save to DB (no email/password prompt; uses JWT)
      const res = await fetch(`${API_BASE}/factories/full`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          common: buildCommon(),
          generator: buildGenerator(),
          receiver: buildReceiver(),
          roles,
        }),
      });

      if (res.status === 401) {
        toast.error("Session expired. Please sign in again.");
        navigate("/auth/login");
        return;
      }
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `Save failed (${res.status})`);
      }

      // run matcher
      const result = await postMatch(records);
      setMatchResults(result);

      toast.success("Waste material saved and matches generated!");
      navigate("/match");
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || "Failed to submit. Please check backend connection.");
      navigate("/dashboard");
    }
  };

  // ---- steps UI ----
  const renderStep = () => {
    if (step === 1) {
      return (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold">Waste Material Details</h2>

          <CheckboxGroup
            label="Roles"
            options={["Waste Generator", "Receiver"]}
            value={roles}
            onChange={(v) => setRoles(v as any)}
            required
          />

          <div className="space-y-2">
            <Label>Waste Material Name *</Label>
            <Input value={wasteMaterialName} onChange={(e) => setWasteMaterialName(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label>Industry Type *</Label>
            <Select value={industryType} onValueChange={setIndustryType}>
              <SelectTrigger>
                <SelectValue placeholder="Select industry" />
              </SelectTrigger>
              <SelectContent>
                {INDUSTRIES.map((i) => (
                  <SelectItem key={i} value={i}>
                    {i}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Email/password inputs removed – we use authenticated user's email */}
          <div className="space-y-1 text-sm text-muted-foreground">
            <span>Submitting as: </span>
            <span className="font-medium">{userEmail || "…"}</span>
          </div>

          <GeoLocationInput label="Location" value={location} onChange={setLocation} required />

          <div className="space-y-2">
            <Label>Production Capacity</Label>
            <Select value={productionCapacity} onValueChange={(v: any) => setProductionCapacity(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Low">Low</SelectItem>
                <SelectItem value="Medium">Medium</SelectItem>
                <SelectItem value="High">High</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <CheckboxGroup label="Certification" options={CERTIFICATIONS} value={certification} onChange={setCertification} />

          <div className="space-y-2">
            <Label>Sustainability Goal</Label>
            <Input value={sustainabilityGoal} onChange={(e) => setSustainabilityGoal(e.target.value)} />
          </div>
        </div>
      );
    }

    if (roles.includes("Waste Generator") && step === 2) {
      return (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold">Waste Generator Details</h2>

          <div className="space-y-2">
            <Label>Waste Category</Label>
            <Select value={wasteCategory} onValueChange={setWasteCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {WASTE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Waste Type Name</Label>
            <Select value={wasteTypeName} onValueChange={setWasteTypeName}>
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {WASTE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Waste Composition</Label>
            <Textarea value={wasteComposition} onChange={(e) => setWasteComposition(e.target.value)} />
          </div>

          <CheckboxGroup label="Waste Properties" options={WASTE_PROPERTIES} value={wasteProperties} onChange={setWasteProperties} />

          <div className="space-y-2">
            <Label>Quantity Generated</Label>
            <Input value={quantityGenerated} onChange={(e) => setQuantityGenerated(e.target.value)} placeholder="e.g., 150 tons" />
          </div>

          <div className="space-y-2">
            <Label>Frequency of Generation</Label>
            <Select value={frequencyGeneration} onValueChange={(v: any) => setFrequencyGeneration(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Storage Condition</Label>
            <Input value={storageCondition} onChange={(e) => setStorageCondition(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Disposal Cost</Label>
            <Input value={disposalCost} onChange={(e) => setDisposalCost(e.target.value)} placeholder="₹500 per ton" />
          </div>

          <div className="space-y-2">
            <Label>Hazard Rating</Label>
            <Input value={hazardRating} onChange={(e) => setHazardRating(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Preferred Buyer Type</Label>
            <Input value={preferredBuyer} onChange={(e) => setPreferredBuyer(e.target.value)} />
          </div>
        </div>
      );
    }

    const receiverStep = roles.includes("Waste Generator") ? 3 : 2;
    if (roles.includes("Receiver") && step === receiverStep) {
      return (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold">Material Receiver Details</h2>

          <div className="space-y-2">
            <Label>Raw Material Name</Label>
            <Select value={rawMaterialName} onValueChange={setRawMaterialName}>
              <SelectTrigger>
                <SelectValue placeholder="Select material" />
              </SelectTrigger>
              <SelectContent>
                {MATERIAL_NAMES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Raw Material Category</Label>
            <Select value={rawMaterialCategory} onValueChange={setRawMaterialCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {MATERIAL_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Required Chemical Composition</Label>
            <Textarea
              value={requiredComposition}
              onChange={(e) => setRequiredComposition(e.target.value)}
              placeholder="e.g., SiO₂ > 40%, Fe₂O₃ < 10%"
            />
          </div>

          <CheckboxGroup
            label="Required Physical Properties"
            options={PHYSICAL_PROPS}
            value={requiredProperties}
            onChange={setRequiredProperties}
          />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Minimum Purity Level</Label>
              <Select value={minPurity} onValueChange={(v: any) => setMinPurity(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["70%", "80%", "90%", "95%", "99%"].map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Contaminant Tolerance</Label>
              <Select value={contaminantTolerance} onValueChange={(v: any) => setContaminantTolerance(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["<5%", "<10%", "<20%"].map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Form of Material Needed</Label>
            <Input value={formNeeded} onChange={(e) => setFormNeeded(e.target.value)} placeholder="Granules, Powder, etc." />
          </div>

          <div className="space-y-2">
            <Label>Particle Size / Viscosity</Label>
            <Input value={particleSize} onChange={(e) => setParticleSize(e.target.value)} placeholder="<50 microns" />
          </div>

          <div className="space-y-2">
            <Label>Temperature Requirement</Label>
            <Input value={temperatureReq} onChange={(e) => setTemperatureReq(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Odor or Color Tolerance</Label>
            <Input value={odorColor} onChange={(e) => setOdorColor(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Quantity Required</Label>
            <Input value={quantityRequired} onChange={(e) => setQuantityRequired(e.target.value)} placeholder="200 tons per month" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Frequency of Requirement</Label>
              <Select value={frequencyRequirement} onValueChange={(v: any) => setFrequencyRequirement(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Quality Tolerance Range</Label>
              <Select value={qualityTolerance} onValueChange={(v: any) => setQualityTolerance(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["±2%", "±5%", "±10%", "±15%"].map((q) => (
                    <SelectItem key={q} value={q}>
                      {q}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Budget per Ton</Label>
            <Input value={budgetPerTon} onChange={(e) => setBudgetPerTon(e.target.value)} placeholder="₹1500 per ton" />
          </div>

          <div className="space-y-2">
            <Label>Contract Type</Label>
            <Select value={contractType} onValueChange={(v: any) => setContractType(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="One-time">One-time</SelectItem>
                <SelectItem value="Recurring">Recurring</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Certification Needed</Label>
            <Input value={certificationNeeded} onChange={(e) => setCertificationNeeded(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Max Distance (km)</Label>
            <Input type="number" value={maxDistance} onChange={(e) => setMaxDistance(Number(e.target.value))} />
          </div>
        </div>
      );
    }

    // Review & Submit
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold">Review & Submit</h2>
        <p className="text-muted-foreground">Review the data that will be submitted to the matching service:</p>
        <JsonPreview data={getPayload()} title="Payload to Submit" />
      </div>
    );
  };

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Register New Waste Material</h1>
          <p className="text-muted-foreground">
            Step {step} of {totalSteps}
          </p>
        </div>

        <div className="w-full bg-muted rounded-full h-2">
          <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${(step / totalSteps) * 100}%` }} />
        </div>

        <Card className="p-6">{renderStep()}</Card>

        <div className="flex justify-between">
          <Button variant="outline" onClick={handlePrev} disabled={step === 1}>
            <ChevronLeft className="h-4 w-4 mr-2" />
            Previous
          </Button>

          {step < totalSteps ? (
            <Button onClick={handleNext}>
              Next
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button onClick={handleSubmit}>
              Submit
              <Send className="h-4 w-4 ml-2" />
            </Button>
          )}
        </div>
      </div>
    </AppShell>
  );
}
