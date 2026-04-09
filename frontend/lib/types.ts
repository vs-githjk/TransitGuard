export type RiskLevel = "Low" | "Medium" | "High";
export type InterventionStatus = "none" | "pending" | "in_progress" | "resolved";

export interface RiskFactor {
  label: string;
  feature: string;
  score: number;
}

export interface Bag {
  bag_id: string;
  passenger_id: string;
  inbound_flight: string;
  outbound_flight: string;
  airport: string;
  inbound_terminal: string;
  outbound_terminal: string;
  inbound_gate: string;
  outbound_gate: string;
  scheduled_arrival: string;
  actual_arrival: string;
  scheduled_departure: string;
  layover_minutes: number;
  arrival_delay_minutes: number;
  terminal_change: boolean;
  gate_change: boolean;
  late_checkin_flag: boolean;
  time_bag_received: string;
  time_bag_sorted: string;
  customs_recheck_required: boolean;
  security_recheck_required: boolean;
  historical_route_disruption_score: number;
  baggage_system_congestion_score: number;
  processing_buffer_minutes: number;
  time_to_departure: number;
  current_status: string;
  missed_connection_label: boolean;
  risk_score: number;
  risk_level: RiskLevel;
  risk_reasons: string[];
  recommended_action: string;
  risk_factors?: RiskFactor[];
  confidence_score?: number;
  confidence_flags?: string[];
  intervention_status?: InterventionStatus;
  intervention_done?: boolean;
  timeline?: TimelineEvent[];
}

export interface TimelineEvent {
  event: string;
  time: string;
  status: "completed" | "in_progress" | "pending";
}

export interface Analytics {
  total_bags: number;
  high_risk: number;
  medium_risk: number;
  low_risk: number;
  average_risk_score: number;
  predicted_missed_bags: number;
  actual_missed_bags: number;
  risk_distribution: { range: string; count: number }[];
  feature_importances: { feature: string; importance: number }[];
}

export interface PassengerStatus {
  passenger_id: string;
  bag_id: string;
  outbound_flight: string;
  scheduled_departure: string;
  notification_status: "on_track" | "monitored" | "at_risk";
  message: string;
  risk_score: number;
  risk_level: RiskLevel;
}
