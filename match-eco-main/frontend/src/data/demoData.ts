import type { PortalRecord } from "@/types/portal";

export const DEMO_FACTORIES: PortalRecord[] = [
  {
    "COMMON": {
      "Factory Type": "Waste Generator",
      "Factory Name": "Alpha Thermal Power",
      "Industry Type": "Power Generation",
      "Location": { "lat": 13.0827, "lon": 80.2707 },
      "Certification": "BIS Certified, ISO 14001",
      "Email": "alpha@example.com",
      "Production Capacity": "High",
      "Sustainability Goal": "Circular Economy"
    },
    "GENERATOR": {
      "Waste Category": "Solid",
      "Waste Type Name": "Fly Ash",
      "Waste Composition": "SiO2 55%, Fe2O3 5%",
      "Waste Properties": ["pH Neutral", "Moisture <10%", "Fine Particles"],
      "Quantity Generated": "150 tons",
      "Frequency of Generation": "Weekly",
      "Storage Condition": "Open Storage",
      "Disposal Cost": "₹500 per ton",
      "Certification / Hazard Rating": "Non-hazardous",
      "Preferred Buyer Type": "Cement Factory"
    },
    "Factory ID": "ALPHA-001"
  },
  {
    "COMMON": {
      "Factory Type": "Receiver",
      "Factory Name": "Beta Cement Works",
      "Industry Type": "Cement",
      "Location": { "lat": 12.9850, "lon": 80.2310 },
      "Certification": "BIS Certified, ISO 14001",
      "Email": "beta@example.com",
      "Production Capacity": "High",
      "Sustainability Goal": "Carbon Reduction"
    },
    "RECEIVER": {
      "Raw Material Name": "Fly Ash",
      "Raw Material Category": "Powder",
      "Required Chemical Composition": "SiO2 > 40%, Fe2O3 < 10%",
      "Required Physical Properties": ["High Density", "Low Moisture", "Neutral pH", "Fine Powder", "Non-toxic"],
      "Minimum Purity Level": "80%",
      "Contaminant Tolerance": "<10%",
      "Form of Material Needed": "Powder",
      "Particle Size / Viscosity": "<50 microns",
      "Temperature Requirement": "Ambient",
      "Odor or Color Tolerance": "Slight odor acceptable",
      "Quantity Required": "125 tons per week",
      "Frequency of Requirement": "Weekly",
      "Quality Tolerance Range": "±5%",
      "Budget per Ton": "₹1500 per ton",
      "Contract Type": "Recurring",
      "Certification Needed": "BIS Certified, ISO 14001",
      "Max Distance (km)": 150
    },
    "Factory ID": "BETA-001"
  }
];
