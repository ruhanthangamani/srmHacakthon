import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PortalRecord, MatchResponse } from '@/types/portal';

interface AppState {
  // Auth
  token: string | null;
  setToken: (token: string | null) => void;
  
  // Waste Materials
  wasteMaterials: PortalRecord[];
  addWasteMaterial: (wasteMaterial: PortalRecord) => void;
  
  // Match results
  matchResults: MatchResponse | null;
  setMatchResults: (results: MatchResponse) => void;
  
  // Settings
  settings: {
    costPerTonKm: number;
    emissionFactor: number;
    substitutionSavings: number;
    defaultMaxDistance: number;
  };
  updateSettings: (settings: Partial<AppState['settings']>) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      token: null,
      setToken: (token) => set({ token }),
      
  wasteMaterials: [],
      addWasteMaterial: (wasteMaterial) => set((state) => ({ 
        wasteMaterials: [...state.wasteMaterials, wasteMaterial] 
      })),
      
      matchResults: null,
      setMatchResults: (results) => set({ matchResults: results }),
      
      settings: {
        costPerTonKm: 15,
        emissionFactor: 0.062,
        substitutionSavings: 1200,
        defaultMaxDistance: 150,
      },
      updateSettings: (newSettings) => set((state) => ({
        settings: { ...state.settings, ...newSettings }
      })),
    }),
    {
      name: 'portal-storage',
    }
  )
);
