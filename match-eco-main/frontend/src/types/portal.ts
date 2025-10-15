export type PortalRecord = {
  COMMON: {
    "Factory Type"?: "Waste Generator" | "Receiver";
    "Factory Name": string;
    "Industry Type": string;
    "Location": string | { lat: number; lon: number };
    "Certification": string;
    "Email": string;
    "Production Capacity": "Low" | "Medium" | "High";
    "Sustainability Goal": string;
  };
  GENERATOR?: {
    "Waste Category": string;
    "Waste Type Name": string;
    "Waste Composition": string;
    "Waste Properties": string[];
    "Quantity Generated": string;
    "Frequency of Generation": "Daily" | "Weekly" | "Monthly";
    "Storage Condition": string;
    "Disposal Cost": string;
    "Certification / Hazard Rating": string;
    "Preferred Buyer Type": string;
  };
  RECEIVER?: {
    "Raw Material Name": string;
    "Raw Material Category": string;
    "Required Chemical Composition": string;
    "Required Physical Properties": string[];
    "Minimum Purity Level": "70%" | "80%" | "90%" | "95%" | "99%";
    "Contaminant Tolerance": "<5%" | "<10%" | "<20%";
    "Form of Material Needed": string;
    "Particle Size / Viscosity": string;
    "Temperature Requirement": string;
    "Odor or Color Tolerance": string;
    "Quantity Required": string;
    "Frequency of Requirement": "Daily" | "Weekly" | "Monthly";
    "Quality Tolerance Range": "±2%" | "±5%" | "±10%" | "±15%";
    "Budget per Ton": string;
    "Contract Type": "One-time" | "Recurring";
    "Certification Needed": string;
    "Max Distance (km)": number;
  };
  "Factory ID"?: string;
};

export type MatchResult = {
  supplier: string;
  receiver: string;
  material: string;
  distance_km: number;
  score: number;
  matched_qty_tons_week: number;
  transport_cost: number;
  processing_cost: number;
  total_cost: number;
  co2_saved_kg: number;
  eco_efficiency: number;
  sub_scores?: {
    material_match: number;
    distance: number;
    quantity: number;
    cost: number;
  };
};

export type Cycle = {
  id: string;
  nodes: string[];
  edges: Array<{
    from: string;
    to: string;
    score: number;
    eco_efficiency: number;
  }>;
  total_eco_efficiency: number;
};

export type MatchResponse = {
  ranked_matches: MatchResult[];
  detected_cycles: Cycle[];
};
