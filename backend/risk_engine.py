"""
Baggage missed-connection risk scoring engine.

Hybrid approach:
  - Random Forest classifier trained on synthetic data for score prediction
  - Rules-based explanation layer for human-readable reasons
  - Recommended action mapping based on risk level and dominant factors
"""

from __future__ import annotations

import json
import os
import pickle
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler

MODEL_PATH = Path(__file__).parent / "data" / "model.pkl"
FEATURE_COLS = [
    "layover_minutes",
    "arrival_delay_minutes",
    "terminal_change",
    "gate_change",
    "late_checkin_flag",
    "customs_recheck_required",
    "security_recheck_required",
    "historical_route_disruption_score",
    "baggage_system_congestion_score",
    "processing_buffer_minutes",
]

_model: RandomForestClassifier | None = None
_scaler: StandardScaler | None = None
_feature_importances: dict[str, float] = {}


def _load_or_train_model(bags: list[dict]) -> tuple[RandomForestClassifier, StandardScaler]:
    if MODEL_PATH.exists():
        with open(MODEL_PATH, "rb") as f:
            obj = pickle.load(f)
        return obj["model"], obj["scaler"]

    df = pd.DataFrame(bags)
    X = df[FEATURE_COLS].astype(float)
    y = df["missed_connection_label"].astype(int)

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    model = RandomForestClassifier(
        n_estimators=200,
        max_depth=6,
        min_samples_leaf=4,
        class_weight="balanced",
        random_state=42,
    )
    model.fit(X_scaled, y)

    MODEL_PATH.parent.mkdir(exist_ok=True)
    with open(MODEL_PATH, "wb") as f:
        pickle.dump({"model": model, "scaler": scaler}, f)

    return model, scaler


def _get_feature_importances(model: RandomForestClassifier) -> dict[str, float]:
    return {
        col: round(float(imp), 4)
        for col, imp in zip(FEATURE_COLS, model.feature_importances_)
    }


# ---------------------------------------------------------------------------
# Explanation layer
# ---------------------------------------------------------------------------

REASON_RULES = [
    (
        lambda b: b.get("layover_minutes", 999) < 35,
        "Very tight layover (< 35 min)",
        "layover_minutes",
        3,
    ),
    (
        lambda b: 35 <= b.get("layover_minutes", 999) < 50,
        "Short layover (< 50 min)",
        "layover_minutes",
        2,
    ),
    (
        lambda b: b.get("arrival_delay_minutes", 0) > 45,
        "Significant arrival delay (> 45 min)",
        "arrival_delay_minutes",
        3,
    ),
    (
        lambda b: 20 < b.get("arrival_delay_minutes", 0) <= 45,
        "Moderate arrival delay",
        "arrival_delay_minutes",
        2,
    ),
    (
        lambda b: b.get("customs_recheck_required", False),
        "Customs re-check required",
        "customs_recheck_required",
        3,
    ),
    (
        lambda b: b.get("security_recheck_required", False),
        "Security re-check required",
        "security_recheck_required",
        3,
    ),
    (
        lambda b: b.get("terminal_change", False),
        "Terminal change required",
        "terminal_change",
        2,
    ),
    (
        lambda b: b.get("gate_change", False),
        "Gate change required",
        "gate_change",
        1,
    ),
    (
        lambda b: b.get("late_checkin_flag", False),
        "Late check-in flag",
        "late_checkin_flag",
        2,
    ),
    (
        lambda b: b.get("processing_buffer_minutes", 999) < 15,
        "Very little processing buffer (< 15 min)",
        "processing_buffer_minutes",
        3,
    ),
    (
        lambda b: b.get("historical_route_disruption_score", 0) > 0.7,
        "High historical route disruption",
        "historical_route_disruption_score",
        2,
    ),
    (
        lambda b: b.get("baggage_system_congestion_score", 0) > 0.7,
        "High baggage system congestion",
        "baggage_system_congestion_score",
        2,
    ),
]


def _get_reasons(bag: dict, top_n: int = 4) -> list[str]:
    fired = []
    for predicate, text, feature, weight in REASON_RULES:
        try:
            if predicate(bag):
                fired.append((weight, text))
        except Exception:
            pass
    fired.sort(key=lambda x: -x[0])
    return [text for _, text in fired[:top_n]]


def _get_risk_factor_scores(bag: dict, risk_score: float) -> list[dict]:
    """Per-factor contribution to risk score, weighted proportionally."""
    fired = []
    for predicate, text, feature, weight in REASON_RULES:
        try:
            if predicate(bag):
                fired.append({"label": text, "feature": feature, "weight": weight})
        except Exception:
            pass
    if not fired:
        return []
    total_weight = sum(f["weight"] for f in fired)
    result = []
    for f in fired:
        contribution = round((f["weight"] / total_weight) * risk_score, 1)
        result.append({
            "label": f["label"],
            "feature": f["feature"],
            "score": contribution,
        })
    result.sort(key=lambda x: -x["score"])
    return result


def _get_confidence(bag: dict) -> tuple[int, list[str]]:
    """Compute data confidence score (0-100) and reliability flags."""
    flags = []
    score = 100

    if not bag.get("time_bag_received"):
        flags.append("Missing bag receipt timestamp")
        score -= 15
    if not bag.get("time_bag_sorted"):
        flags.append("Missing sort timestamp")
        score -= 15

    try:
        actual = datetime.fromisoformat(str(bag["actual_arrival"]))
        departure = datetime.fromisoformat(str(bag["scheduled_departure"]))
        if actual >= departure:
            flags.append("Arrival time is after scheduled departure — data conflict")
            score -= 25
    except Exception:
        pass

    if bag.get("arrival_delay_minutes", 0) > 180:
        flags.append("Unusually high delay (> 3h) — verify data accuracy")
        score -= 10
    if bag.get("layover_minutes", 0) > 480:
        flags.append("Layover > 8h — may be a planned stopover, not a transfer")
        score -= 5

    return max(0, score), flags


ACTION_MAP = [
    (lambda b, s, r: r >= 75 and b.get("customs_recheck_required"), "Escort bag through customs fast-track and notify outbound gate team"),
    (lambda b, s, r: r >= 75 and b.get("security_recheck_required"), "Send bag to expedited security screening; alert supervisor"),
    (lambda b, s, r: r >= 75 and b.get("layover_minutes", 999) < 35, "Prioritize for immediate tarmac transfer; trigger passenger alert"),
    (lambda b, s, r: r >= 75, "Escalate to supervisor — flag for manual handling and gate notification"),
    (lambda b, s, r: r >= 50 and b.get("terminal_change"), "Expedite inter-terminal transfer; notify outbound gate"),
    (lambda b, s, r: r >= 50 and b.get("arrival_delay_minutes", 0) > 30, "Flag for priority unload from inbound flight"),
    (lambda b, s, r: r >= 50, "Prioritize sort and transfer; monitor closely"),
    (lambda b, s, r: r >= 25, "Mark for enhanced tracking; review if status doesn't update within 10 min"),
    (lambda b, s, r: True, "Standard handling — no intervention required"),
]


def _get_action(bag: dict, risk_score: float, risk_level: str) -> str:
    for predicate, action in ACTION_MAP:
        try:
            if predicate(bag, risk_score, risk_score):
                return action
        except Exception:
            pass
    return "Standard handling"


def score_bag(bag: dict, model: RandomForestClassifier, scaler: StandardScaler) -> dict:
    features = pd.DataFrame([[float(bag.get(col, 0)) for col in FEATURE_COLS]], columns=FEATURE_COLS)
    features_scaled = scaler.transform(features)

    prob = model.predict_proba(features_scaled)[0]
    missed_prob = prob[1] if len(prob) > 1 else prob[0]
    risk_score = round(float(missed_prob) * 100, 1)

    if risk_score >= 65:
        risk_level = "High"
    elif risk_score >= 35:
        risk_level = "Medium"
    else:
        risk_level = "Low"

    reasons = _get_reasons(bag)
    action = _get_action(bag, risk_score, risk_level)
    risk_factors = _get_risk_factor_scores(bag, risk_score)
    confidence_score, confidence_flags = _get_confidence(bag)

    return {
        **bag,
        "risk_score": risk_score,
        "risk_level": risk_level,
        "risk_reasons": reasons,
        "recommended_action": action,
        "risk_factors": risk_factors,
        "confidence_score": confidence_score,
        "confidence_flags": confidence_flags,
        "intervention_status": bag.get("intervention_status", "none"),
    }


def rescore_bag(bag: dict) -> dict:
    """Rescore a single bag using the cached model (used by simulation loop)."""
    if _model is None or _scaler is None:
        return bag
    return score_bag(bag, _model, _scaler)


def score_all(bags: list[dict]) -> tuple[list[dict], dict]:
    global _model, _scaler, _feature_importances
    if _model is None:
        _model, _scaler = _load_or_train_model(bags)
        _feature_importances = _get_feature_importances(_model)
    return [score_bag(b, _model, _scaler) for b in bags], _feature_importances


def get_feature_importances() -> dict[str, float]:
    return _feature_importances
