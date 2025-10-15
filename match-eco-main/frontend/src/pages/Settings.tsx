import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppStore } from "@/store/useAppStore";
import { Settings as SettingsIcon, Save } from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);

  const [costPerTonKm, setCostPerTonKm] = useState(settings.costPerTonKm);
  const [emissionFactor, setEmissionFactor] = useState(settings.emissionFactor);
  const [substitutionSavings, setSubstitutionSavings] = useState(settings.substitutionSavings);
  const [defaultMaxDistance, setDefaultMaxDistance] = useState(settings.defaultMaxDistance);

  const handleSave = () => {
    updateSettings({
      costPerTonKm,
      emissionFactor,
      substitutionSavings,
      defaultMaxDistance,
    });
    toast.success("Settings saved successfully");
  };

  return (
    <AppShell>
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <SettingsIcon className="h-8 w-8" />
            Settings
          </h1>
          <p className="text-muted-foreground">Configure matching and cost parameters</p>
        </div>

        <Card className="p-6 space-y-6">
          <div className="space-y-2">
            <Label>Cost per Ton-Km (₹)</Label>
            <Input
              type="number"
              value={costPerTonKm}
              onChange={(e) => setCostPerTonKm(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Transportation cost factor for calculating total logistics cost
            </p>
          </div>

          <div className="space-y-2">
            <Label>Emission Factor (kg CO₂ per ton-km)</Label>
            <Input
              type="number"
              step="0.001"
              value={emissionFactor}
              onChange={(e) => setEmissionFactor(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Carbon emissions per unit distance and weight
            </p>
          </div>

          <div className="space-y-2">
            <Label>Substitution Savings (₹ per ton)</Label>
            <Input
              type="number"
              value={substitutionSavings}
              onChange={(e) => setSubstitutionSavings(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Average savings when using waste as raw material substitute
            </p>
          </div>

          <div className="space-y-2">
            <Label>Default Max Distance (km)</Label>
            <Input
              type="number"
              value={defaultMaxDistance}
              onChange={(e) => setDefaultMaxDistance(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Default maximum distance for matching receivers
            </p>
          </div>

          <Button onClick={handleSave} className="w-full">
            <Save className="h-4 w-4 mr-2" />
            Save Settings
          </Button>
        </Card>
      </div>
    </AppShell>
  );
}
