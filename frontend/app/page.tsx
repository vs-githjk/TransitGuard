"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { Search, RefreshCw, Download, Upload, AlertTriangle, CheckCircle, Clock, ChevronDown } from "lucide-react";
import { fetchBags, refreshData } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
import { Bag } from "@/lib/types";
import { formatTime } from "@/lib/utils";
import RiskBadge from "@/components/RiskBadge";
import RiskScoreBar from "@/components/RiskScoreBar";
import StatusChip from "@/components/StatusChip";

const SORT_FIELDS = [
  { value: "risk_score", label: "Risk Score" },
  { value: "layover_minutes", label: "Layover" },
  { value: "arrival_delay_minutes", label: "Delay" },
  { value: "scheduled_departure", label: "Departure" },
];

export default function DashboardPage() {
  const [bags, setBags] = useState<Bag[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [sortBy, setSortBy] = useState("risk_score");
  const [sortDir, setSortDir] = useState("desc");
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  type Popover = { key: string; lines: string[]; x: number; y: number; anchor: "left" | "right" };
  const [popover, setPopover] = useState<Popover | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const openPopover = (e: React.MouseEvent, key: string, lines: string[]) => {
    e.stopPropagation();
    if (popover?.key === key) { setPopover(null); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const popoverWidth = 288;
    const spaceRight = window.innerWidth - rect.left;
    if (spaceRight < popoverWidth + 12) {
      setPopover({ key, lines, x: window.innerWidth - rect.right, y: rect.bottom + 6, anchor: "right" });
    } else {
      setPopover({ key, lines, x: rect.left, y: rect.bottom + 6, anchor: "left" });
    }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBags({
        search: search || undefined,
        risk_level: riskFilter || undefined,
        sort_by: sortBy,
        sort_dir: sortDir,
      });
      setBags(data.bags);
      setTotal(data.total);
    } catch {
      setError("Failed to load bags. Is the backend running on port 8000?");
    } finally {
      setLoading(false);
    }
  }, [search, riskFilter, sortBy, sortDir]);

  useEffect(() => {
    load();
  }, [load]);

  // Live update every 8 seconds
  useEffect(() => {
    const interval = setInterval(() => load(), 8000);
    return () => clearInterval(interval);
  }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshData();
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Upload failed");
      setUploadMsg(`✓ ${data.rows_loaded} bags loaded. ${data.message}`);
      await load();
    } catch (err: unknown) {
      setUploadMsg(`✗ ${err instanceof Error ? err.message : "Upload failed"}`);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const downloadCSV = () => {
    if (!bags.length) return;
    const cols = Object.keys(bags[0]) as (keyof Bag)[];
    const rows = bags.map((b) => cols.map((c) => JSON.stringify(b[c] ?? "")).join(","));
    const csv = [cols.join(","), ...rows].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "transitguard_export.csv";
    a.click();
  };

  const high = bags.filter((b) => b.risk_level === "High").length;
  const med = bags.filter((b) => b.risk_level === "Medium").length;
  const low = bags.filter((b) => b.risk_level === "Low").length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Transfer Bag Monitor</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Live risk assessment for connecting bags</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={downloadCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white hover:bg-slate-50 text-slate-600 rounded-lg border border-slate-200 transition-colors dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:border-slate-700"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <label className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors cursor-pointer ${uploading ? "bg-slate-100 text-slate-400 border-slate-200 dark:bg-slate-700 dark:text-slate-500 dark:border-slate-700" : "bg-white hover:bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:border-slate-700"}`}>
            <Upload className="w-3.5 h-3.5" />
            {uploading ? "Uploading..." : "Upload CSV"}
            <input type="file" accept=".csv" className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
          <a
            href={`${API_BASE}/upload/template`}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white hover:bg-slate-50 text-slate-600 rounded-lg border border-slate-200 transition-colors dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:border-slate-700"
          >
            Template
          </a>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Regenerating..." : "New Dataset"}
          </button>
        </div>
      </div>

      {uploadMsg && (
        <div className={`px-4 py-2.5 rounded-lg text-sm border ${uploadMsg.startsWith("✓") ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-300" : "bg-red-50 border-red-200 text-red-700 dark:bg-red-950 dark:border-red-800 dark:text-red-300"}`}>
          {uploadMsg}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Bags", value: total, icon: Clock, colorClass: "text-slate-500 dark:text-slate-400", bgClass: "bg-white border-slate-200 shadow-sm dark:bg-slate-800 dark:border-slate-700 dark:shadow-none" },
          { label: "High Risk", value: high, icon: AlertTriangle, colorClass: "text-red-500 dark:text-red-400", bgClass: "bg-red-50 border-red-200 shadow-sm dark:bg-red-950/50 dark:border-red-900 dark:shadow-none" },
          { label: "Medium Risk", value: med, icon: AlertTriangle, colorClass: "text-yellow-500 dark:text-yellow-400", bgClass: "bg-yellow-50 border-yellow-200 shadow-sm dark:bg-yellow-950/50 dark:border-yellow-900 dark:shadow-none" },
          { label: "Low Risk", value: low, icon: CheckCircle, colorClass: "text-emerald-500 dark:text-emerald-400", bgClass: "bg-emerald-50 border-emerald-200 shadow-sm dark:bg-emerald-950/50 dark:border-emerald-900 dark:shadow-none" },
        ].map(({ label, value, icon: Icon, colorClass, bgClass }) => (
          <div key={label} className={`rounded-xl border p-4 ${bgClass}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">{label}</span>
              <Icon className={`w-4 h-4 ${colorClass}`} />
            </div>
            <div className={`text-3xl font-bold mt-2 ${colorClass}`}>{loading ? "—" : value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search bag ID, flight, passenger..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 dark:placeholder-slate-500"
          />
        </div>
        <select
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value)}
          className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
        >
          <option value="">All Risk Levels</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
        >
          {SORT_FIELDS.map((f) => (
            <option key={f.value} value={f.value}>{`Sort: ${f.label}`}</option>
          ))}
        </select>
        <button
          onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {sortDir === "desc" ? "↓ Desc" : "↑ Asc"}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm dark:bg-red-950 dark:border-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm dark:shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                {["Bag ID","Inbound","Outbound","Arrival","Departure","Layover","Status","Risk Score","Risk Level","Top Reasons","Action"].map((h) => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-100 dark:border-slate-800/50">
                    {Array.from({ length: 11 }).map((_, j) => (
                      <td key={j} className="px-3 py-3">
                        <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : bags.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-12 text-center text-slate-400 dark:text-slate-500">No bags found</td>
                </tr>
              ) : (
                bags.map((bag) => (
                  <tr key={bag.bag_id} className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="px-3 py-3 font-mono text-xs">
                      <Link href={`/bags/${bag.bag_id}`} className="text-blue-600 hover:text-blue-500 hover:underline dark:text-blue-400 dark:hover:text-blue-300">
                        {bag.bag_id}
                      </Link>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">{bag.inbound_flight}</td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">{bag.outbound_flight}</td>
                    <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatTime(bag.actual_arrival)}
                      {bag.arrival_delay_minutes > 10 && (
                        <span className="ml-1 text-orange-500 dark:text-orange-400">+{bag.arrival_delay_minutes}m</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatTime(bag.scheduled_departure)}</td>
                    <td className="px-3 py-3 text-xs">
                      <span className={bag.layover_minutes < 45 ? "text-orange-500 dark:text-orange-400 font-semibold" : "text-slate-600 dark:text-slate-300"}>
                        {bag.layover_minutes}m
                      </span>
                    </td>
                    <td className="px-3 py-3"><StatusChip status={bag.current_status} /></td>
                    <td className="px-3 py-3"><RiskScoreBar score={bag.risk_score} /></td>
                    <td className="px-3 py-3"><RiskBadge level={bag.risk_level} /></td>
                    <td className="px-3 py-3">
                      {(bag.risk_reasons || []).length > 0 ? (
                        <button
                          onClick={(e) => openPopover(e, `${bag.bag_id}-reasons`, bag.risk_reasons || [])}
                          className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${popover?.key === `${bag.bag_id}-reasons` ? "bg-slate-200 border-slate-400 text-slate-800 dark:bg-slate-700 dark:border-slate-500 dark:text-slate-200" : "bg-slate-100 border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-300"}`}
                        >
                          <span className="truncate max-w-32">{(bag.risk_reasons || [])[0]}</span>
                          {(bag.risk_reasons || []).length > 1 && <span className="shrink-0 text-slate-400 dark:text-slate-500">+{(bag.risk_reasons || []).length - 1}</span>}
                          <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${popover?.key === `${bag.bag_id}-reasons` ? "rotate-180" : ""}`} />
                        </button>
                      ) : (
                        <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {bag.recommended_action ? (
                        <button
                          onClick={(e) => openPopover(e, `${bag.bag_id}-action`, [bag.recommended_action])}
                          className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${popover?.key === `${bag.bag_id}-action` ? "bg-slate-200 border-slate-400 text-slate-800 dark:bg-slate-700 dark:border-slate-500 dark:text-slate-200" : "bg-slate-100 border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-300"}`}
                        >
                          <span className="truncate max-w-32">{bag.recommended_action}</span>
                          <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${popover?.key === `${bag.bag_id}-action` ? "rotate-180" : ""}`} />
                        </button>
                      ) : (
                        <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-600">
        Showing {bags.length} of {total} bags · Auto-refreshes every 8 seconds
      </p>

      {popover && (
        <div
          ref={popoverRef}
          style={{ position: "fixed", top: popover.y, ...(popover.anchor === "right" ? { right: popover.x } : { left: popover.x }), zIndex: 50 }}
          className="bg-white border border-slate-200 rounded-lg shadow-xl p-3 max-w-xs w-max dark:bg-slate-800 dark:border-slate-600"
        >
          <ul className="space-y-1.5">
            {popover.lines.map((line, i) => (
              <li key={i} className="flex gap-2 text-xs text-slate-700 dark:text-slate-200 leading-snug">
                <span className="text-slate-400 dark:text-slate-500 shrink-0">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
