"""
FastAPI backend for the Airport Baggage Risk Dashboard.
"""

from __future__ import annotations

import asyncio
import json
import random
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import csv
import io

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from data_generator import generate_dataset
from risk_engine import score_all, get_feature_importances, rescore_bag

DATA_PATH = Path(__file__).parent / "data" / "bags.json"

app = FastAPI(title="Baggage Risk Dashboard API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory store (loaded once, can be refreshed)
# ---------------------------------------------------------------------------
_scored_bags: list[dict] = []
_feature_importances: dict[str, float] = {}


def _load_and_score():
    global _scored_bags, _feature_importances
    if DATA_PATH.exists():
        with open(DATA_PATH) as f:
            raw = json.load(f)
    else:
        raw = generate_dataset(200)
        DATA_PATH.parent.mkdir(exist_ok=True)
        with open(DATA_PATH, "w") as f:
            json.dump(raw, f, indent=2)

    _scored_bags, _feature_importances = score_all(raw)


# ---------------------------------------------------------------------------
# Real-time simulation loop
# ---------------------------------------------------------------------------

SIMULATION_STATUSES = [
    "arrived_at_carousel", "in_transfer_system", "sorted", "on_hold", "manual_handling",
]


async def _simulation_loop():
    """Mutate bag data every 12 seconds to simulate live airport operations."""
    while True:
        await asyncio.sleep(12)
        if not _scored_bags:
            continue

        # Only mutate bags not already resolved or loaded
        eligible = [
            b for b in _scored_bags
            if b.get("current_status") not in ("loaded_outbound",)
            and b.get("intervention_status") != "resolved"
            and not b.get("intervention_done")
        ]
        if not eligible:
            continue

        sample = random.sample(eligible, min(7, len(eligible)))
        for bag in sample:
            mutated = False

            # 35% chance: worsen delay, reduce effective layover
            if random.random() < 0.35:
                delta = random.randint(2, 10)
                bag["arrival_delay_minutes"] = bag.get("arrival_delay_minutes", 0) + delta
                bag["layover_minutes"] = max(5, bag.get("layover_minutes", 30) - delta)
                mutated = True

            # 40% chance: status progression
            if random.random() < 0.40:
                bag["current_status"] = random.choice(SIMULATION_STATUSES)

            # 20% chance: congestion fluctuation
            if random.random() < 0.20:
                bag["baggage_system_congestion_score"] = round(
                    min(1.0, max(0.0, bag.get("baggage_system_congestion_score", 0.3) + random.uniform(-0.1, 0.15))),
                    3,
                )
                mutated = True

            # Rescore only if risk-relevant fields changed
            if mutated:
                scored = rescore_bag(bag)
                bag.update({
                    "risk_score": scored["risk_score"],
                    "risk_level": scored["risk_level"],
                    "risk_reasons": scored["risk_reasons"],
                    "recommended_action": scored["recommended_action"],
                    "risk_factors": scored.get("risk_factors", []),
                    "confidence_score": scored.get("confidence_score"),
                    "confidence_flags": scored.get("confidence_flags", []),
                })


@app.on_event("startup")
async def startup():
    _load_and_score()
    asyncio.ensure_future(_simulation_loop())


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "bags_loaded": len(_scored_bags)}


@app.get("/bags")
def get_bags(
    risk_level: Optional[str] = Query(None, description="Low | Medium | High"),
    search: Optional[str] = Query(None, description="Filter by bag_id or flight number"),
    sort_by: Optional[str] = Query("risk_score", description="Field to sort by"),
    sort_dir: Optional[str] = Query("desc", description="asc | desc"),
    limit: int = Query(200, le=500),
    offset: int = Query(0),
):
    bags = list(_scored_bags)

    if risk_level:
        bags = [b for b in bags if b.get("risk_level", "").lower() == risk_level.lower()]

    if search:
        q = search.lower()
        bags = [
            b for b in bags
            if q in b.get("bag_id", "").lower()
            or q in b.get("inbound_flight", "").lower()
            or q in b.get("outbound_flight", "").lower()
            or q in b.get("passenger_id", "").lower()
        ]

    reverse = sort_dir.lower() != "asc"
    try:
        bags.sort(key=lambda b: b.get(sort_by, 0) or 0, reverse=reverse)
    except Exception:
        pass

    total = len(bags)
    return {"total": total, "bags": bags[offset: offset + limit]}


@app.get("/bags/{bag_id}")
def get_bag(bag_id: str):
    for bag in _scored_bags:
        if bag["bag_id"] == bag_id:
            return _enrich_with_timeline(bag)
    raise HTTPException(status_code=404, detail=f"Bag {bag_id} not found")


@app.get("/analytics")
def get_analytics():
    if not _scored_bags:
        return {}

    total = len(_scored_bags)
    high = sum(1 for b in _scored_bags if b.get("risk_level") == "High")
    medium = sum(1 for b in _scored_bags if b.get("risk_level") == "Medium")
    low = sum(1 for b in _scored_bags if b.get("risk_level") == "Low")
    avg_score = round(sum(b.get("risk_score", 0) for b in _scored_bags) / total, 1)
    predicted_missed = sum(1 for b in _scored_bags if b.get("risk_score", 0) >= 65)
    actual_missed = sum(1 for b in _scored_bags if b.get("missed_connection_label"))

    buckets = [0] * 10
    for b in _scored_bags:
        idx = min(int(b.get("risk_score", 0) // 10), 9)
        buckets[idx] += 1
    risk_distribution = [
        {"range": f"{i*10}-{i*10+9}", "count": buckets[i]} for i in range(10)
    ]

    importances = get_feature_importances()
    sorted_importances = sorted(importances.items(), key=lambda x: -x[1])

    return {
        "total_bags": total,
        "high_risk": high,
        "medium_risk": medium,
        "low_risk": low,
        "average_risk_score": avg_score,
        "predicted_missed_bags": predicted_missed,
        "actual_missed_bags": actual_missed,
        "risk_distribution": risk_distribution,
        "feature_importances": [
            {"feature": k, "importance": v} for k, v in sorted_importances
        ],
    }


REQUIRED_FIELDS = [
    "bag_id", "passenger_id", "inbound_flight", "outbound_flight",
    "scheduled_arrival", "actual_arrival", "scheduled_departure",
    "layover_minutes", "arrival_delay_minutes", "terminal_change", "gate_change",
    "late_checkin_flag", "customs_recheck_required", "security_recheck_required",
    "historical_route_disruption_score", "baggage_system_congestion_score",
    "processing_buffer_minutes", "current_status",
]

OPTIONAL_FIELDS_DEFAULTS = {
    "airport": "UNK",
    "inbound_terminal": "T1",
    "outbound_terminal": "T1",
    "inbound_gate": "A1",
    "outbound_gate": "A1",
    "time_bag_received": None,
    "time_bag_sorted": None,
    "time_to_departure": 0,
    "missed_connection_label": False,
    "passenger_id": "PAX00000",
}


def _coerce_row(row: dict) -> dict:
    bool_fields = {
        "terminal_change", "gate_change", "late_checkin_flag",
        "customs_recheck_required", "security_recheck_required",
        "missed_connection_label",
    }
    int_fields = {
        "layover_minutes", "arrival_delay_minutes",
        "processing_buffer_minutes", "time_to_departure",
    }
    float_fields = {
        "historical_route_disruption_score", "baggage_system_congestion_score",
    }
    for f in bool_fields:
        if f in row:
            row[f] = str(row[f]).strip().lower() in ("1", "true", "yes")
    for f in int_fields:
        if f in row:
            try:
                row[f] = int(float(row[f]))
            except (ValueError, TypeError):
                row[f] = 0
    for f in float_fields:
        if f in row:
            try:
                row[f] = round(float(row[f]), 4)
            except (ValueError, TypeError):
                row[f] = 0.0
    for f, default in OPTIONAL_FIELDS_DEFAULTS.items():
        row.setdefault(f, default)
    return row


@app.post("/upload")
async def upload_csv(file: UploadFile = File(...)):
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a .csv file.")

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        rows = [dict(r) for r in reader]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {e}")

    if not rows:
        raise HTTPException(status_code=400, detail="CSV is empty.")

    missing = [f for f in REQUIRED_FIELDS if f not in rows[0]]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Missing required columns: {missing}. Download the template for the expected format.",
        )

    coerced = [_coerce_row(r) for r in rows]

    DATA_PATH.parent.mkdir(exist_ok=True)
    with open(DATA_PATH, "w") as f:
        json.dump(coerced, f, indent=2)

    has_labels = any(r.get("missed_connection_label") for r in coerced)
    if has_labels:
        model_path = DATA_PATH.parent / "model.pkl"
        if model_path.exists():
            model_path.unlink()

    _load_and_score()
    return {
        "status": "uploaded",
        "rows_loaded": len(_scored_bags),
        "model_retrained": has_labels,
        "message": "Model retrained on your data." if has_labels else
                   "Using pre-trained model (no missed_connection_label column found).",
    }


@app.get("/upload/template")
def download_template():
    all_fields = REQUIRED_FIELDS + [
        f for f in OPTIONAL_FIELDS_DEFAULTS if f not in REQUIRED_FIELDS
    ]
    example = {
        "bag_id": "BAG00001", "passenger_id": "PAX12345",
        "inbound_flight": "AA123", "outbound_flight": "UA456",
        "airport": "JFK",
        "inbound_terminal": "T4", "outbound_terminal": "T1",
        "inbound_gate": "B12", "outbound_gate": "C5",
        "scheduled_arrival": "2025-03-27T08:00:00",
        "actual_arrival": "2025-03-27T08:25:00",
        "scheduled_departure": "2025-03-27T09:15:00",
        "layover_minutes": 75, "arrival_delay_minutes": 25,
        "terminal_change": True, "gate_change": False,
        "late_checkin_flag": False,
        "time_bag_received": "2025-03-27T08:35:00",
        "time_bag_sorted": "2025-03-27T08:50:00",
        "customs_recheck_required": False,
        "security_recheck_required": False,
        "historical_route_disruption_score": 0.3,
        "baggage_system_congestion_score": 0.4,
        "processing_buffer_minutes": 25,
        "time_to_departure": 45,
        "current_status": "in_transfer_system",
        "missed_connection_label": False,
    }
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=all_fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerow(example)
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=transitguard_template.csv"},
    )


@app.post("/refresh")
def refresh_data():
    raw = generate_dataset(200)
    DATA_PATH.parent.mkdir(exist_ok=True)
    model_path = DATA_PATH.parent / "model.pkl"
    if model_path.exists():
        model_path.unlink()
    with open(DATA_PATH, "w") as f:
        json.dump(raw, f, indent=2)
    _load_and_score()
    return {"status": "refreshed", "bags": len(_scored_bags)}


@app.post("/bags/{bag_id}/intervene")
def simulate_intervention(bag_id: str):
    """Simulate a staff intervention — reduces risk score. Can only be triggered once."""
    for bag in _scored_bags:
        if bag["bag_id"] == bag_id:
            if bag.get("intervention_done"):
                raise HTTPException(status_code=409, detail="Intervention already logged for this bag.")
            old_score = bag["risk_score"]
            bag["risk_score"] = max(0, old_score - random.uniform(15, 30))
            bag["risk_score"] = round(bag["risk_score"], 1)
            bag["current_status"] = "manual_handling"
            bag["intervention_done"] = True
            bag["intervention_status"] = "in_progress"
            bag["recommended_action"] = "Intervention logged — bag being expedited"
            if bag["risk_score"] < 35:
                bag["risk_level"] = "Low"
            elif bag["risk_score"] < 65:
                bag["risk_level"] = "Medium"
            return {
                "bag_id": bag_id,
                "old_risk_score": old_score,
                "new_risk_score": bag["risk_score"],
                "new_risk_level": bag["risk_level"],
            }
    raise HTTPException(status_code=404, detail=f"Bag {bag_id} not found")


class InterventionStatusUpdate(BaseModel):
    status: str


@app.patch("/bags/{bag_id}/intervention-status")
def update_intervention_status(bag_id: str, body: InterventionStatusUpdate):
    """Update intervention workflow status: none → pending → in_progress → resolved."""
    valid = {"none", "pending", "in_progress", "resolved"}
    if body.status not in valid:
        raise HTTPException(status_code=400, detail=f"Status must be one of: {valid}")
    for bag in _scored_bags:
        if bag["bag_id"] == bag_id:
            bag["intervention_status"] = body.status
            if body.status == "resolved":
                bag["risk_score"] = max(0, round(bag["risk_score"] - 10, 1))
                if bag["risk_score"] < 35:
                    bag["risk_level"] = "Low"
                elif bag["risk_score"] < 65:
                    bag["risk_level"] = "Medium"
            return {"bag_id": bag_id, "intervention_status": body.status}
    raise HTTPException(status_code=404, detail=f"Bag {bag_id} not found")


@app.get("/passenger/{passenger_id}")
def get_passenger_status(passenger_id: str):
    for bag in _scored_bags:
        if bag["passenger_id"] == passenger_id:
            risk_score = bag.get("risk_score", 0)
            intervention_status = bag.get("intervention_status", "none")
            if intervention_status == "resolved":
                notification_status = "on_track"
                message = "Your bag was flagged earlier but has been successfully handled. It's on track for your connection."
            elif risk_score >= 65:
                notification_status = "at_risk"
                message = "Your bag is at risk of missing your connection. Our team is working on it."
            elif risk_score >= 35:
                notification_status = "monitored"
                message = "Your bag is being closely monitored. No action needed from you."
            else:
                notification_status = "on_track"
                message = "Your bag is on track for your connection."
            return {
                "passenger_id": passenger_id,
                "bag_id": bag["bag_id"],
                "outbound_flight": bag["outbound_flight"],
                "scheduled_departure": bag.get("scheduled_departure"),
                "notification_status": notification_status,
                "message": message,
                "risk_score": risk_score,
                "risk_level": bag.get("risk_level"),
            }
    raise HTTPException(status_code=404, detail=f"Passenger {passenger_id} not found")


@app.get("/live-updates")
def live_updates():
    """Return current status snapshot for a few random bags."""
    sample = random.sample(_scored_bags, min(5, len(_scored_bags)))
    updates = []
    for bag in sample:
        updates.append({
            "bag_id": bag["bag_id"],
            "current_status": bag.get("current_status"),
            "risk_score": bag.get("risk_score"),
            "risk_level": bag.get("risk_level"),
            "timestamp": datetime.now().isoformat(),
        })
    return {"updates": updates}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _enrich_with_timeline(bag: dict) -> dict:
    bag = dict(bag)
    actual_arrival = bag.get("actual_arrival", datetime.now().isoformat())
    sorted_time = bag.get("time_bag_sorted", actual_arrival)
    current_status = bag.get("current_status", "")

    def offset(base_iso: str, minutes: int) -> str:
        try:
            dt = datetime.fromisoformat(base_iso)
            return (dt + timedelta(minutes=minutes)).isoformat()
        except Exception:
            return base_iso

    def event_status(required_statuses: list[str]) -> str:
        completed = ["sorted", "loaded_outbound", "manual_handling"]
        if current_status in required_statuses or current_status in completed:
            return "completed"
        if current_status == "in_transfer_system":
            return "in_progress"
        return "pending"

    timeline = [
        {
            "event": "Bag checked in at origin",
            "time": offset(bag.get("scheduled_arrival", actual_arrival), -90),
            "status": "completed",
        },
        {
            "event": "Inbound flight arrived",
            "time": actual_arrival,
            "status": "completed",
        },
        {
            "event": "Bag offloaded from aircraft",
            "time": offset(actual_arrival, 8),
            "status": "completed",
        },
        {
            "event": "Bag received at transfer belt",
            "time": bag.get("time_bag_received"),
            "status": "completed",
        },
        {
            "event": "Bag sorted in BHS",
            "time": sorted_time,
            "status": event_status(["sorted", "loaded_outbound"]),
        },
    ]

    if bag.get("customs_recheck_required"):
        timeline.append({
            "event": "Customs re-check",
            "time": offset(sorted_time, 5),
            "status": event_status(["loaded_outbound"]),
        })
    if bag.get("security_recheck_required"):
        timeline.append({
            "event": "Security re-check",
            "time": offset(sorted_time, 10),
            "status": event_status(["loaded_outbound"]),
        })
    if bag.get("terminal_change"):
        timeline.append({
            "event": "Inter-terminal transfer",
            "time": offset(sorted_time, 18),
            "status": event_status(["loaded_outbound"]),
        })

    timeline.append({
        "event": "Loaded onto outbound flight",
        "time": bag.get("scheduled_departure"),
        "status": "completed" if current_status == "loaded_outbound" else "pending",
    })

    def sort_key(e: dict) -> str:
        return e.get("time") or ""

    timeline.sort(key=sort_key)
    bag["timeline"] = timeline
    return bag
