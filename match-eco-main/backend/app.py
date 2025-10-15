# backend/app.py
import os
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple, List, Dict, Any

from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from flask_jwt_extended import (
    JWTManager, create_access_token, jwt_required, get_jwt_identity
)

# ---- matcher (expects PortalRecord[] from UI) ----
# You already have this in engine.py
from engine import process_portal_factories


# =========================
# App / CORS / JWT config
# =========================
app = Flask(__name__)

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret")
app.config["JWT_SECRET_KEY"] = os.environ.get("JWT_SECRET_KEY", "change-this-jwt-secret")
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(days=7)

jwt = JWTManager(app)

FRONTEND_ORIGINS = os.environ.get(
    "FRONTEND_ORIGIN",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080"
).split(",")

CORS(
    app,
    resources={r"/*": {"origins": [o.strip() for o in FRONTEND_ORIGINS]}},
    supports_credentials=True,
    methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

DB_PATH = os.environ.get("FACTORY_DB", "app.db")


# =========================
# SQLite helpers / Schema
# =========================
def _connect():
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    con = _connect()
    cur = con.cursor()

    # users
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)

    # master factory row (common fields)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS factories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            factory_name TEXT NOT NULL,
            industry_type TEXT NOT NULL,
            email TEXT NOT NULL,
            location_text TEXT,
            location_lat REAL,
            location_lon REAL,
            production_capacity TEXT,
            certification TEXT,
            sustainability_goal TEXT,
            roles_csv TEXT,                -- "Waste Generator,Receiver"
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    # generator details (optional)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS factory_generator (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            factory_id INTEGER NOT NULL,
            waste_category TEXT,
            waste_type_name TEXT,
            waste_composition TEXT,
            waste_properties TEXT,         -- CSV list
            quantity_generated TEXT,
            frequency_generation TEXT,
            storage_condition TEXT,
            disposal_cost TEXT,
            hazard_rating TEXT,
            preferred_buyer TEXT,
            FOREIGN KEY (factory_id) REFERENCES factories(id)
        )
    """)

    # receiver details (optional)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS factory_receiver (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            factory_id INTEGER NOT NULL,
            raw_material_name TEXT,
            raw_material_category TEXT,
            required_composition TEXT,
            required_properties TEXT,      -- CSV list
            min_purity TEXT,
            contaminant_tolerance TEXT,
            form_needed TEXT,
            particle_size TEXT,
            temperature_req TEXT,
            odor_color TEXT,
            quantity_required TEXT,
            frequency_requirement TEXT,
            quality_tolerance TEXT,
            budget_per_ton TEXT,
            contract_type TEXT,
            certification_needed TEXT,
            max_distance_km REAL,
            FOREIGN KEY (factory_id) REFERENCES factories(id)
        )
    """)

    # optional JSON snapshots
    cur.execute("""
        CREATE TABLE IF NOT EXISTS factory_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    # --- Messaging tables ---
    cur.execute("""
        CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS conversation_participants (
            conversation_id INTEGER NOT NULL,
            factory_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            UNIQUE(conversation_id, factory_id),
            FOREIGN KEY (conversation_id) REFERENCES conversations(id),
            FOREIGN KEY (factory_id) REFERENCES factories(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            sender_user_id INTEGER NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id),
            FOREIGN KEY (sender_user_id) REFERENCES users(id)
        )
    """)

    con.commit()
    con.close()


init_db()

def _first_user_factory_id(user_id: int) -> Optional[int]:
    con = _connect()
    try:
        cur = con.cursor()
        cur.execute("SELECT id FROM factories WHERE user_id = ? ORDER BY datetime(created_at) ASC LIMIT 1", (user_id,))
        row = cur.fetchone()
        return int(row["id"]) if row else None
    finally:
        con.close()

def _get_or_create_conversation(a_factory_id: int, b_factory_id: int, user_a: int, user_b: int) -> int:
    # Try to find existing conversation with exactly these two factories
    con = _connect()
    try:
        cur = con.cursor()
        cur.execute("""
            SELECT cp1.conversation_id AS cid
            FROM conversation_participants cp1
            JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
            WHERE cp1.factory_id = ? AND cp2.factory_id = ?
            LIMIT 1
        """, (a_factory_id, b_factory_id))
        row = cur.fetchone()
        if row:
            return int(row["cid"])

        # Create new conversation
        cid = None
        cur.execute("INSERT INTO conversations (created_at) VALUES (datetime('now'))")
        cid = cur.lastrowid

        cur.execute("INSERT OR IGNORE INTO conversation_participants (conversation_id, factory_id, user_id) VALUES (?, ?, ?)",
                    (cid, a_factory_id, user_a))
        cur.execute("INSERT OR IGNORE INTO conversation_participants (conversation_id, factory_id, user_id) VALUES (?, ?, ?)",
                    (cid, b_factory_id, user_b))
        con.commit()
        return int(cid)
    finally:
        con.close()

@app.post("/api/messages/start")
@jwt_required()
def start_message():
    """
    Body: { "target_factory_id": number, "from_factory_id"?: number, "body": string }
    Picks the sender's first factory if from_factory_id not provided.
    Creates (or reuses) a conversation between the two factories and drops the first message.
    """
    user_id = int(get_jwt_identity())
    data = request.get_json(silent=True) or {}
    target_factory_id = data.get("target_factory_id")
    from_factory_id = data.get("from_factory_id")
    body = (data.get("body") or "").strip()

    if not target_factory_id or not isinstance(target_factory_id, int):
        return jsonify({"error": "target_factory_id required"}), 400
    if not body:
        return jsonify({"error": "Message body required"}), 400

    # Resolve sender factory (first owned if not supplied)
    if not from_factory_id:
        from_factory_id = _first_user_factory_id(user_id)
        if not from_factory_id:
            return jsonify({"error": "You don't have any factories to send from. Create one first."}), 400

    # Figure out owner (user_id) of target factory
    con = _connect()
    try:
        cur = con.cursor()
        cur.execute("SELECT user_id FROM factories WHERE id = ?", (target_factory_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({"error": "Target factory not found"}), 404
        target_user_id = int(row["user_id"])
    finally:
        con.close()

    # Make / reuse conversation
    cid = _get_or_create_conversation(from_factory_id, target_factory_id, user_id, target_user_id)

    # Insert the message
    con = _connect()
    try:
        cur = con.cursor()
        cur.execute("INSERT INTO messages (conversation_id, sender_user_id, body, created_at) VALUES (?, ?, ?, datetime('now'))",
                    (cid, user_id, body))
        con.commit()
    finally:
        con.close()

    return jsonify({"conversation_id": cid, "ok": True}), 201


# --- UPDATE: List threads with participant emails ---
@app.get("/api/messages/threads")
@jwt_required()
def list_threads():
    """
    Returns conversations the current user participates in + last message + participants (with email).
    """
    user_id = int(get_jwt_identity())
    con = _connect()
    try:
        cur = con.cursor()
        cur.execute("""
            SELECT DISTINCT c.id AS conversation_id, c.created_at
            FROM conversations c
            JOIN conversation_participants cp ON c.id = cp.conversation_id
            WHERE cp.user_id = ?
            ORDER BY datetime(c.created_at) DESC
        """, (user_id,))
        convs = [dict(row) for row in cur.fetchall()]

        out = []
        for cv in convs:
            cid = cv["conversation_id"]
            # participants (add email)
            cur.execute("""
                SELECT
                    cp.factory_id,
                    cp.user_id,
                    f.factory_name,
                    f.industry_type,
                    f.email
                FROM conversation_participants cp
                JOIN factories f ON f.id = cp.factory_id
                WHERE cp.conversation_id = ?
            """, (cid,))
            parts = [dict(row) for row in cur.fetchall()]

            # last message (for preview)
            cur.execute("""
                SELECT body, sender_user_id, created_at
                FROM messages
                WHERE conversation_id = ?
                ORDER BY datetime(created_at) DESC LIMIT 1
            """, (cid,))
            last = cur.fetchone()

            out.append({
                "conversation_id": cid,
                "created_at": cv["created_at"],
                "participants": parts,      # includes email
                "last_message": dict(last) if last else None
            })
        return jsonify(out), 200
    finally:
        con.close()


# --- UPDATE: Full conversation with participant emails ---
@app.get("/api/messages/<int:conversation_id>")
@jwt_required()
def get_conversation(conversation_id: int):
    """
    Full message history + participants (includes email).
    """
    user_id = int(get_jwt_identity())
    con = _connect()
    try:
        cur = con.cursor()
        # ensure membership
        cur.execute("""
            SELECT 1 FROM conversation_participants
            WHERE conversation_id = ? AND user_id = ?
        """, (conversation_id, user_id))
        if not cur.fetchone():
            return jsonify({"error": "Not a participant"}), 403

        # participants (with email)
        cur.execute("""
            SELECT
                cp.factory_id,
                cp.user_id,
                f.factory_name,
                f.industry_type,
                f.email
            FROM conversation_participants cp
            JOIN factories f ON f.id = cp.factory_id
            WHERE cp.conversation_id = ?
        """, (conversation_id,))
        parts = [dict(row) for row in cur.fetchall()]

        # messages
        cur.execute("""
            SELECT id, sender_user_id, body, created_at
            FROM messages
            WHERE conversation_id = ?
            ORDER BY datetime(created_at) ASC
        """, (conversation_id,))
        msgs = [dict(row) for row in cur.fetchall()]

        return jsonify({
            "conversation_id": conversation_id,
            "participants": parts,      # includes email
            "messages": msgs
        }), 200
    finally:
        con.close()


@app.post("/api/messages/<int:conversation_id>")
@jwt_required()
def send_in_conversation(conversation_id: int):
    """
    Body: { body: string }
    """
    user_id = int(get_jwt_identity())
    data = request.get_json(silent=True) or {}
    body = (data.get("body") or "").strip()
    if not body:
        return jsonify({"error": "Message body required"}), 400

    con = _connect()
    try:
        cur = con.cursor()
        # ensure membership
        cur.execute("SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?",
                    (conversation_id, user_id))
        if not cur.fetchone():
            return jsonify({"error": "Not a participant"}), 403

        cur.execute("INSERT INTO messages (conversation_id, sender_user_id, body, created_at) VALUES (?, ?, ?, datetime('now'))",
                    (conversation_id, user_id, body))
        con.commit()
        return jsonify({"ok": True}), 201
    finally:
        con.close()

# =========================
# Small utilities
# =========================
def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _csv_list(s: Optional[str]) -> List[str]:
    if not s:
        return []
    return [x.strip() for x in str(s).split(",") if x.strip()]


# --- tiny offline geocoder ---
_CITY_LATLON = {
    "chennai": (13.0827, 80.2707), "bengaluru": (12.9716, 77.5946),
    "bangalore": (12.9716, 77.5946), "hyderabad": (17.3850, 78.4867),
    "mumbai": (19.0760, 72.8777), "pune": (18.5204, 73.8567),
    "ahmedabad": (23.0225, 72.5714), "delhi": (28.6139, 77.2090),
    "new delhi": (28.6139, 77.2090), "kolkata": (22.5726, 88.3639),
    "coimbatore": (11.0168, 76.9558), "madurai": (9.9252, 78.1198),
    "visakhapatnam": (17.6868, 83.2185), "surat": (21.1702, 72.8311),
    "jaipur": (26.9124, 75.7873), "lucknow": (26.8467, 80.9462),
}
def geocode_city(address: str) -> Optional[Tuple[float, float]]:
    if not address:
        return None
    s = address.strip().lower()
    for key, ll in _CITY_LATLON.items():
        if key in s:
            return ll
    return None


# =========================
# Request logger
# =========================
@app.before_request
def _dbg_log():
    print(f">>> {request.method} {request.path}")


# =========================
# Basic routes
# =========================
@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/")
def home():
    return "Hello, welcome to base route", 200


# =========================
# Auth
# =========================
@app.post("/api/auth/register")
def register():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters."}), 400

    con = _connect()
    cur = con.cursor()
    try:
        cur.execute("SELECT id FROM users WHERE email = ?", (email,))
        if cur.fetchone():
            return jsonify({"error": "Email already registered."}), 409

        now = utcnow_iso()
        pw_hash = generate_password_hash(password)
        cur.execute(
            "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)",
            (email, pw_hash, now),
        )
        con.commit()
        user_id = cur.lastrowid

        token = create_access_token(identity=str(user_id))
        return jsonify({"token": token, "user": {"id": user_id, "email": email}}), 201
    except Exception as e:
        con.rollback()
        return jsonify({"error": "Registration failed.", "details": str(e)}), 500
    finally:
        con.close()


@app.post("/api/auth/login")
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400

    con = _connect()
    cur = con.cursor()
    try:
        cur.execute("SELECT id, password_hash FROM users WHERE email = ?", (email,))
        row = cur.fetchone()
        if not row or not check_password_hash(row["password_hash"], password):
            return jsonify({"error": "Invalid credentials."}), 401

        token = create_access_token(identity=str(row["id"]))
        return jsonify({"token": token, "user": {"id": row["id"], "email": email}}), 200
    except Exception as e:
        return jsonify({"error": "Login failed.", "details": str(e)}), 500
    finally:
        con.close()


@app.get("/api/auth/me")
@jwt_required()
def me():
    user_id = get_jwt_identity()
    con = _connect()
    cur = con.cursor()
    try:
        cur.execute("SELECT id, email, created_at FROM users WHERE id = ?", (user_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({"error": "User not found"}), 404
        return jsonify({
            "id": row["id"],
            "email": row["email"],
            "created_at": row["created_at"],
        }), 200
    finally:
        con.close()


# =========================
# Save snapshots & full rows
# =========================
@app.post("/api/factories")
@jwt_required()
def save_factories():
    data = request.get_json(silent=True) or {}
    records = data.get("records")
    if not isinstance(records, list) or not records:
        return jsonify({"error": "records (array) is required"}), 400

    user_id = int(get_jwt_identity())
    con = _connect()
    cur = con.cursor()
    try:
        now = utcnow_iso()
        payload = json.dumps(records, ensure_ascii=False)
        cur.execute(
            "INSERT INTO factory_records (user_id, payload, created_at) VALUES (?, ?, ?)",
            (user_id, payload, now),
        )
        con.commit()
        rec_id = cur.lastrowid
        return jsonify({"id": rec_id, "created_at": now}), 201
    except Exception as e:
        con.rollback()
        return jsonify({"error": "Save failed", "details": str(e)}), 500
    finally:
        con.close()


def _extract_loc(ll_or_text):
    """Accepts string or {lat, lon} from UI; returns (text, lat, lon) tuple."""
    if isinstance(ll_or_text, dict):
        lat = ll_or_text.get("lat")
        lon = ll_or_text.get("lon")
        if lat is not None and lon is not None:
            return (None, float(lat), float(lon))
    return (str(ll_or_text) if ll_or_text is not None else None, None, None)


@app.post("/api/factories/full")
@jwt_required()
def save_factories_full():
    """
    Body:
    {
      "common": {...},
      "generator": {...} | null,
      "receiver": {...} | null,
      "roles": ["Waste Generator","Receiver"]
    }
    """
    data = request.get_json(silent=True) or {}
    common = data.get("common") or {}
    generator = data.get("generator")
    receiver = data.get("receiver")
    roles = data.get("roles") or []

    required = ["Factory Name", "Industry Type", "Email", "Location"]
    for r in required:
        if not common.get(r):
            return jsonify({"error": f"Missing field: {r}"}), 400

    # unpack common
    factory_name = common["Factory Name"]
    industry_type = common["Industry Type"]
    email = common["Email"]
    location = common["Location"]
    production_capacity = common.get("Production Capacity")
    certification = common.get("Certification") or ""
    sustainability_goal = common.get("Sustainability Goal")

    loc_text, loc_lat, loc_lon = _extract_loc(location)
    roles_csv = ",".join(roles)

    user_id = int(get_jwt_identity())
    now = utcnow_iso()

    con = _connect()
    cur = con.cursor()
    try:
        # insert master row
        cur.execute("""
            INSERT INTO factories (
                user_id, factory_name, industry_type, email,
                location_text, location_lat, location_lon,
                production_capacity, certification, sustainability_goal,
                roles_csv, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            user_id, factory_name, industry_type, email,
            loc_text, loc_lat, loc_lon,
            production_capacity, certification, sustainability_goal,
            roles_csv, now
        ))
        factory_id = cur.lastrowid

        # generator details
        if generator:
            cur.execute("""
                INSERT INTO factory_generator (
                    factory_id, waste_category, waste_type_name, waste_composition,
                    waste_properties, quantity_generated, frequency_generation,
                    storage_condition, disposal_cost, hazard_rating, preferred_buyer
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                factory_id,
                generator.get("Waste Category"),
                generator.get("Waste Type Name"),
                generator.get("Waste Composition"),
                ",".join(generator.get("Waste Properties") or []),
                generator.get("Quantity Generated"),
                generator.get("Frequency of Generation"),
                generator.get("Storage Condition"),
                generator.get("Disposal Cost"),
                generator.get("Certification / Hazard Rating"),
                generator.get("Preferred Buyer Type"),
            ))

        # receiver details
        if receiver:
            cur.execute("""
                INSERT INTO factory_receiver (
                    factory_id, raw_material_name, raw_material_category,
                    required_composition, required_properties, min_purity,
                    contaminant_tolerance, form_needed, particle_size,
                    temperature_req, odor_color, quantity_required,
                    frequency_requirement, quality_tolerance, budget_per_ton,
                    contract_type, certification_needed, max_distance_km
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                factory_id,
                receiver.get("Raw Material Name"),
                receiver.get("Raw Material Category"),
                receiver.get("Required Chemical Composition"),
                ",".join(receiver.get("Required Physical Properties") or []),
                receiver.get("Minimum Purity Level"),
                receiver.get("Contaminant Tolerance"),
                receiver.get("Form of Material Needed"),
                receiver.get("Particle Size / Viscosity"),
                receiver.get("Temperature Requirement"),
                receiver.get("Odor or Color Tolerance"),
                receiver.get("Quantity Required"),
                receiver.get("Frequency of Requirement"),
                receiver.get("Quality Tolerance Range"),
                receiver.get("Budget per Ton"),
                receiver.get("Contract Type"),
                receiver.get("Certification Needed"),
                float(receiver.get("Max Distance (km)") or 0),
            ))

        con.commit()
        return jsonify({"factory_id": factory_id, "created_at": now}), 201
    except Exception as e:
        con.rollback()
        return jsonify({"error": "Save failed", "details": str(e)}), 500
    finally:
        con.close()


@app.delete("/api/factories/<int:factory_id>")
@jwt_required()
def delete_factory(factory_id: int):
    user_id = get_jwt_identity()
    con = _connect()
    cur = con.cursor()
    # Only allow deleting user's own factories
    cur.execute("SELECT id FROM factories WHERE id = ? AND user_id = ?", (factory_id, user_id))
    row = cur.fetchone()
    if not row:
        con.close()
        return jsonify({"success": False, "error": "Factory not found or not owned by user."}), 404
    # Delete related rows first
    cur.execute("DELETE FROM factory_generator WHERE factory_id = ?", (factory_id,))
    cur.execute("DELETE FROM factory_receiver WHERE factory_id = ?", (factory_id,))
    cur.execute("DELETE FROM factories WHERE id = ?", (factory_id,))
    con.commit()
    con.close()
    return jsonify({"success": True, "deleted": factory_id}), 200


# =========================
# Listing (mixed legacy + normalized)
# =========================
@app.get("/api/waste-materials")
@jwt_required()
def list_waste_materials():
    """
    Returns a mixed list:
    1) Legacy snapshot rows from factory_records: { id, created_at, records: [...] }
    2) Normalized rows from factories/* tables:
       {
         id, created_at,
         common: {...}, generator: {...}|null, receiver: {...}|null,
         roles: [...]
       }
    """
    user_id = int(get_jwt_identity())
    con = _connect()
    cur = con.cursor()
    out: List[Dict[str, Any]] = []
    try:
        # 1) legacy/snapshot rows
        cur.execute(
            "SELECT id, payload, created_at FROM factory_records WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        )
        for r in cur.fetchall():
            try:
                payload = json.loads(r["payload"])
            except Exception:
                payload = r["payload"]
            out.append({
                "id": r["id"],
                "created_at": r["created_at"],
                "records": payload,
            })

        # 2) normalized rows
        cur.execute(
            "SELECT * FROM factories WHERE user_id = ? ORDER BY datetime(created_at) DESC",
            (user_id,),
        )
        factories_rows = cur.fetchall()

        for f in factories_rows:
            # location: prefer lat/lon if present, else text
            if f["location_lat"] is not None and f["location_lon"] is not None:
                location = {"lat": float(f["location_lat"]), "lon": float(f["location_lon"])}
            else:
                location = f["location_text"] or ""

            common = {
                "WasteMaterial Name": f["factory_name"],
                "Industry Type": f["industry_type"],
                "Email": f["email"],
                "Location": location,
                "Production Capacity": f["production_capacity"],
                "Certification": f["certification"],
                "Sustainability Goal": f["sustainability_goal"],
            }

            # generator (optional)
            cur.execute("SELECT * FROM factory_generator WHERE factory_id = ? LIMIT 1", (f["id"],))
            g = cur.fetchone()
            generator = None
            if g:
                generator = {
                    "Waste Category": g["waste_category"],
                    "Waste Type Name": g["waste_type_name"],
                    "Waste Composition": g["waste_composition"],
                    "Waste Properties": _csv_list(g["waste_properties"]),
                    "Quantity Generated": g["quantity_generated"],
                    "Frequency of Generation": g["frequency_generation"],
                    "Storage Condition": g["storage_condition"],
                    "Disposal Cost": g["disposal_cost"],
                    "Certification / Hazard Rating": g["hazard_rating"],
                    "Preferred Buyer Type": g["preferred_buyer"],
                }

            # receiver (optional)
            cur.execute("SELECT * FROM factory_receiver WHERE factory_id = ? LIMIT 1", (f["id"],))
            rcv = cur.fetchone()
            receiver = None
            if rcv:
                receiver = {
                    "Raw Material Name": rcv["raw_material_name"],
                    "Raw Material Category": rcv["raw_material_category"],
                    "Required Chemical Composition": rcv["required_composition"],
                    "Required Physical Properties": _csv_list(rcv["required_properties"]),
                    "Minimum Purity Level": rcv["min_purity"],
                    "Contaminant Tolerance": rcv["contaminant_tolerance"],
                    "Form of Material Needed": rcv["form_needed"],
                    "Particle Size / Viscosity": rcv["particle_size"],
                    "Temperature Requirement": rcv["temperature_req"],
                    "Odor or Color Tolerance": rcv["odor_color"],
                    "Quantity Required": rcv["quantity_required"],
                    "Frequency of Requirement": rcv["frequency_requirement"],
                    "Quality Tolerance Range": rcv["quality_tolerance"],
                    "Budget per Ton": rcv["budget_per_ton"],
                    "Contract Type": rcv["contract_type"],
                    "Certification Needed": rcv["certification_needed"],
                    "Max Distance (km)": float(rcv["max_distance_km"] or 0),
                }

            roles = _csv_list(f["roles_csv"])

            out.append({
                "id": f["id"],
                "created_at": f["created_at"],
                "common": common,
                "generator": generator,
                "receiver": receiver,
                "roles": roles,
            })

        return jsonify(out), 200
    finally:
        con.close()


# =========================
# Demo data: simple cycle
# =========================
# --- Add at top if not present ---
from typing import Dict, Any, DefaultDict
from collections import defaultdict

# ---------------- Demo: seed cyclic data ----------------
@app.post("/api/demo/cyclic-data")
@jwt_required()
def demo_cyclic_data():
    """
    Seeds three factories (DEMO-A, DEMO-B, DEMO-C) and
    links them so that A supplies B, B supplies C, C supplies A.
    Body (optional): { "reset": true } to clear previous DEMO-* rows first.
    """
    user_id = int(get_jwt_identity())
    body = request.get_json(silent=True) or {}
    reset = bool(body.get("reset"))

    con = _connect()
    cur = con.cursor()
    try:
        if reset:
            # remove previous DEMO data (order: children -> parent)
            cur.execute("""
                DELETE FROM factory_generator
                WHERE factory_id IN (SELECT id FROM factories WHERE factory_name LIKE 'DEMO-%')
            """)
            cur.execute("""
                DELETE FROM factory_receiver
                WHERE factory_id IN (SELECT id FROM factories WHERE factory_name LIKE 'DEMO-%')
            """)
            cur.execute("DELETE FROM factories WHERE factory_name LIKE 'DEMO-%'")

        # create factories
        now = datetime.utcnow().isoformat()
        demo_factories = [
            ("DEMO-A", "Metal",   "demo-a@example.com"),
            ("DEMO-B", "Plastic", "demo-b@example.com"),
            ("DEMO-C", "Paper",   "demo-c@example.com"),
        ]
        ids = {}
        for name, industry, email in demo_factories:
            cur.execute("""
                INSERT INTO factories (
                    user_id, factory_name, industry_type, email,
                    location_text, location_lat, location_lon,
                    production_capacity, certification, sustainability_goal,
                    roles_csv, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                user_id, name, industry, email,
                name + " City", None, None,
                "Medium", "", "",
                "Waste Generator,Receiver", now
            ))
            ids[name] = cur.lastrowid

        # A generates Metal Scrap -> B needs Metal Scrap
        cur.execute("""
            INSERT INTO factory_generator (
                factory_id, waste_category, waste_type_name, waste_composition,
                waste_properties, quantity_generated, frequency_generation,
                storage_condition, disposal_cost, hazard_rating, preferred_buyer
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (ids["DEMO-A"], "Metal", "Metal Scrap", "Fe", "High Density", "100 t/wk", "Weekly",
              "", "", "Low", "Foundries"))
        cur.execute("""
            INSERT INTO factory_receiver (
                factory_id, raw_material_name, raw_material_category,
                required_composition, required_properties, min_purity,
                contaminant_tolerance, form_needed, particle_size,
                temperature_req, odor_color, quantity_required,
                frequency_requirement, quality_tolerance, budget_per_ton,
                contract_type, certification_needed, max_distance_km
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (ids["DEMO-B"], "Metal Scrap", "Metal",
              "Fe>=80%", "High Density", "80%", "<10%", "Solid", "10mm",
              "", "", "100 t/wk", "Weekly", "±5%", "₹1500", "Recurring", "BIS", 200))

        # B generates Plastic Flakes -> C needs Plastic Flakes
        cur.execute("""
            INSERT INTO factory_generator (
                factory_id, waste_category, waste_type_name, waste_composition,
                waste_properties, quantity_generated, frequency_generation,
                storage_condition, disposal_cost, hazard_rating, preferred_buyer
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (ids["DEMO-B"], "Plastic", "Plastic Flakes", "HDPE", "Low Moisture", "80 t/wk", "Weekly",
              "", "", "Non-hazardous", "Recyclers"))
        cur.execute("""
            INSERT INTO factory_receiver (
                factory_id, raw_material_name, raw_material_category,
                required_composition, required_properties, min_purity,
                contaminant_tolerance, form_needed, particle_size,
                temperature_req, odor_color, quantity_required,
                frequency_requirement, quality_tolerance, budget_per_ton,
                contract_type, certification_needed, max_distance_km
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (ids["DEMO-C"], "Plastic Flakes", "Plastic",
              "HDPE", "Low Moisture", "90%", "<5%", "Flakes", "",
              "", "", "70 t/wk", "Weekly", "±2%", "₹2200", "Recurring", "", 250))

        # C generates Paper Waste -> A needs Paper Waste
        cur.execute("""
            INSERT INTO factory_generator (
                factory_id, waste_category, waste_type_name, waste_composition,
                waste_properties, quantity_generated, frequency_generation,
                storage_condition, disposal_cost, hazard_rating, preferred_buyer
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (ids["DEMO-C"], "Paper", "Paper Waste", "Cellulose", "Dry", "120 t/wk", "Weekly",
              "", "", "Non-hazardous", "Paper Mills"))
        cur.execute("""
            INSERT INTO factory_receiver (
                factory_id, raw_material_name, raw_material_category,
                required_composition, required_properties, min_purity,
                contaminant_tolerance, form_needed, particle_size,
                temperature_req, odor_color, quantity_required,
                frequency_requirement, quality_tolerance, budget_per_ton,
                contract_type, certification_needed, max_distance_km
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (ids["DEMO-A"], "Paper Waste", "Paper",
              "Cellulose", "Dry", "70%", "<10%", "Bales", "",
              "", "", "100 t/wk", "Weekly", "±10%", "₹800", "Recurring", "", 150))

        con.commit()
        return jsonify({
            "message": "Seeded demo cyclic data",
            "factory_ids": ids
        }), 201
    except Exception as e:
        con.rollback()
        return jsonify({"error": "seed failed", "details": str(e)}), 500
    finally:
        con.close()


# --------------- Build graph from DB and detect cycles ---------------
@app.post("/api/demo/cycles/db")
@jwt_required()
def demo_cycles_from_db():
    """
    Builds a directed graph where an edge exists if a generator's waste_type_name
    matches a receiver's raw_material_name (case-insensitive), then runs detect_cycles().
    Returns both the edges and the detected cycles.
    Optional body: { "only_demo": true } to restrict to factories named 'DEMO-%'.
    """
    body = request.get_json(silent=True) or {}
    only_demo = bool(body.get("only_demo"))

    con = _connect()
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    try:
        where_demo_from = "AND f_from.factory_name LIKE 'DEMO-%'" if only_demo else ""
        where_demo_to   = "AND f_to.factory_name LIKE 'DEMO-%'" if only_demo else ""

        cur.execute(f"""
            SELECT
                fg.factory_id        AS from_id,
                f_from.factory_name  AS from_name,
                fr.factory_id        AS to_id,
                f_to.factory_name    AS to_name,
                LOWER(TRIM(fg.waste_type_name)) AS mname
            FROM factory_generator fg
            JOIN factories f_from ON f_from.id = fg.factory_id
            JOIN factory_receiver fr
              ON LOWER(TRIM(fr.raw_material_name)) = LOWER(TRIM(fg.waste_type_name))
            JOIN factories f_to   ON f_to.id = fr.factory_id
            WHERE 1=1 {where_demo_from} {where_demo_to}
        """)
        rows = cur.fetchall()

        # Build adjacency list by factory name
        graph: Dict[str, list] = defaultdict(list)
        edges = []
        for r in rows:
            u = r["from_name"]
            v = r["to_name"]
            if u and v and u != v:
                graph[u].append(v)
                edges.append({"from": u, "to": v, "material": r["mname"]})

        # Ensure nodes with no outgoing edges are present
        for r in rows:
            graph.setdefault(r["to_name"], graph.get(r["to_name"], []))

        cycles = detect_cycles(dict(graph))
        return jsonify({
            "edges": edges,
            "graph": dict(graph),
            "cycles": cycles
        }), 200
    except Exception as e:
        return jsonify({"error": "cycle detection failed", "details": str(e)}), 500
    finally:
        con.close()


# --------------- Manual: run detect_cycles on a supplied graph ---------------
@app.post("/api/demo/cycles/graph")
@jwt_required()
def demo_cycles_on_graph():
    """
    Body:
      {
        "graph": { "A": ["B"], "B": ["C"], "C": ["A"] }
      }
    Returns: { "cycles": [...] }
    """
    data = request.get_json(silent=True) or {}
    graph = data.get("graph")
    if not isinstance(graph, dict):
        # default triangle if none given
        graph = {"A": ["B"], "B": ["C"], "C": ["A"]}
    try:
        return jsonify({"graph": graph, "cycles": detect_cycles(graph)}), 200
    except Exception as e:
        return jsonify({"error": "invalid graph", "details": str(e)}), 400


# =========================
# Matcher endpoints
# =========================
def _do_match(payload):
    records = payload if isinstance(payload, list) else [payload]
    return process_portal_factories(records, geocode_fn=geocode_city)

@app.post("/match")
def match():
    payload = request.get_json(force=True)
    if payload is None:
        return jsonify({"error": "Missing JSON body"}), 400
    try:
        return jsonify(_do_match(payload)), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.post("/api/match")
def api_match():
    return match()


# ---------- collectors for /api/match/all ----------
def _collect_portal_records(include_all_users: bool, user_id: int) -> List[Dict[str, Any]]:
    """
    Build PortalRecord[] for the matcher from normalized tables.
    One record per generator row and one per receiver row.
    """
    con = _connect()
    cur = con.cursor()
    try:
        where = "" if include_all_users else "WHERE f.user_id = ?"
        args = () if include_all_users else (user_id,)

        cur.execute(f"""
            SELECT
                f.id, f.user_id, f.factory_name, f.industry_type, f.email,
                f.location_text, f.location_lat, f.location_lon,
                f.production_capacity, f.certification, f.sustainability_goal,
                f.roles_csv, f.created_at
            FROM factories f
            {where}
        """, args)
        factories = [dict(r) for r in cur.fetchall()]

        cur.execute("SELECT * FROM factory_generator")
        gens_by_factory: Dict[int, List[Dict[str, Any]]] = {}
        for r in cur.fetchall():
            d = dict(r)
            gens_by_factory.setdefault(d["factory_id"], []).append(d)

        cur.execute("SELECT * FROM factory_receiver")
        recvs_by_factory: Dict[int, List[Dict[str, Any]]] = {}
        for r in cur.fetchall():
            d = dict(r)
            recvs_by_factory.setdefault(d["factory_id"], []).append(d)

        def common_from_factory(frow):
            if frow["location_lat"] is not None and frow["location_lon"] is not None:
                loc = {"lat": float(frow["location_lat"]), "lon": float(frow["location_lon"])}
            else:
                loc = frow["location_text"] or ""
            return {
                "Factory Name": frow["factory_name"],
                "Industry Type": frow["industry_type"],
                "Location": loc,
                "Certification": (frow["certification"] or ""),
                "Email": frow["email"],
                "Production Capacity": frow["production_capacity"] or "",
                "Sustainability Goal": frow["sustainability_goal"] or "",
            }

        records: List[Dict[str, Any]] = []

        for f in factories:
            common = common_from_factory(f)

            for g in gens_by_factory.get(f["id"], []):
                records.append({
                    "COMMON": common,
                    "GENERATOR": {
                        "Waste Category": g.get("waste_category") or "",
                        "Waste Type Name": g.get("waste_type_name") or "",
                        "Waste Composition": g.get("waste_composition") or "",
                        "Waste Properties": (g.get("waste_properties") or "").split(",") if g.get("waste_properties") else [],
                        "Quantity Generated": g.get("quantity_generated") or "",
                        "Frequency of Generation": g.get("frequency_generation") or "",
                        "Storage Condition": g.get("storage_condition") or "",
                        "Disposal Cost": g.get("disposal_cost") or "",
                        "Certification / Hazard Rating": g.get("hazard_rating") or "",
                        "Preferred Buyer Type": g.get("preferred_buyer") or "",
                    },
                    "RECEIVER": None,
                })

            for r in recvs_by_factory.get(f["id"], []):
                records.append({
                    "COMMON": common,
                    "GENERATOR": None,
                    "RECEIVER": {
                        "Raw Material Name": r.get("raw_material_name") or "",
                        "Raw Material Category": r.get("raw_material_category") or "",
                        "Required Chemical Composition": r.get("required_composition") or "",
                        "Required Physical Properties": (r.get("required_properties") or "").split(",") if r.get("required_properties") else [],
                        "Minimum Purity Level": r.get("min_purity") or "",
                        "Contaminant Tolerance": r.get("contaminant_tolerance") or "",
                        "Form of Material Needed": r.get("form_needed") or "",
                        "Particle Size / Viscosity": r.get("particle_size") or "",
                        "Temperature Requirement": r.get("temperature_req") or "",
                        "Odor or Color Tolerance": r.get("odor_color") or "",
                        "Quantity Required": r.get("quantity_required") or "",
                        "Frequency of Requirement": r.get("frequency_requirement") or "",
                        "Quality Tolerance Range": r.get("quality_tolerance") or "",
                        "Budget per Ton": r.get("budget_per_ton") or "",
                        "Contract Type": r.get("contract_type") or "",
                        "Certification Needed": r.get("certification_needed") or "",
                        "Max Distance (km)": r.get("max_distance_km") or 0,
                    },
                })

        return records
    finally:
        con.close()


def _collect_materials_full(include_all_users: bool, user_id: int) -> List[Dict[str, Any]]:
    """Return one row per material with ALL details (receiver + generator)."""
    con = _connect()
    cur = con.cursor()
    try:
        where = "" if include_all_users else "WHERE f.user_id = ?"
        args = () if include_all_users else (user_id,)

        common_cols = """
            f.id AS factory_id,
            f.user_id,
            f.factory_name,
            f.industry_type,
            f.email,
            f.location_text,
            f.location_lat,
            f.location_lon,
            f.production_capacity,
            f.certification,
            f.sustainability_goal,
            f.roles_csv,
            f.created_at
        """

        # RECEIVER rows (full)
        cur.execute(f"""
            SELECT
                {common_cols},
                'RECEIVER' AS role,
                r.id AS receiver_id,
                r.raw_material_name,
                r.raw_material_category,
                r.required_composition,
                r.required_properties,
                r.min_purity,
                r.contaminant_tolerance,
                r.form_needed,
                r.particle_size,
                r.temperature_req,
                r.odor_color,
                r.quantity_required,
                r.frequency_requirement,
                r.quality_tolerance,
                r.budget_per_ton,
                r.contract_type,
                r.certification_needed,
                r.max_distance_km,
                NULL AS generator_id,
                NULL AS waste_category,
                NULL AS waste_type_name,
                NULL AS waste_composition,
                NULL AS waste_properties,
                NULL AS quantity_generated,
                NULL AS frequency_generation,
                NULL AS storage_condition,
                NULL AS disposal_cost,
                NULL AS hazard_rating,
                NULL AS preferred_buyer
            FROM factories f
            JOIN factory_receiver r ON r.factory_id = f.id
            {where}
        """, args)
        recv_rows = [dict(row) for row in cur.fetchall()]

        # GENERATOR rows (full)
        cur.execute(f"""
            SELECT
                {common_cols},
                'GENERATOR' AS role,
                NULL AS receiver_id,
                NULL AS raw_material_name,
                NULL AS raw_material_category,
                NULL AS required_composition,
                NULL AS required_properties,
                NULL AS min_purity,
                NULL AS contaminant_tolerance,
                NULL AS form_needed,
                NULL AS particle_size,
                NULL AS temperature_req,
                NULL AS odor_color,
                NULL AS quantity_required,
                NULL AS frequency_requirement,
                NULL AS quality_tolerance,
                NULL AS budget_per_ton,
                NULL AS contract_type,
                NULL AS certification_needed,
                NULL AS max_distance_km,
                g.id AS generator_id,
                g.waste_category,
                g.waste_type_name,
                g.waste_composition,
                g.waste_properties,
                g.quantity_generated,
                g.frequency_generation,
                g.storage_condition,
                g.disposal_cost,
                g.hazard_rating,
                g.preferred_buyer
            FROM factories f
            JOIN factory_generator g ON g.factory_id = f.id
            {where}
        """, args)
        gen_rows = [dict(row) for row in cur.fetchall()]

        # Normalize CSV list fields
        for r in recv_rows:
            r["required_properties"] = _csv_list(r.get("required_properties"))
        for g in gen_rows:
            g["waste_properties"] = _csv_list(g.get("waste_properties"))

        return recv_rows + gen_rows
    finally:
        con.close()
#cycle detection
# helpers_cycles.py (or inline in app.py if you prefer)
from typing import Dict, List, Set, Tuple

def _canonical_cycle(nodes: List[str]) -> Tuple[str, ...]:
    """
    Canonicalize a cycle to avoid duplicates (rotation-insensitive and direction-insensitive).
    Input is a simple cycle like ['A','B','C'] (no repeated start at end).
    """
    if not nodes:
        return tuple()

    # rotation-invariant forward
    mins = None
    for i in range(len(nodes)):
        rot = nodes[i:] + nodes[:i]
        t = tuple(rot)
        if mins is None or t < mins:
            mins = t

    # rotation-invariant reverse
    rev = list(reversed(nodes))
    mins_rev = None
    for i in range(len(rev)):
        rot = rev[i:] + rev[:i]
        t = tuple(rot)
        if mins_rev is None or t < mins_rev:
            mins_rev = t

    return mins if mins <= mins_rev else mins_rev

def find_cycles(graph: Dict[str, List[str]], max_len: int = 10) -> List[List[str]]:
    """
    Find simple directed cycles in `graph` using bounded DFS.
    Returns each cycle once, as a list of node names (no repeated start/end).
    """
    cycles_set: Set[Tuple[str, ...]] = set()
    nodes = list(graph.keys())

    def dfs(start: str, current: str, visited: List[str], seen: Set[str]):
        if len(visited) > max_len:
            return
        for nxt in graph.get(current, []):
            if nxt == start and len(visited) >= 2:
                cyc = _canonical_cycle(visited[:])
                cycles_set.add(cyc)
            elif nxt not in seen:
                visited.append(nxt)
                seen.add(nxt)
                dfs(start, nxt, visited, seen)
                seen.remove(nxt)
                visited.pop()

    for s in nodes:
        dfs(s, s, [s], {s})

    return [list(c) for c in sorted(cycles_set)]
# app.py (or your routes module)
from flask import request, jsonify
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request
from typing import Dict, Any, List


# If you already have these, reuse:
# - _collect_materials_full(include_all_users: bool, user_id: int) -> List[Dict[str, Any]]

@app.route("/api/cycles", methods=["POST", "OPTIONS"])
def api_cycles():
    # Handle CORS preflight explicitly so it doesn't 404
    if request.method == "OPTIONS":
        # Flask-CORS will add the headers; just return 204
        return ("", 204)

    # Enforce JWT for actual POST
    try:
        verify_jwt_in_request()
    except Exception:
        return jsonify({"error": "Unauthorized"}), 401

    user_id = int(get_jwt_identity() or 0)

    payload = request.get_json(silent=True) or {}
    graph: Dict[str, List[str]] = payload.get("graph") or {}

    # If no graph was posted, auto-build from DB using same material-name match heuristic as the frontend.
    if not graph:
        scope = (request.args.get("scope") or "user").lower()
        include_all = scope in ("all", "global")

        mats = _collect_materials_full(include_all_users=include_all, user_id=user_id)
        def norm(x): return (str(x).strip().lower() if x is not None else "")

        gens = [m for m in mats if "generator" in norm(m.get("role")) and norm(m.get("waste_type_name"))]
        recs = [m for m in mats if "receiver" in norm(m.get("role")) and norm(m.get("raw_material_name"))]

        graph = {}
        for g in gens:
            gname = g.get("factory_name") or f"Factory#{g.get('factory_id')}"
            gmat = norm(g.get("waste_type_name"))
            for r in recs:
                if gmat != norm(r.get("raw_material_name")):
                    continue
                rname = r.get("factory_name") or f"Factory#{r.get('factory_id')}"
                if gname == rname:
                    continue  # skip self
                graph.setdefault(gname, [])
                if rname not in graph[gname]:
                    graph[gname].append(rname)

    try:
        cycles = find_cycles(graph, max_len=10)
        return jsonify({"cycles": cycles}), 200
    except Exception as e:
        return jsonify({"error": "cycle detection failed", "details": str(e)}), 500

from typing import Dict, Any, List, Tuple, Optional  # ensure these are imported at top
from engine import process_requests  # uses your engine.py's process_requests
# --- helpers for /api/match/all ---

def _ensure_latlon(row: sqlite3.Row) -> Tuple[Optional[float], Optional[float]]:
    lat = row["location_lat"]
    lon = row["location_lon"]
    if lat is not None and lon is not None:
        return float(lat), float(lon)
    # fallback: geocode the text if possible
    loc = row["location_text"] or ""
    ll = geocode_city(loc)
    if ll:
        return float(ll[0]), float(ll[1])
    return None, None

def _to_float_default(v, default=0.0) -> float:
    try:
        if v is None: return float(default)
        if isinstance(v, (int, float)): return float(v)
        s = str(v).lower().strip()
        # grab first number-like token
        import re
        m = re.search(r"[-+]?\d*\.?\d+", s)
        return float(m.group(0)) if m else float(default)
    except Exception:
        return float(default)

def _parse_receiver_requirements(rcv: sqlite3.Row) -> Dict[str, Any]:
    """
    Convert receiver text fields into the structure engine expects.
    We keep 'required_composition' as a small dict if we can derive anything,
    else leave empty; same for 'required_properties' (map keys to simple flags).
    """
    req_comp_text = (rcv.get("required_composition") or "").strip()
    # Very light parser: split by commas like "SiO2 > 40%, Fe2O3 < 10%"
    req_comp: Dict[str, str] = {}
    if req_comp_text:
        parts = [p.strip() for p in req_comp_text.split(",") if p.strip()]
        for p in parts:
            # try "KEY OP VALUE", e.g., "SiO2 > 40%"
            toks = p.replace(":", " ").split()
            if len(toks) >= 3:
                key = toks[0]
                expr = " ".join(toks[1:])
                req_comp[key] = expr
            else:
                # fallback: store as one key with eq
                req_comp[f"spec_{len(req_comp)+1}"] = p

    # required_properties arrives as CSV list in DB
    req_props_csv = rcv.get("required_properties") or ""
    req_props_map: Dict[str, str] = {}
    if req_props_csv:
        for item in [x.strip() for x in req_props_csv.split(",") if x.strip()]:
            # Map a few common tokens into simple constraints if possible
            low = item.lower()
            if "moisture" in low:
                req_props_map["moisture"] = "<10%"
            elif "neutral ph" in low or "pH" in item:
                req_props_map["pH"] = "6.5-8.0"
            else:
                # keep as a boolean-ish flag
                req_props_map[item] = "1"

    return {
        "required_composition": req_comp,
        "required_properties": req_props_map,
    }

@app.get("/api/match/all")
@jwt_required()
def match_all():
    """
    Query params:
      - scope=user (default) -> only current user's data
      - scope=all|global     -> include all users' data
    Returns:
      {
        ranked_matches: [...],
        detected_cycles: [...],
        materials: [...],        # short list
        materials_full: [...]    # full DB details
      }
    """
    scope = (request.args.get("scope") or "user").lower()
    include_all = scope in ("all", "global")
    user_id = int(get_jwt_identity())

    # ----- materials_full / materials (unchanged shape for frontend) -----
    materials_full = _collect_materials_full(include_all_users=include_all, user_id=user_id)

    def _short(m: Dict[str, Any]) -> Dict[str, Any]:
        name = m.get("raw_material_name") or m.get("waste_type_name") or ""
        cat = m.get("raw_material_category") or m.get("waste_category") or ""
        return {
            "factory_id": m["factory_id"],
            "factory_name": m["factory_name"],
            "industry_type": m["industry_type"],
            "location": m["location_text"],
            "location_lat": m["location_lat"],
            "location_lon": m["location_lon"],
            "role": m["role"],
            "material": name,
            "category": cat,
            "created_at": m["created_at"],
        }

    materials = [_short(m) for m in materials_full if (m.get("raw_material_name") or m.get("waste_type_name"))]

    # ----- Build suppliers / receivers directly from DB -----
    con = _connect()
    cur = con.cursor()
    where = "" if include_all else "WHERE f.user_id = ?"
    args = () if include_all else (user_id,)

    # RECEIVERS
    cur.execute(f"""
        SELECT
            f.id               AS factory_id,
            f.factory_name,
            f.industry_type,
            f.email,
            f.location_text,
            f.location_lat,
            f.location_lon,
            f.certification,
            r.raw_material_name,
            r.raw_material_category,
            r.required_composition,
            r.required_properties,
            r.min_purity,
            r.contaminant_tolerance,
            r.form_needed,
            r.particle_size,
            r.temperature_req,
            r.odor_color,
            r.quantity_required,
            r.frequency_requirement,
            r.quality_tolerance,
            r.budget_per_ton,
            r.contract_type,
            r.certification_needed,
            r.max_distance_km
        FROM factories f
        JOIN factory_receiver r ON r.factory_id = f.id
        {where}
    """, args)
    recv_rows = [dict(x) for x in cur.fetchall()]

    # GENERATORS
    cur.execute(f"""
        SELECT
            f.id               AS factory_id,
            f.factory_name,
            f.industry_type,
            f.email,
            f.location_text,
            f.location_lat,
            f.location_lon,
            f.certification,
            g.waste_category,
            g.waste_type_name,
            g.waste_composition,
            g.waste_properties,
            g.quantity_generated,
            g.frequency_generation,
            g.storage_condition,
            g.disposal_cost,
            g.hazard_rating,
            g.preferred_buyer
        FROM factories f
        JOIN factory_generator g ON g.factory_id = f.id
        {where}
    """, args)
    gen_rows = [dict(x) for x in cur.fetchall()]
    con.close()

    # Transform to engine input shape
    suppliers: List[Dict[str, Any]] = []
    receivers: List[Dict[str, Any]] = []

    # Build receivers (consumers)
    for r in recv_rows:
        lat, lon = _ensure_latlon(r)
        # map certification_needed -> certifications_required (array)
        certs_req = []
        if r.get("certification_needed"):
            certs_req = [c.strip() for c in str(r["certification_needed"]).split(",") if c.strip()]

        # quantity_tons: try to derive approximate number from free text
        qty_tons = _to_float_default(r.get("quantity_required"), 0.0)
        freq = r.get("frequency_requirement") or ""

        # cost per ton (processing)
        proc_cost = _to_float_default(r.get("budget_per_ton") or 0.0, 0.0)  # if you keep separate processing_cost add here

        req_maps = _parse_receiver_requirements(r)

        receivers.append({
            "factory_id": r["factory_id"],
            "factory_name": r["factory_name"],
            "industry": r["industry_type"],
            "location": {"lat": lat, "lon": lon} if (lat is not None and lon is not None) else {},
            "material_requirement": {
                "material_type": r.get("raw_material_name") or "",
                "quantity_tons": qty_tons,
                "frequency": freq,
                "required_composition": req_maps.get("required_composition", {}),
                "required_properties": req_maps.get("required_properties", {}),
                "processing_cost_per_ton": proc_cost,
            },
            "logistics": {
                "max_distance_km": _to_float_default(r.get("max_distance_km"), 0.0)
            },
            "certifications_required": certs_req
        })

    # Build suppliers (waste producers)
    for g in gen_rows:
        lat, lon = _ensure_latlon(g)
        # certs supplied by factory row
        certs = [c.strip() for c in str(g.get("certification") or "").split(",") if c.strip()]
        qty_tons = _to_float_default(g.get("quantity_generated"), 0.0)
        freq = g.get("frequency_generation") or ""

        # simple chem/phys maps from free text
        chem_map: Dict[str, Any] = {}
        comp_text = g.get("waste_composition") or ""
        if comp_text:
            # naive split like "Contains 60% CaCO3, 20% Fe2O3"
            parts = [p.strip() for p in comp_text.split(",") if p.strip()]
            for p in parts:
                toks = p.replace("contains", "").replace("Contains", "").strip().split()
                # last token might be key; first numeric is value
                # we store as key_n form if unknown
                key = f"comp_{len(chem_map)+1}"
                try:
                    import re
                    num_match = re.search(r"[-+]?\d*\.?\d+%?", p)
                    val = num_match.group(0) if num_match else ""
                    # guess key as non-numeric remainder
                    left = p.replace(val, "").strip(" ,;")
                    if left:
                        key = left.split()[-1]
                    chem_map[key] = val
                except Exception:
                    chem_map[key] = p

        phys_map: Dict[str, Any] = {}
        props_csv = g.get("waste_properties") or ""
        if props_csv:
            for item in [x.strip() for x in props_csv.split(",") if x.strip()]:
                low = item.lower()
                if "moisture" in low:
                    phys_map["moisture"] = "<10%" if "10" in low else "1"
                elif "ph" in low:
                    phys_map["pH"] = "7.0-8.0"
                else:
                    phys_map[item] = "1"

        suppliers.append({
            "factory_id": g["factory_id"],
            "factory_name": g["factory_name"],
            "industry": g["industry_type"],
            "location": {"lat": lat, "lon": lon} if (lat is not None and lon is not None) else {},
            "waste_output": {
                "material_type": g.get("waste_type_name") or "",
                "quantity_tons": qty_tons,
                "frequency": freq,
                "chemical_composition": chem_map,
                "physical_properties": phys_map,
                # allow engine to estimate landfill baseline; if you have it, store in DB and map here
                "current_disposal_landfill_km": 80
            },
            "certifications": certs
        })

    # If either side is empty, still return materials (and empty match result)
    if not suppliers or not receivers:
        return jsonify({
            "ranked_matches": [],
            "detected_cycles": [],
            "materials": materials,
            "materials_full": materials_full
        }), 200

    # ----- Run engine -----
    try:
        engine_out = process_requests(suppliers, receivers) or {}
        # Ensure required keys always present
        ranked = engine_out.get("ranked_matches", []) or []
        cycles = engine_out.get("detected_cycles", []) or []
        return jsonify({
            "ranked_matches": ranked,
            "detected_cycles": cycles,
            "materials": materials,
            "materials_full": materials_full
        }), 200
    except Exception as e:
        app.logger.exception("engine.process_requests failed")
        return jsonify({
            "error": "match failed",
            "details": str(e),
            "ranked_matches": [],
            "detected_cycles": [],
            "materials": materials,
            "materials_full": materials_full
        }), 500


# =========================
# Run server
# =========================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5050"))
    debug = os.environ.get("DEBUG", "true").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)
