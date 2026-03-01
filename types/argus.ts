/* ------------------------------------------------------------------ */
/*  A.R.G.U.S. — Type definitions                                     */
/* ------------------------------------------------------------------ */

export type TableState = "EMPTY" | "JUST_SEATED" | "MID_MEAL" | "FINISHING" | "CHECK_STAGE";

export type Vibe = "happy" | "neutral" | "stressed" | "angry" | "about_to_leave" | "unknown";

export type Phase =
  | "empty" | "seated" | "ordering" | "waiting" | "eating"
  | "finishing" | "dessert" | "wants_check" | "paying" | "left"
  | "error" | "unknown";

export type Urgency = "none" | "medium" | "high" | "critical" | "unknown";

export type WaitingUrgency = "calm" | "moderate" | "urgent" | "leaving";

/* ------------------------------------------------------------------ */
/*  Table                                                              */
/* ------------------------------------------------------------------ */

export interface TableStatus {
  table_id: string;
  location_id: string;
  state: TableState;
  vibe: Vibe;
  phase: Phase;
  party_size: number;
  confidence: number;
  visual_cues: string[];
  stress_avg: number;
  engagement_avg: number;
  predicted_turn_minutes: number | null;
  predicted_turn_low: number | null;
  predicted_turn_high: number | null;
  prediction_confidence: number;
  prediction_reasoning: string;
  urgency: Urgency;
  alerts: string[];
  action_needed: string | null;
  summary: string;
  inference_latency_ms: number;
  total_latency_ms: number;
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  Waiting List (Presage)                                             */
/* ------------------------------------------------------------------ */

export interface WaitingParty {
  party_id: string;
  party_name: string;
  party_size: number;
  wait_start: number;
  wait_minutes: number;
  preferred_seating: string;
  urgency_score: number;
  urgency_level: WaitingUrgency;
  best_table_match: string | null;
  notes: string;
  readings: PresageReading[];
}

export interface PresageReading {
  heart_rate: number;
  breathing_rate: number;
  engagement: number;
  frustration: number;
  movement_intensity: number;
  exit_directed: boolean;
  facial_patience: number;
}

/* ------------------------------------------------------------------ */
/*  Host Recommendation                                                */
/* ------------------------------------------------------------------ */

export interface HostRecommendation {
  primary_action: string;
  secondary_actions: string[];
  urgency: "low" | "medium" | "high" | "critical";
  reasoning: string;
  location_id?: string;
  latency_ms?: number;
}

/* ------------------------------------------------------------------ */
/*  Anomaly                                                            */
/* ------------------------------------------------------------------ */

export interface Anomaly {
  table_id: string;
  severity: "medium" | "high" | "critical";
  reason: string;
  suggested_action: string;
}

/* ------------------------------------------------------------------ */
/*  Location & Floor                                                   */
/* ------------------------------------------------------------------ */

export interface LocationResult {
  location_id: string;
  tables: TableStatus[];
  table_count: number;
  alert_count: number;
  anomalies?: Anomaly[];
  waiting_list?: WaitingParty[];
  recommendation?: HostRecommendation;
  shift_context?: string;
  latency_ms: number;
  error?: string;
}

export interface AnalysisStats {
  locations_analyzed: number;
  tables_analyzed: number;
  total_alerts: number;
  modal_invocations: number;
  total_latency_ms: number;
  parallel_latency_ms: number;
  sequential_estimate_ms: number;
  waiting_parties?: number;
  timestamp: string;
}

export interface FloorAnalysis {
  locations: LocationResult[];
  waiting_list?: WaitingParty[];
  recommendations?: HostRecommendation[];
  stats: AnalysisStats;
}

export interface BootResult {
  total_sessions: number;
  sessions_processed: number;
  chunks_completed: number;
  processing_time_ms: number;
}

/* ------------------------------------------------------------------ */
/*  Locations                                                          */
/* ------------------------------------------------------------------ */

export interface Location {
  id: string;
  name: string;
  tables: number;
}

export const LOCATIONS: Location[] = [
  { id: "downtown", name: "Maison Lumière", tables: 20 },
  { id: "midtown", name: "Midtown Bistro", tables: 20 },
  { id: "waterfront", name: "Waterfront Grill", tables: 20 },
  { id: "airport", name: "Airport Terminal 3", tables: 20 },
  { id: "suburban", name: "Suburban Family", tables: 20 },
];
