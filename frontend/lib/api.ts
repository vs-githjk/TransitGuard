import { Analytics, Bag, PassengerStatus } from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

async function post<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { method: "POST", cache: "no-store" });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export async function fetchBags(params?: {
  risk_level?: string;
  search?: string;
  sort_by?: string;
  sort_dir?: string;
}): Promise<{ total: number; bags: Bag[] }> {
  const q = new URLSearchParams();
  if (params?.risk_level) q.set("risk_level", params.risk_level);
  if (params?.search) q.set("search", params.search);
  if (params?.sort_by) q.set("sort_by", params.sort_by);
  if (params?.sort_dir) q.set("sort_dir", params.sort_dir);
  const qs = q.toString() ? `?${q.toString()}` : "";
  return get(`/bags${qs}`);
}

export async function fetchBag(bagId: string): Promise<Bag> {
  return get(`/bags/${bagId}`);
}

export async function fetchAnalytics(): Promise<Analytics> {
  return get("/analytics");
}

export async function fetchPassengerStatus(passengerId: string): Promise<PassengerStatus> {
  return get(`/passenger/${passengerId}`);
}

export async function triggerIntervention(bagId: string) {
  return post(`/bags/${bagId}/intervene`);
}

export async function updateInterventionStatus(bagId: string, status: string) {
  const res = await fetch(`${BASE_URL}/bags/${bagId}/intervention-status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function refreshData() {
  return post("/refresh");
}

export async function fetchLiveUpdates() {
  return get<{ updates: Partial<Bag>[] }>("/live-updates");
}
