import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { MapPin, Navigation } from "lucide-react";

interface GeoLocationInputProps {
  label: string;
  value: string | { lat: number; lon: number };
  onChange: (value: string | { lat: number; lon: number }) => void;
  error?: string;
  required?: boolean;
}

export function GeoLocationInput({ label, value, onChange, error, required }: GeoLocationInputProps) {
  const [useCoords, setUseCoords] = useState(typeof value === 'object');

  const handleModeToggle = () => {
    setUseCoords(!useCoords);
    if (!useCoords) {
      onChange({ lat: 0, lon: 0 });
    } else {
      onChange("");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleModeToggle}
          className="h-8"
        >
          {useCoords ? <MapPin className="h-4 w-4 mr-1" /> : <Navigation className="h-4 w-4 mr-1" />}
          {useCoords ? 'Use Address' : 'Use Coordinates'}
        </Button>
      </div>
      
      {useCoords ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Latitude</Label>
            <Input
              type="number"
              step="any"
              value={typeof value === 'object' ? value.lat : ''}
              onChange={(e) => onChange({ 
                lat: parseFloat(e.target.value) || 0, 
                lon: typeof value === 'object' ? value.lon : 0 
              })}
              placeholder="13.0827"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Longitude</Label>
            <Input
              type="number"
              step="any"
              value={typeof value === 'object' ? value.lon : ''}
              onChange={(e) => onChange({ 
                lat: typeof value === 'object' ? value.lat : 0,
                lon: parseFloat(e.target.value) || 0
              })}
              placeholder="80.2707"
            />
          </div>
        </div>
      ) : (
        <Input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="123 Industrial Area, Chennai, Tamil Nadu"
        />
      )}
      
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
