# Core matching engine, portal adapter, economics, and cycle detection.
# Standard library only.

from __future__ import annotations
from math import radians, sin, cos, sqrt, atan2
from typing import Dict, Any, List, Tuple, Optional, Set, Callable
import re

# ===================== Tunables =====================
COST_PER_TON_KM = 7.0                     # ₹ per ton-km (transport)
EF_TRUCK_KGCO2_PER_TONKM = 0.10           # kg CO2 per ton-km (placeholder)
SUBSTITUTION_SAVINGS_KGCO2_PER_TON = 200.0  # kg CO2 saved per ton substituted (placeholder)
WEEKS_PER_MONTH = 4.345

# ===================== Distance =====================
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlambda = radians(lon2 - lon1)
    a = sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(dlambda / 2) ** 2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    return R * c

# ===================== Parsing helpers =====================
def _strip_pct(s: str) -> str:
    return s.strip().replace("%", "")

def _parse_number(s: str) -> Optional[float]:
    try:
        return float(s.strip())
    except Exception:
        return None

def _parse_actual_value(val: Any) -> Optional[float]:
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        s = val.strip()
        if s.endswith("%"):
            return _parse_number(_strip_pct(s))
        return _parse_number(s)
    return None

def _parse_requirement(req: Any) -> Tuple[str, Optional[float], Optional[float]]:
    if req is None:
        return ("any", None, None)
    if isinstance(req, (int, float)):
        return ("eq", float(req), None)
    if isinstance(req, str):
        s = req.strip()
        if s.startswith(">"):
            return ("gt", _parse_number(_strip_pct(s[1:])), None)
        if s.startswith("<"):
            return ("lt", _parse_number(_strip_pct(s[1:])), None)
        if "-" in s and not s.startswith("-"):
            a, b = s.split("-", 1)
            a = _parse_number(_strip_pct(a)); b = _parse_number(_strip_pct(b))
            if a is not None and b is not None and a <= b:
                return ("range", a, b)
        num = _parse_number(_strip_pct(s))
        if num is not None:
            return ("eq", num, None)
    return ("any", None, None)

def _score_against_requirement(actual: Optional[float], req: Any) -> float:
    if actual is None:
        return 0.0
    mode, a, b = _parse_requirement(req)
    clamp = lambda x: max(0.0, min(1.0, x))

    if mode == "any":
        return 1.0
    if mode == "gt" and a is not None:
        if actual >= a: return 1.0
        tol = max(1e-6, 0.20 * a)
        return clamp((actual - (a - tol)) / tol)
    if mode == "lt" and a is not None:
        if actual <= a: return 1.0
        tol = max(1e-6, 0.20 * a)
        return clamp(((a + tol) - actual) / tol)
    if mode == "range" and a is not None and b is not None:
        if a <= actual <= b: return 1.0
        width = max(1e-6, b - a); tol = 0.20 * width
        return clamp((actual - (a - tol)) / tol) if actual < a else clamp(((b + tol) - actual) / tol)
    if mode == "eq" and a is not None:
        t = a
        if t == 0: return 1.0 if actual == 0 else 0.0
        diff = abs(actual - t); p = 0.05 * abs(t); z = 0.20 * abs(t)
        if diff <= p: return 1.0
        if diff >= z: return 0.0
        return (z - diff) / (z - p)
    return 0.0

def _material_score(supplier_material: Dict[str, Any], receiver_req: Dict[str, Any]) -> float:
    sup_comp = (supplier_material or {}).get("chemical_composition", {}) or {}
    sup_phys = (supplier_material or {}).get("physical_properties", {}) or {}
    req_comp = (receiver_req or {}).get("required_composition", {}) or {}
    req_phys = (receiver_req or {}).get("required_properties", {}) or {}

    scores: List[float] = []
    for k, req_expr in req_comp.items():
        scores.append(_score_against_requirement(_parse_actual_value(sup_comp.get(k)), req_expr))
    for k, req_expr in req_phys.items():
        actual_val = _parse_actual_value(sup_phys.get(k))
        if isinstance(req_expr, str) and re.search(r"[<>-]|\d", req_expr):
            scores.append(_score_against_requirement(actual_val, req_expr))
        else:
            a = str(sup_phys.get(k, "")).strip().lower()
            b = str(req_expr).strip().lower()
            scores.append(1.0 if (not b or a == b) else 0.0)
    return (sum(scores) / len(scores)) if scores else 1.0

# ===================== Hard filters & scoring =====================
def _has_required_certs(supplier: Dict[str, Any], receiver: Dict[str, Any]) -> bool:
    req = set((receiver.get("certifications_required") or []))
    sup = set((supplier.get("certifications") or []))
    return req.issubset(sup)

def _material_type_matches(supplier: Dict[str, Any], receiver: Dict[str, Any]) -> bool:
    stype = ((supplier.get("waste_output") or {}).get("material_type") or "").strip().lower()
    rtype = ((receiver.get("material_requirement") or {}).get("material_type") or "").strip().lower()
    return stype != "" and (stype == rtype)

def _within_max_distance_km(supplier: Dict[str, Any], receiver: Dict[str, Any]) -> Tuple[bool, float, float]:
    sloc = supplier.get("location") or {}
    rloc = receiver.get("location") or {}
    try:
        d = haversine_km(float(sloc["lat"]), float(sloc["lon"]), float(rloc["lat"]), float(rloc["lon"]))
    except Exception:
        return (False, float("inf"), 0.0)
    max_d = float(((receiver.get("logistics") or {}).get("max_distance_km") or 0))
    return (d <= max_d, d, max_d)

def _distance_score(actual_distance: float, max_distance: float) -> float:
    if max_distance <= 0: return 0.0
    return max(0.0, min(1.0, 1.0 - actual_distance / max_distance))

def _quantity_score(supplier_qty: float, receiver_qty: float) -> float:
    if receiver_qty <= 0: return 1.0
    return max(0.0, min(1.0, min(supplier_qty, receiver_qty) / receiver_qty))

def _compute_scores(supplier: Dict[str, Any], receiver: Dict[str, Any], distance_km: float, max_distance_km: float) -> Dict[str, float]:
    sup_out = supplier.get("waste_output") or {}
    rec_req = receiver.get("material_requirement") or {}
    mat_score = _material_score(sup_out, rec_req)
    dist_score = _distance_score(distance_km, max_distance_km)
    qty_score = _quantity_score(float(sup_out.get("quantity_tons") or 0.0), float(rec_req.get("quantity_tons") or 0.0))
    final = (0.50 * mat_score + 0.30 * dist_score + 0.20 * qty_score) * 100.0
    return {"material_score": mat_score, "distance_score": dist_score, "quantity_score": qty_score, "compatibility_score": final}

# ===================== Economics & Environment =====================
def _evaluate_economics_env(supplier: Dict[str, Any], receiver: Dict[str, Any], distance_km: float) -> Dict[str, float]:
    sup_out = supplier.get("waste_output") or {}
    rec_req = receiver.get("material_requirement") or {}
    sup_qty = float(sup_out.get("quantity_tons") or 0.0)
    rec_qty = float(rec_req.get("quantity_tons") or 0.0)
    matched_qty = min(sup_qty, rec_qty)
    processing_cost_per_ton = float(rec_req.get("processing_cost_per_ton") or 0.0)
    transport_cost = distance_km * matched_qty * COST_PER_TON_KM
    total_cost = transport_cost + processing_cost_per_ton * matched_qty
    landfill_km = float(sup_out.get("current_disposal_landfill_km") or 0.0)
    landfill_transport_emissions = landfill_km * sup_qty * EF_TRUCK_KGCO2_PER_TONKM
    new_transport_emissions = distance_km * matched_qty * EF_TRUCK_KGCO2_PER_TONKM
    material_substitution_savings = matched_qty * SUBSTITUTION_SAVINGS_KGCO2_PER_TON
    co2_saved_kg = (landfill_transport_emissions - new_transport_emissions) + material_substitution_savings
    eco_efficiency_score = (co2_saved_kg / total_cost) if total_cost > 0 else float("inf")
    return {
        "matched_quantity_tons": matched_qty,
        "transport_cost": transport_cost,
        "total_cost": total_cost,
        "co2_saved_kg": co2_saved_kg,
        "eco_efficiency_score": eco_efficiency_score
    }

# ===================== Matching engine =====================
def compute_ranked_matches(suppliers: List[Dict[str, Any]], receivers: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    matches: List[Dict[str, Any]] = []
    for s in suppliers:
        for r in receivers:
            if not _material_type_matches(s, r): continue
            within, dist_km, max_km = _within_max_distance_km(s, r)
            if not within: continue
            if not _has_required_certs(s, r): continue
            sc = _compute_scores(s, r, dist_km, max_km)
            eco = _evaluate_economics_env(s, r, dist_km)
            matches.append({
                "supplier_id": s.get("factory_id"),
                "supplier_name": s.get("factory_name"),
                "receiver_id": r.get("factory_id"),
                "receiver_name": r.get("factory_name"),
                "material_type": (s.get("waste_output") or {}).get("material_type"),
                "distance_km": dist_km,
                "max_distance_km": max_km,
                "scores": sc,
                "economics": eco
            })
    matches.sort(key=lambda m: (m["scores"]["compatibility_score"], m["economics"]["eco_efficiency_score"]), reverse=True)
    return matches

# ===================== Cycle detection =====================
def _build_graph(matches: List[Dict[str, Any]], threshold: float = 80.0) -> Dict[str, Set[str]]:
    g: Dict[str, Set[str]] = {}
    for m in matches:
        if m["scores"]["compatibility_score"] > threshold:
            u, v = m["supplier_id"], m["receiver_id"]
            if u is None or v is None: continue
            g.setdefault(u, set()).add(v)
            g.setdefault(v, set())
    return g

def _edge_lookup(matches: List[Dict[str, Any]]) -> Dict[Tuple[str, str], Dict[str, Any]]:
    return {(m["supplier_id"], m["receiver_id"]): m for m in matches}

def _find_elementary_cycles(graph: Dict[str, Set[str]]) -> List[List[str]]:
    nodes = sorted(graph.keys())
    index = {n: i for i, n in enumerate(nodes)}
    cycles: List[List[str]] = []

    def dfs(start: str, current: str, path: List[str], blocked: Set[str]):
        for nxt in graph.get(current, []):
            if index[nxt] < index[start]:  # avoid dups
                continue
            if nxt == start:
                cycles.append(path + [start])
            elif nxt not in blocked:
                blocked.add(nxt)
                dfs(start, nxt, path + [nxt], blocked)
                blocked.remove(nxt)

    for s in nodes:
        dfs(s, s, [s], set([s]))

    canon: Set[Tuple[str, ...]] = set()
    unique_cycles: List[List[str]] = []
    for cyc in cycles:
        core = cyc[:-1] if (len(cyc) >= 3 and cyc[0] == cyc[-1]) else cyc
        if len(core) < 2: continue
        mins = min(core); min_idx = core.index(mins)
        rotated = core[min_idx:] + core[:min_idx]
        key = tuple(rotated)
        if key not in canon:
            canon.add(key); unique_cycles.append(rotated)
    return unique_cycles

def _evaluate_cycles(cycles: List[List[str]], edge_map: Dict[Tuple[str, str], Dict[str, Any]]) -> List[Dict[str, Any]]:
    evaluated: List[Dict[str, Any]] = []
    for cyc in cycles:
        total_cost = 0.0; total_co2_saved = 0.0; edges: List[Dict[str, Any]] = []
        for i in range(len(cyc)):
            u, v = cyc[i], cyc[(i + 1) % len(cyc)]
            edge = edge_map.get((u, v))
            if edge is None: edges = []; break
            econ, sc = (edge.get("economics") or {}), (edge.get("scores") or {})
            total_cost += float(econ.get("total_cost") or 0.0)
            total_co2_saved += float(econ.get("co2_saved_kg") or 0.0)
            edges.append({"from": u, "to": v,
                        "compatibility_score": sc.get("compatibility_score"),
                        "eco_efficiency_score": econ.get("eco_efficiency_score")})
        if edges:
            evaluated.append({
                "cycle_nodes": cyc,
                "edges": edges,
                "aggregate_total_cost": total_cost,
                "aggregate_co2_saved_kg": total_co2_saved,
                "aggregate_eco_efficiency_score": (total_co2_saved / total_cost) if total_cost > 0 else float("inf")
            })
    evaluated.sort(key=lambda c: c["aggregate_eco_efficiency_score"], reverse=True)
    return evaluated

# ===================== Orchestrators =====================
def process_requests(suppliers: List[Dict[str, Any]], receivers: List[Dict[str, Any]]) -> Dict[str, Any]:
    ranked = compute_ranked_matches(suppliers, receivers)
    graph = _build_graph(ranked, threshold=80.0)
    cycles = _find_elementary_cycles(graph)
    edge_map = _edge_lookup(ranked)
    evaluated_cycles = _evaluate_cycles(cycles, edge_map)
    return {"ranked_matches": ranked, "detected_cycles": evaluated_cycles}

# ---------- Portal Adapter (for Lovable UI payloads) ----------
GeocodeFn = Optional[Callable[[str], Optional[Tuple[float, float]]]]

def _resolve_location(raw_location: Any, geocode_fn: GeocodeFn) -> Optional[Dict[str, float]]:
    if isinstance(raw_location, dict) and "lat" in raw_location and "lon" in raw_location:
        try:
            return {"lat": float(raw_location["lat"]), "lon": float(raw_location["lon"])}
        except Exception:
            return None
    if isinstance(raw_location, str) and geocode_fn:
        try:
            res = geocode_fn(raw_location)
            if res and len(res) == 2:
                lat, lon = res
                return {"lat": float(lat), "lon": float(lon)}
        except Exception:
            return None
    return None

_QTY_RE = re.compile(r"^\s*([\d\.]+)\s*(kg|kgs|kilogram|kilograms|t|ton|tons|tonne|tonnes)?\s*(?:per\s*(day|week|month))?\s*$", re.I)

def _parse_quantity_with_unit(s: str) -> Tuple[Optional[float], Optional[str], Optional[str]]:
    if not isinstance(s, str): return (None, None, None)
    m = _QTY_RE.match(s); 
    if not m: return (None, None, None)
    val = _parse_number(m.group(1)); unit_raw = (m.group(2) or "").lower(); period = (m.group(3) or "").lower() or None
    unit = "kg" if unit_raw in ("kg","kgs","kilogram","kilograms") else ("t" if unit_raw in ("t","ton","tons","tonne","tonnes","mt") else None)
    return (val, unit, period)

def _to_tons(val: Optional[float], unit: Optional[str]) -> Optional[float]:
    if val is None: return None
    if unit == "kg": return val / 1000.0
    if unit in (None, "t"): return val
    return None

def _period_to_week_factor(period: Optional[str]) -> float:
    if period is None: return 1.0
    return 7.0 if period == "day" else (1.0 if period == "week" else (1.0 / WEEKS_PER_MONTH if period == "month" else 1.0))

def _normalize_qty_freq(quantity_str: Optional[str], frequency_str: Optional[str]) -> Tuple[float, str]:
    qty_tons_week = 0.0
    if quantity_str:
        v,u,per = _parse_quantity_with_unit(quantity_str); t = _to_tons(v,u) if v is not None else None
        if t is not None:
            qty_tons_week = t * _period_to_week_factor(per) if per else t
    if qty_tons_week == 0.0 and frequency_str:
        freq = frequency_str.strip().lower(); v,u,_ = _parse_quantity_with_unit(quantity_str or ""); t = _to_tons(v,u) if v is not None else None
        if t is not None:
            if freq == "daily": qty_tons_week = t * 7.0
            elif freq == "weekly": qty_tons_week = t
            elif freq == "monthly": qty_tons_week = t / WEEKS_PER_MONTH
    return (qty_tons_week, "weekly")

def _parse_composition_text(s: Optional[str]) -> Dict[str, str]:
    if not s: return {}
    parts = re.split(r"[;,]\s*", s.strip(" ."))
    out: Dict[str, str] = {}
    for p in parts:
        m1 = re.search(r"(?P<val>\d+(\.\d+)?)\s*%?\s*(?P<key>[A-Za-z0-9\(\)\._\-\+]+)", p)
        m2 = re.search(r"(?P<key>[A-Za-z0-9\(\)\._\-\+]+)\s*(?P<val>\d+(\.\d+)?)\s*%?", p)
        m = m1 or m2
        if m:
            out[m.group("key")] = f'{m.group("val")}%'
    return out

def _parse_requirements_text(s: Optional[str]) -> Dict[str, str]:
    if not s: return {}
    s = s.replace("Requires", "").replace("require", "")
    parts = re.split(r"[;,]\s*", s.strip(" ."))
    out: Dict[str, str] = {}
    for p in parts:
        m = re.search(r"([A-Za-z0-9\(\)\._\-\+]+)\s*(>=|<=|>|<|=)?\s*(\d+(\.\d+)?)\s*%?", p)
        if m:
            key, op, num = m.group(1), (m.group(2) or "="), m.group(3)
            if op == "=": out[key] = f"{num}%"
            else: out[key] = f"{op}{num}%"
    return out

def _generator_properties_from_checkboxes(opts: List[str]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}; s = set(x.strip().lower() for x in (opts or []))
    if "pH neutral".lower() in s: out["pH"] = "6.8-7.2"
    if "moisture <10%".lower() in s: out["moisture"] = "<10%"
    if "non-hazardous" in s: out["hazard"] = "non-hazardous"
    if "flammable" in s: out["flammable"] = "yes"
    if "high density" in s: out["density"] = "high"
    if "fine particles" in s: out["particle_size"] = "<100"
    return out

def _receiver_required_props_from_checkboxes(opts: List[str]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}; s = set(x.strip().lower() for x in (opts or []))
    if "high density" in s: out["density"] = "high"
    if "low moisture" in s: out["moisture"] = "<10%"
    if "neutral pH".lower() in s: out["pH"] = "6.8-7.2"
    if "fine powder" in s: out["particle_size"] = "<100"
    if "non-toxic" in s: out["hazard"] = "non-hazardous"
    return out

def _map_temperature_req(s: Optional[str]) -> Optional[str]:
    if not s: return None
    s = s.strip().lower()
    if "ambient" in s: return "20-30"
    if "25–35" in s or "25-35" in s: return "25-35"
    if "cold" in s: return "0-10"
    if "hot" in s: return ">50"
    return None

def _parse_particle_or_viscosity(s: Optional[str]) -> Dict[str, str]:
    d: Dict[str, str] = {}
    if not s: return d
    m = re.search(r"(<|>|<=|>=)?\s*(\d+(\.\d+)?)\s*(micron|microns|µm)", s, flags=re.I)
    if m:
        op = m.group(1) or "<="; val = m.group(2)
        d["particle_size"] = f"{op}{val}"
    if "low viscosity" in s.lower(): d["viscosity"] = "low"
    if "high viscosity" in s.lower(): d["viscosity"] = "high"
    return d

def _odor_color_props(selection: Optional[str]) -> Dict[str, str]:
    if not selection: return {}
    sel = selection.strip().lower()
    if "no odor" in sel: return {"odor": "no odor"}
    if "slight" in sel: return {"odor": "slight"}
    return {}

def _form_requirement(s: Optional[str]) -> Optional[str]:
    return s.strip().lower() if s else None

def _cert_list(common_cert: Optional[str]) -> List[str]:
    if not common_cert: return []
    c = common_cert.strip().lower(); out = []
    if "bis" in c: out.append("BIS")
    if "iso 9001" in c: out.append("ISO9001")
    if "iso 14001" in c: out.append("ISO14001")
    if "pollution board" in c: out.append("PollutionBoard")
    return out

def _auto_factory_id(name: str, prefix: str) -> str:
    base = re.sub(r"[^A-Za-z0-9]+", "_", (name or "").strip())[:10].upper() or "FACT"
    return f"{prefix}_{base}"

def _canonical_from_generator(portal: Dict[str, Any], geocode_fn: GeocodeFn) -> Dict[str, Any]:
    common = portal.get("COMMON", {}); gen = portal.get("GENERATOR", {})
    material_type = gen.get("Waste Type Name") or gen.get("Waste Category") or "Unknown"
    composition = _parse_composition_text(gen.get("Waste Composition"))
    phys = _generator_properties_from_checkboxes(gen.get("Waste Properties") or [])
    if gen.get("Storage Condition"): phys["storage"] = str(gen["Storage Condition"]).strip().lower()
    if str(gen.get("Certification / Hazard Rating","")).lower().startswith("non-hazard"): phys["hazard"] = "non-hazardous"
    qty_week_tons, freq = _normalize_qty_freq(gen.get("Quantity Generated"), gen.get("Frequency of Generation"))
    loc = _resolve_location(common.get("Location"), geocode_fn) or {}
    return {
        "factory_id": portal.get("Factory ID") or _auto_factory_id(common.get("Factory Name","GEN"), "GEN"),
        "factory_name": common.get("Factory Name"),
        "industry": common.get("Industry Type"),
        "location": loc,
        "waste_output": {
            "material_type": str(material_type),
            "quantity_tons": qty_week_tons,
            "frequency": freq,
            "chemical_composition": composition,
            "physical_properties": phys,
            "current_disposal_landfill_km": float(0.0)
        },
        "certifications": _cert_list(common.get("Certification"))
    }

def _canonical_from_receiver(portal: Dict[str, Any], geocode_fn: GeocodeFn) -> Dict[str, Any]:
    common = portal.get("COMMON", {}); rec = portal.get("RECEIVER", {})
    material_type = rec.get("Raw Material Name") or "Unknown"
    req_comp = _parse_requirements_text(rec.get("Required Chemical Composition"))
    req_props = _receiver_required_props_from_checkboxes(rec.get("Required Physical Properties") or [])
    purity = rec.get("Minimum Purity Level")
    if isinstance(purity, str) and purity.endswith("%"): req_props["purity"] = f">{_strip_pct(purity)}%"
    contam = rec.get("Contaminant Tolerance")
    if isinstance(contam, str) and contam.startswith("<"): req_props["contaminants"] = contam
    if _form_requirement(rec.get("Form of Material Needed")): req_props["form"] = _form_requirement(rec.get("Form of Material Needed"))
    req_props.update(_parse_particle_or_viscosity(rec.get("Particle Size / Viscosity")))
    t = _map_temperature_req(rec.get("Temperature Requirement"));  req_props.update(_odor_color_props(rec.get("Odor or Color Tolerance")))
    if t: req_props["temperature"] = t
    qty_week_tons, freq = _normalize_qty_freq(rec.get("Quantity Required"), rec.get("Frequency of Requirement"))
    budget_per_ton = None
    if rec.get("Budget per Ton"):
        nums = re.findall(r"[\d\.]+", str(rec["Budget per Ton"])); budget_per_ton = float(nums[0]) if nums else None
    loc = _resolve_location(common.get("Location"), geocode_fn) or {}
    return {
        "factory_id": portal.get("Factory ID") or _auto_factory_id(common.get("Factory Name","REC"), "REC"),
        "factory_name": common.get("Factory Name"),
        "industry": common.get("Industry Type"),
        "location": loc,
        "material_requirement": {
            "material_type": str(material_type),
            "quantity_tons": qty_week_tons,
            "frequency": freq,
            "required_composition": req_comp,
            "required_properties": req_props,
            "processing_cost_per_ton": 0.0,
            "budget_per_ton": budget_per_ton
        },
        "logistics": {
            "max_distance_km": rec.get("Max Distance (km)") or 150
        },
        "certifications_required": _cert_list(rec.get("Certification Needed"))
    }

def process_portal_factories(portal_factories: List[Dict[str, Any]], geocode_fn: GeocodeFn = None) -> Dict[str, Any]:
    suppliers: List[Dict[str, Any]] = []; receivers: List[Dict[str, Any]] = []
    for rec in portal_factories:
        ftype = ((rec.get("COMMON") or {}).get("Factory Type") or "").strip().lower()
        if ftype in ("waste generator", "generator"): suppliers.append(_canonical_from_generator(rec, geocode_fn))
        elif ftype in ("receiver",): receivers.append(_canonical_from_receiver(rec, geocode_fn))
        else:
            # If using multi-role (both), Lovable may send two records already; no-op here.
            if rec.get("GENERATOR"): suppliers.append(_canonical_from_generator(rec, geocode_fn))
            if rec.get("RECEIVER"): receivers.append(_canonical_from_receiver(rec, geocode_fn))
    return process_requests(suppliers, receivers)

if __name__ == "__main__":
    # Minimal local smoke test
    suppliers = [{
        "factory_id": "THERM_A_451",
        "factory_name": "Alpha Thermal Power",
        "industry": "Power Generation",
        "location": {"lat": 13.0827, "lon": 80.2707},
        "waste_output": {
            "material_type": "Fly Ash",
            "quantity_tons": 150,
            "frequency": "weekly",
            "chemical_composition": {"SiO2": "55%", "Fe2O3": "5%"},
            "physical_properties": {"moisture": "2%", "pH": "7.5"},
            "current_disposal_landfill_km": 80
        },
        "certifications": ["ISO14001", "BIS"]
    }]
    receivers = [{
        "factory_id": "FACB_102",
        "factory_name": "Beta Cement Works",
        "industry": "Cement",
        "location": {"lat": 12.9850, "lon": 80.2310},
        "material_requirement": {
            "material_type": "Fly Ash",
            "quantity_tons": 125,
            "frequency": "weekly",
            "required_composition": {"SiO2": ">40%", "Fe2O3": "<10%"},
            "required_properties": {"moisture": "<10%", "pH": "6.5-8.0"},
            "processing_cost_per_ton": 200
        },
        "logistics": {"max_distance_km": 150},
        "certifications_required": ["BIS", "ISO14001"]
    }]
    import json
    print(json.dumps(process_requests(suppliers, receivers), indent=2))
