"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, CheckCircle, Clock, Zap, ShieldAlert, ShieldCheck, Shield } from "lucide-react";
import { fetchBag, triggerIntervention, updateInterventionStatus } from "@/lib/api";
import { Bag, InterventionStatus } from "@/lib/types";
import { formatDateTime, statusColor, statusLabel } from "@/lib/utils";
import RiskBadge from "@/components/RiskBadge";

export default function BagDetailPage({ params }: PageProps<"/bags/[bagId]">) {
  const [bagId, setBagId] = useState<string | null>(null);
  const [bag, setBag] = useState<Bag | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  useEffect(() => {
    params.then(({ bagId: id }) => setBagId(id));
  }, [params]);

  useEffect(() => {
    if (!bagId) return;
    setLoading(true);
    fetchBag(bagId)
      .then(setBag)
      .catch(() => setBag(null))
      .finally(() => setLoading(false));

    const interval = setInterval(() => {
      fetchBag(bagId).then(setBag).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, [bagId]);

  const handleIntervene = async () => {
    if (!bag) return;
    setActionLoading(true);
    try {
      const res = await triggerIntervention(bag.bag_id) as { old_risk_score: number; new_risk_score: number };
      setActionMsg(`Risk reduced from ${res.old_risk_score.toFixed(0)} → ${res.new_risk_score.toFixed(0)}`);
      const updated = await fetchBag(bag.bag_id);
      setBag(updated);
    } finally {
      setActionLoading(false);
    }
  };

  const handleWorkflow = async (newStatus: InterventionStatus) => {
    if (!bag) return;
    setActionLoading(true);
    try {
      await updateInterventionStatus(bag.bag_id, newStatus);
      const updated = await fetchBag(bag.bag_id);
      setBag(updated);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (!bag) {
    return (
      <div className="p-6">
        <Link href="/" className="text-blue-600 hover:underline text-sm flex items-center gap-1 dark:text-blue-400">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
        </Link>
        <div className="mt-8 text-center text-slate-400 dark:text-slate-500">Bag not found.</div>
      </div>
    );
  }

  const intStatus = bag.intervention_status ?? "none";
  const maxFactor = Math.max(...(bag.risk_factors ?? []).map(f => f.score), 1);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Back */}
      <Link href="/" className="text-blue-600 hover:underline text-sm flex items-center gap-1 w-fit dark:text-blue-400">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white font-mono">{bag.bag_id}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Passenger: <span className="text-slate-700 dark:text-slate-300 font-mono">{bag.passenger_id}</span>
            {" · "}
            Airport: <span className="text-slate-700 dark:text-slate-300">{bag.airport}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <RiskBadge level={bag.risk_level} />
          {/* Intervention workflow */}
          {intStatus === "none" && (
            <button
              onClick={() => handleWorkflow("pending")}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-yellow-500 hover:bg-yellow-400 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              Flag for Intervention
            </button>
          )}
          {intStatus === "pending" && (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-yellow-100 border border-yellow-300 text-yellow-700 rounded-lg dark:bg-yellow-950 dark:border-yellow-700 dark:text-yellow-400">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" /> Pending
              </span>
              <button
                onClick={handleIntervene}
                disabled={actionLoading}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                <Zap className="w-3.5 h-3.5" />
                {actionLoading ? "Starting..." : "Start Handling"}
              </button>
            </div>
          )}
          {intStatus === "in_progress" && (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-100 border border-blue-300 text-blue-700 rounded-lg dark:bg-blue-950 dark:border-blue-700 dark:text-blue-400">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" /> In Progress
              </span>
              <button
                onClick={() => handleWorkflow("resolved")}
                disabled={actionLoading}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {actionLoading ? "Resolving..." : "Mark Resolved"}
              </button>
            </div>
          )}
          {intStatus === "resolved" && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-100 border border-emerald-300 text-emerald-700 rounded-lg dark:bg-emerald-950 dark:border-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5" /> Resolved
            </span>
          )}
        </div>
      </div>

      {actionMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-300">
          Intervention logged — {actionMsg}
        </div>
      )}

      {/* Risk Score + Factor Breakdown */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 dark:bg-slate-900 dark:border-slate-800">
          <h2 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-4">Risk Assessment</h2>
          <div className="flex items-end gap-3 mb-4">
            <div className="text-5xl font-bold" style={{ color: bag.risk_level === "High" ? "#ef4444" : bag.risk_level === "Medium" ? "#f59e0b" : "#10b981" }}>
              {bag.risk_score.toFixed(0)}
            </div>
            <div className="pb-1">
              <div className="text-slate-400 dark:text-slate-500 text-sm">/ 100</div>
              <RiskBadge level={bag.risk_level} />
            </div>
          </div>
          <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mb-5">
            <div
              className={`h-full rounded-full transition-all ${bag.risk_level === "High" ? "bg-red-500" : bag.risk_level === "Medium" ? "bg-yellow-500" : "bg-emerald-500"}`}
              style={{ width: `${bag.risk_score}%` }}
            />
          </div>

          {/* Per-factor breakdown */}
          {(bag.risk_factors ?? []).length > 0 && (
            <div className="space-y-2.5">
              <div className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Score breakdown</div>
              {(bag.risk_factors ?? []).map((f, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-300 truncate max-w-[200px]">{f.label}</span>
                    <span className="font-mono text-slate-500 dark:text-slate-400 shrink-0 ml-2">{f.score.toFixed(1)} pts</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${bag.risk_level === "High" ? "bg-red-400" : bag.risk_level === "Medium" ? "bg-yellow-400" : "bg-emerald-400"}`}
                      style={{ width: `${(f.score / maxFactor) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {/* Recommended action */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 dark:bg-slate-900 dark:border-slate-800">
            <h2 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-3">Recommended Action</h2>
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-sm leading-relaxed dark:bg-blue-950 dark:border-blue-800 dark:text-blue-200">
              {bag.recommended_action}
            </div>
          </div>

          {/* Data Confidence */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 dark:bg-slate-900 dark:border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Data Confidence</h2>
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${(bag.confidence_score ?? 100) >= 80 ? "bg-emerald-500" : (bag.confidence_score ?? 100) >= 50 ? "bg-yellow-500" : "bg-red-500"}`} />
                <span className={`text-sm font-bold ${(bag.confidence_score ?? 100) >= 80 ? "text-emerald-600 dark:text-emerald-400" : (bag.confidence_score ?? 100) >= 50 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`}>
                  {bag.confidence_score ?? 100}%
                </span>
              </div>
            </div>
            <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mb-3">
              <div
                className={`h-full rounded-full ${(bag.confidence_score ?? 100) >= 80 ? "bg-emerald-500" : (bag.confidence_score ?? 100) >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
                style={{ width: `${bag.confidence_score ?? 100}%` }}
              />
            </div>
            {(bag.confidence_flags ?? []).length > 0 ? (
              <div className="space-y-1">
                {(bag.confidence_flags ?? []).map((flag, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs text-yellow-700 dark:text-yellow-400">
                    <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                    {flag}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle className="w-3 h-3" /> All data fields verified
              </div>
            )}
          </div>

          {/* Key Flags */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 dark:bg-slate-900 dark:border-slate-800">
            <h2 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-3">Key Flags</h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Terminal Change", value: bag.terminal_change },
                { label: "Gate Change", value: bag.gate_change },
                { label: "Late Check-in", value: bag.late_checkin_flag },
                { label: "Customs Re-check", value: bag.customs_recheck_required },
                { label: "Security Re-check", value: bag.security_recheck_required },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center gap-1.5 text-xs">
                  {value ? (
                    <AlertTriangle className="w-3 h-3 text-red-500 dark:text-red-400 shrink-0" />
                  ) : (
                    <CheckCircle className="w-3 h-3 text-emerald-500 dark:text-emerald-400 shrink-0" />
                  )}
                  <span className={value ? "text-red-600 dark:text-red-300" : "text-slate-400 dark:text-slate-500"}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Flight Details */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 dark:bg-slate-900 dark:border-slate-800">
        <h2 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-4">Flight Details</h2>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">Inbound Flight</div>
            <div className="text-lg font-bold text-slate-900 dark:text-white font-mono">{bag.inbound_flight}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Terminal {bag.inbound_terminal} · Gate {bag.inbound_gate}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Scheduled: {formatDateTime(bag.scheduled_arrival)}</div>
            <div className="text-xs mt-0.5">
              Actual: <span className={bag.arrival_delay_minutes > 15 ? "text-orange-500 dark:text-orange-400" : "text-slate-500 dark:text-slate-400"}>
                {formatDateTime(bag.actual_arrival)}
              </span>
              {bag.arrival_delay_minutes > 0 && (
                <span className="ml-1 text-orange-500 dark:text-orange-400">+{bag.arrival_delay_minutes}m late</span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-center justify-center">
            <div className="text-xs text-slate-400 dark:text-slate-500 mb-2">Layover</div>
            <div className={`text-2xl font-bold ${bag.layover_minutes < 45 ? "text-orange-500 dark:text-orange-400" : "text-slate-700 dark:text-slate-200"}`}>
              {bag.layover_minutes}m
            </div>
            <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">Processing buffer: {bag.processing_buffer_minutes}m</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">Outbound Flight</div>
            <div className="text-lg font-bold text-slate-900 dark:text-white font-mono">{bag.outbound_flight}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Terminal {bag.outbound_terminal} · Gate {bag.outbound_gate}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Departure: {formatDateTime(bag.scheduled_departure)}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
          {[
            { label: "BHS Congestion", value: `${(bag.baggage_system_congestion_score * 100).toFixed(0)}%` },
            { label: "Route Disruption History", value: `${(bag.historical_route_disruption_score * 100).toFixed(0)}%` },
            { label: "Current Status", value: <span className={`px-2 py-0.5 rounded text-xs ${statusColor(bag.current_status)}`}>{statusLabel(bag.current_status)}</span> },
          ].map(({ label, value }) => (
            <div key={label}>
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">{label}</div>
              <div className="text-sm text-slate-700 dark:text-slate-200">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      {bag.timeline && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 dark:bg-slate-900 dark:border-slate-800">
          <h2 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-4">Bag Journey Timeline</h2>
          <div className="space-y-3">
            {bag.timeline.map((event, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="mt-1 shrink-0">
                  {event.status === "completed" ? (
                    <CheckCircle className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                  ) : event.status === "in_progress" ? (
                    <Clock className="w-4 h-4 text-blue-500 dark:text-blue-400 animate-pulse" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-slate-300 dark:border-slate-600" />
                  )}
                </div>
                <div className="flex-1">
                  <div className={`text-sm font-medium ${event.status === "pending" ? "text-slate-400 dark:text-slate-500" : "text-slate-800 dark:text-slate-200"}`}>
                    {event.event}
                  </div>
                  <div className="text-xs text-slate-400 dark:text-slate-600 mt-0.5">{formatDateTime(event.time)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
