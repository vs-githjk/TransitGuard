# BagTrack — Technical Documentation

**ENGR 408 ACRP Project**
**Live:** https://bagtracker-six.vercel.app | https://bagtracker-production.up.railway.app

---

## 1. Problem Statement

Current airport baggage handling is reactive. Bags that miss tight flight connections are typically discovered only after the passenger has already boarded the outbound flight or after the flight has departed. This causes delays, rework, passenger frustration, and operational cost. BagTrack addresses this by predicting which transfer bags are at risk *before* the connection is missed, giving operations staff time to intervene.

---

## 2. System Architecture

```
┌──────────────────────────────┐        ┌─────────────────────────────────┐
│        Next.js Frontend       │  HTTP  │         FastAPI Backend          │
│     bagtracker-six.vercel.app │◄──────►│  bagtracker-production.railway   │
│                               │        │                                  │
│  /            Dashboard        │        │  GET  /bags                      │
│  /bags/[id]   Bag Detail       │        │  GET  /bags/{id}                 │
│  /analytics   Analytics        │        │  GET  /analytics                 │
│  /passenger   Notifications    │        │  GET  /passenger/{id}            │
│                               │        │  POST /bags/{id}/intervene       │
│  Recharts, Lucide, Tailwind   │        │  POST /upload                    │
│  TypeScript, React 19         │        │  GET  /upload/template           │
└──────────────────────────────┘        │  POST /refresh                   │
                                         │                                  │
                                         │  risk_engine.py (RF + rules)     │
                                         │  data_generator.py (synthetic)   │
                                         │  data/bags.json (200 bags)       │
                                         │  data/model.pkl (cached RF)      │
                                         └─────────────────────────────────┘
```

**Frontend** is a Next.js 16 app with Tailwind CSS v4, deployed on Vercel. All pages are client components that fetch from the backend API on load and poll every 8–10 seconds for live updates.

**Backend** is a FastAPI Python app deployed on Railway. It holds the in-memory scored bag dataset, runs the risk model, and serves all data via REST endpoints. State is in-memory — restarting the server regenerates from `bags.json`.

---

## 3. Data Model

Each bag record contains the following fields:

### Identity
| Field | Type | Description |
|-------|------|-------------|
| bag_id | string | Unique bag identifier (e.g. BAG00001) |
| passenger_id | string | Linked passenger (e.g. PAX12345) |

### Flight Information
| Field | Type | Description |
|-------|------|-------------|
| inbound_flight | string | Arriving flight number |
| outbound_flight | string | Departing flight number |
| airport | string | Hub airport code |
| inbound_terminal / gate | string | Where the bag arrives |
| outbound_terminal / gate | string | Where the bag needs to go |
| scheduled_arrival | datetime | Planned inbound arrival |
| actual_arrival | datetime | Real inbound arrival (may be delayed) |
| scheduled_departure | datetime | Planned outbound departure |

### Risk Features (model inputs)
| Field | Type | Description |
|-------|------|-------------|
| layover_minutes | int | Time between scheduled arrival and departure |
| arrival_delay_minutes | int | How late the inbound flight arrived |
| terminal_change | bool | Whether the bag must move between terminals |
| gate_change | bool | Whether the departure gate zone differs |
| late_checkin_flag | bool | Passenger checked in late at origin |
| customs_recheck_required | bool | Bag must go through customs again |
| security_recheck_required | bool | Bag must go through security again |
| historical_route_disruption_score | float (0–1) | How often this route has had disruptions historically |
| baggage_system_congestion_score | float (0–1) | Current BHS congestion level |
| processing_buffer_minutes | int | Time between bag sorted and flight departure |

### Derived / Output
| Field | Type | Description |
|-------|------|-------------|
| risk_score | float (0–100) | Model output probability × 100 |
| risk_level | string | Low / Medium / High |
| risk_reasons | string[] | Top 2–4 plain-English explanations |
| recommended_action | string | Staff instruction |
| missed_connection_label | bool | Ground truth (used for training only) |

---

## 4. Risk Scoring Engine

**File:** `backend/risk_engine.py`

The engine uses a **hybrid approach**: a machine learning model for the numerical score, and a rules-based layer for human-readable explanations.

### 4.1 Machine Learning Model

**Algorithm:** Random Forest Classifier (scikit-learn)

**Configuration:**
```python
RandomForestClassifier(
    n_estimators=200,
    max_depth=6,
    min_samples_leaf=4,
    class_weight="balanced",
    random_state=42,
)
```

**Training:** The model trains on startup using all 200 bags from `bags.json`. Features are standardised with `StandardScaler` before training. The model is then cached to `data/model.pkl` so subsequent restarts don't retrain from scratch.

**Output:** The classifier outputs a probability of missed connection (0.0–1.0), which is multiplied by 100 to produce the risk score.

**Risk level thresholds:**
- Score < 35 → Low
- Score 35–64 → Medium
- Score ≥ 65 → High

### 4.2 Rules-Based Explanation Layer

Independent of the ML model, a set of threshold rules fires against each bag to produce human-readable reasons. Each rule has a weight (1–3):

| Rule | Threshold | Weight |
|------|-----------|--------|
| Very tight layover | < 35 min | 3 |
| Short layover | 35–50 min | 2 |
| Significant arrival delay | > 45 min | 3 |
| Moderate arrival delay | 20–45 min | 2 |
| Customs re-check required | true | 3 |
| Security re-check required | true | 3 |
| Terminal change | true | 2 |
| Gate change | true | 1 |
| Late check-in | true | 2 |
| Very little processing buffer | < 15 min | 3 |
| High route disruption score | > 0.7 | 2 |
| High BHS congestion | > 0.7 | 2 |

The top 4 rules by weight are returned as `risk_reasons`.

### 4.3 Recommended Action Mapping

Actions are mapped from risk score + dominant flag:

| Condition | Action |
|-----------|--------|
| Score ≥ 75 + customs recheck | Escort bag through customs fast-track |
| Score ≥ 75 + security recheck | Expedited security screening, alert supervisor |
| Score ≥ 75 + layover < 35 min | Immediate tarmac transfer, trigger passenger alert |
| Score ≥ 75 (other) | Escalate to supervisor, manual handling |
| Score ≥ 50 + terminal change | Expedite inter-terminal transfer |
| Score ≥ 50 + delay > 30 min | Priority unload from inbound flight |
| Score ≥ 50 | Prioritize sort and transfer |
| Score ≥ 25 | Enhanced tracking, monitor |
| Score < 25 | Standard handling |

---

## 5. Synthetic Data Generator

**File:** `backend/data_generator.py`

Generates 200 realistic transfer bag records with a controlled risk distribution (~30% High, ~40% Medium, ~30% Low).

Each bag is assigned a risk tier at generation time, which controls the probability ranges for key features:

| Tier | Layover | Delay | Recheck probability | Disruption score |
|------|---------|-------|---------------------|-----------------|
| High | 25–50 min | 30–120 min | 25–40% | 0.5–1.0 |
| Medium | 45–100 min | 5–40 min | 6–12% | 0.2–0.7 |
| Low | 90–240 min | 0–10 min | 2–3% | 0.0–0.35 |

Ground-truth `missed_connection_label` is computed from a weighted rules function (`_compute_missed_probability`) and used to train the Random Forest.

---

## 6. API Reference

**Base URL:** `https://bagtracker-production.up.railway.app`

Interactive docs at `/docs`.

### GET /bags
Returns all scored bags. Supports:
- `risk_level` — filter: High / Medium / Low
- `search` — partial match on bag_id, flight, passenger_id
- `sort_by` — field name (default: risk_score)
- `sort_dir` — asc / desc
- `limit`, `offset` — pagination

### GET /bags/{bag_id}
Returns full bag detail including the computed timeline.

### GET /analytics
Returns aggregate metrics: counts by risk level, average score, predicted missed, actual missed, risk distribution buckets, and feature importances from the trained model.

### GET /passenger/{passenger_id}
Returns a passenger-facing notification status (on_track / monitored / at_risk) with a plain-English message.

### POST /bags/{bag_id}/intervene
Simulates a staff intervention. Reduces the risk score by 15–30 points, sets status to `manual_handling`. Can only be called once per bag (returns 409 on second call).

### POST /upload
Accepts a multipart CSV file upload. Validates required columns, coerces types, replaces the in-memory dataset, and rescores. If the CSV includes `missed_connection_label`, retrains the model on the new data.

### GET /upload/template
Returns a downloadable CSV with the correct column headers and one example row.

### POST /refresh
Regenerates 200 synthetic bags, deletes the cached model, and retrains from scratch.

### GET /live-updates
Returns simulated status updates for 5 random bags. Used by the frontend for polling.

---

## 7. Frontend Architecture

**Framework:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4

**Key files:**
```
frontend/
  app/
    page.tsx              — Dashboard (client component, polls every 8s)
    bags/[bagId]/page.tsx — Bag detail (polls every 10s)
    analytics/page.tsx    — Analytics with Recharts charts
    passenger/page.tsx    — Passenger notification lookup
  components/
    Sidebar.tsx           — Navigation sidebar
    RiskBadge.tsx         — Coloured Low/Medium/High chip
    StatusChip.tsx        — Bag status label with colour
    RiskScoreBar.tsx      — Inline score bar with number
  lib/
    api.ts                — All fetch calls to the backend
    types.ts              — Shared TypeScript interfaces
    utils.ts              — Formatting and colour helpers
```

All pages are `"use client"` components since they require state, event handlers, and polling. Server Components are not used because all data is dynamic and fetched at runtime from the external API.

**Environment variable:**
```
NEXT_PUBLIC_API_URL=https://bagtracker-production.up.railway.app
```

---

## 8. Deployment

| Layer | Platform | URL |
|-------|----------|-----|
| Frontend | Vercel (auto-deploy from GitHub) | bagtracker-six.vercel.app |
| Backend | Railway (root: `backend/`) | bagtracker-production.up.railway.app |
| Source | GitHub | github.com/vs-githjk/BagTracker |

**Deploy flow:** Push to `main` on GitHub → Vercel auto-rebuilds frontend → Railway auto-redeploys backend.

---

## 9. Running Locally

```bash
# Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
# Open http://localhost:3000
```

---

## 10. Limitations and Future Work

| Limitation | Production solution |
|------------|-------------------|
| Synthetic data only | Integrate with airport DCS/BHS via SITA or IATA Type B messages |
| Model trained on 200 bags | Retrain on years of historical flight + bag outcome data |
| No authentication | Add role-based access (ops staff vs. supervisor vs. passenger) |
| In-memory state | Replace with PostgreSQL or SQLite for persistence across restarts |
| Static model | Implement scheduled retraining as new outcome data accumulates |
| Single airport | Extend data model to support multi-hub operations |
| Simulated live updates | Connect to real BHS scanner event stream via WebSocket or SSE |
