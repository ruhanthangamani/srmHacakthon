import type { PortalRecord } from "@/types/portal";

type Common = PortalRecord["COMMON"];
type Gen = NonNullable<PortalRecord["GENERATOR"]>;
type Rec = NonNullable<PortalRecord["RECEIVER"]>;

export function composePortalRecords(
  common: Common,
  generator: Gen | null,
  receiver: Rec | null,
  roles: ("Waste Generator" | "Receiver")[]
): PortalRecord[] {
  const out: PortalRecord[] = [];
  const base = { ...common };

  if (roles.includes("Waste Generator") && generator) {
    out.push({
      COMMON: { ...base, "Factory Type": "Waste Generator" },
      GENERATOR: generator,
    });
  }
  if (roles.includes("Receiver") && receiver) {
    out.push({
      COMMON: { ...base, "Factory Type": "Receiver" },
      RECEIVER: receiver,
    });
  }
  return out;
}
