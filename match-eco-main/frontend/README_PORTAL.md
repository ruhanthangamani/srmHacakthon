# Industrial Waste Matching Portal

A comprehensive React TypeScript SPA for matching industrial waste generators with material receivers, enabling circular economy workflows.

## Features

- **Multi-Role Selection**: Register as Waste Generator, Receiver, or Both
- **Smart Wizard**: Conditional form steps based on selected roles
- **Dual Record Submission**: Automatically creates separate records when "Both" roles are selected
- **Match Analytics**: View ranked matches with detailed scoring, costs, and eco-efficiency metrics
- **Cycle Detection**: Visualize circular economy opportunities through detected material cycles
- **Geographic View**: Map-based visualization of matches (Leaflet)
- **Data Export**: CSV export functionality for match results
- **Demo Mode**: Preloaded sample data for testing without backend

## Tech Stack

- **Frontend**: Vite + React 18 + TypeScript
- **Styling**: Tailwind CSS + shadcn/ui components
- **State**: Zustand (persistent localStorage)
- **Forms**: react-hook-form + Zod validation
- **Routing**: React Router v6
- **Charts**: Recharts
- **Maps**: Leaflet + react-leaflet
- **Graphs**: react-force-graph (for cycles)

## Getting Started

### Installation

\`\`\`bash
npm install
\`\`\`

### Environment Setup

Create a \`.env\` file in the root:

\`\`\`
VITE_API_BASE=http://localhost:5000
\`\`\`

### Development Server

\`\`\`bash
npm run dev
\`\`\`

The app will be available at http://localhost:8080

### Backend Integration

The app expects a Flask backend with the following endpoint:

**POST /match**
- Body: Array of \`PortalRecord\` objects
- Response: \`{ ranked_matches: MatchResult[], detected_cycles: Cycle[] }\`

See \`src/types/portal.ts\` for exact type definitions.

## Project Structure

\`\`\`
src/
├── api/              # API client
├── components/       # Reusable UI components
│   ├── forms/       # Form-specific components
│   └── ui/          # shadcn components
├── data/            # Demo data
├── pages/           # Route pages
│   ├── auth/       # Auth pages
│   └── factories/  # Factory wizard
├── store/           # Zustand store
├── types/           # TypeScript types
└── utils/           # Utility functions
\`\`\`

## Key Pages

- \`/\` - Landing page with features overview
- \`/auth/login\` - Login
- \`/auth/register\` - Registration
- \`/dashboard\` - Main dashboard with KPIs
- \`/factories/new\` - Multi-step wizard for factory registration
- \`/match\` - Match results with filters, sorting, and map
- \`/cycles\` - Cycle detection and visualization
- \`/settings\` - Configuration for costs and parameters

## Wizard Flow

1. **Common Details** (Step 1)
   - Roles selection (checkboxes)
   - Factory name, industry, email, password
   - Location (toggle: address or lat/lon)
   - Certifications, capacity, sustainability goals

2. **Generator Details** (Step 2A - if selected)
   - Waste category, type, composition
   - Properties, quantity, frequency
   - Storage, disposal cost, hazard rating

3. **Receiver Details** (Step 2B or 3 - if selected)
   - Raw material requirements
   - Chemical composition, physical properties
   - Purity, tolerance, form, particle size
   - Quantity, frequency, budget, contract type

4. **Review** (Final Step)
   - JSON preview of exact payload
   - Copy-to-clipboard functionality

## Role-Based Submission

- **Only Generator**: Submits 1 record with GENERATOR data
- **Only Receiver**: Submits 1 record with RECEIVER data
- **Both**: Submits 2 records:
  - Record 1: COMMON + GENERATOR (Factory Type = "Waste Generator")
  - Record 2: COMMON + RECEIVER (Factory Type = "Receiver")

See \`src/utils/composePortalRecords.ts\` for implementation.

## Demo Data

Click "See Demo" on landing page or "Load Demo Data" on dashboard to populate sample factories and navigate to dashboard.

## Building for Production

\`\`\`bash
npm run build
\`\`\`

Output will be in \`dist/\` directory.

## License

MIT
