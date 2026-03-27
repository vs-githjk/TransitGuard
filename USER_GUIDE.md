# BagTrack — User Guide

**Live app:** https://bagtracker-six.vercel.app

BagTrack is a proactive baggage risk dashboard for airport operations teams. It predicts which transfer bags are most likely to miss their connecting flight and helps staff act before it happens.

---

## Getting Started

Open the app at the link above. No login is required. The dashboard loads automatically with 200 simulated transfer bags, each scored for missed-connection risk.

---

## Pages

### 1. Dashboard (/)

The main operations view. Shows all transfer bags currently in the system.

**What you see in the table:**
- **Bag ID** — unique identifier, click to open the bag detail page
- **Inbound / Outbound** — flight numbers for the connecting journey
- **Arrival** — actual arrival time; orange "+Xm" means the flight was delayed
- **Departure** — scheduled outbound departure time
- **Layover** — total time between arrival and departure; highlighted orange if under 45 minutes
- **Status** — current location of the bag in the baggage handling system
- **Risk Score** — 0 to 100; higher means more likely to miss the connection
- **Risk Level** — Low / Medium / High based on the score
- **Top Reasons** — the two biggest factors driving the risk
- **Action** — what staff should do right now

**Controls:**
- **Search** — filter by bag ID, flight number, or passenger ID
- **Risk Level filter** — show only High, Medium, or Low risk bags
- **Sort** — sort by risk score, layover, delay, or departure time
- **↑↓ toggle** — switch between ascending and descending order
- **Export CSV** — download the current filtered view as a spreadsheet
- **Upload CSV** — replace the dataset with your own real baggage data
- **Template** — download a CSV template showing the exact column format required for upload
- **New Dataset** — regenerate a fresh set of 200 synthetic bags (useful for demos)

The dashboard **auto-refreshes every 8 seconds** — bag statuses update automatically without needing to reload the page.

---

### 2. Bag Detail (/bags/[bag-id])

Click any Bag ID in the dashboard to open the full detail view.

**What you see:**
- **Risk gauge** — large visual score with colour coding (red/yellow/green)
- **Risk reasons** — plain-English explanation of what is driving the risk
- **Recommended action** — specific instruction for baggage staff
- **Key flags** — quick yes/no indicators for terminal change, gate change, late check-in, customs re-check, and security re-check
- **Flight details** — inbound and outbound flight info, terminals, gates, delay, layover, and processing buffer time
- **BHS congestion and route disruption scores** — system-level risk factors
- **Journey timeline** — step-by-step history of the bag's progress from check-in to outbound loading, sorted chronologically. Completed steps show a green tick, in-progress steps pulse blue, pending steps are grey.

**Trigger Intervention button:**
- Logs a staff intervention for this bag
- Simulates the risk score dropping (representing expedited handling)
- Changes the bag status to "Manual Handling"
- Can only be triggered once per bag — the button locks after use

The detail page **auto-refreshes every 10 seconds** so the timeline stays current.

---

### 3. Analytics (/analytics)

Summary view for supervisors and operational managers.

**Metrics shown:**
- Total bags, high-risk count, average risk score
- Predicted missed bags (score ≥ 65)
- Actual missed bags from the ground-truth label in the data

**Charts:**
- **Risk Score Distribution** — bar chart showing how many bags fall into each 10-point score bracket, colour-coded by risk level
- **Risk Level Breakdown** — pie chart showing proportion of High / Medium / Low bags

**Feature Importance:**
- Horizontal bar chart ranking which input factors most influenced the model's predictions
- Helps supervisors understand what is driving risk across the current set of bags

---

### 4. Passenger Notification (/passenger)

A mock view of how a passenger would be informed about their bag's status.

**How to use:**
- Click one of the three suggested passenger IDs (pulled from the highest-risk bags in the current dataset) or type any passenger ID from the dashboard
- The page shows a colour-coded notification card:
  - **Green — Bag On Track:** no issues, bag is moving normally
  - **Yellow — Being Monitored:** moderate risk, staff are watching it
  - **Red — Intervention In Progress:** high risk, staff have been alerted

In a real deployment this notification would be sent via airline app push notification, SMS, or airport display screen.

---

## Risk Levels Explained

| Level | Score Range | What it means |
|-------|-------------|---------------|
| Low | 0 – 34 | Bag is very likely to make the connection |
| Medium | 35 – 64 | Some risk factors present, worth monitoring |
| High | 65 – 100 | Strong likelihood of missed connection — act now |

---

## Bag Statuses

| Status | Meaning |
|--------|---------|
| Checked In | Bag tagged at origin check-in |
| Loaded Inbound | Bag loaded onto the inbound flight |
| Arrived at Carousel | Bag offloaded, moving to transfer belt |
| In Transfer System | Bag in the baggage handling system |
| Sorted | Bag sorted and routed to outbound gate |
| Loaded Outbound | Bag loaded onto the outbound flight |
| On Hold | Bag flagged and waiting |
| Manual Handling | Staff intervention in progress |

---

## Uploading Real Data

To replace the synthetic data with real baggage records:

1. Click **Template** to download the required CSV format
2. Fill in your data using the same column headers
3. Click **Upload CSV** and select your file
4. The dashboard reloads automatically with your data scored

If your CSV includes a `missed_connection_label` column (historical data where outcomes are known), the model will retrain itself on your data. If not, it uses the pre-trained model for scoring.
