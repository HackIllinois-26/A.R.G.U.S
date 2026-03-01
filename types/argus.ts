export type Vibe = "happy" | "neutral" | "stressed" | "angry" | "about_to_leave" | "unknown";

export type Phase =
  | "empty" | "seated" | "ordering" | "waiting" | "eating"
  | "dessert" | "wants_check" | "paying" | "left"
  | "error" | "unknown";

export type Urgency = "none" | "medium" | "high" | "critical" | "unknown";

export interface TableStatus {
  table_id: string;
  location_id: string;
  vibe: Vibe;
  phase: Phase;
  stress_avg: number;
  engagement_avg: number;
  predicted_turn_minutes: number | null;
  prediction_confidence: number;
  urgency: Urgency;
  alerts: string[];
  action_needed: string | null;
  summary: string;
  inference_latency_ms: number;
  total_latency_ms: number;
  error?: string;
}

export interface LocationResult {
  location_id: string;
  tables: TableStatus[];
  table_count: number;
  alert_count: number;
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
  timestamp: string;
}

export interface FloorAnalysis {
  locations: LocationResult[];
  stats: AnalysisStats;
}

export interface BootResult {
  total_sessions: number;
  sessions_processed: number;
  chunks_completed: number;
  processing_time_ms: number;
}

export interface Location {
  id: string;
  name: string;
  tables: number;
}

export const LOCATIONS: Location[] = [
  { id: "downtown", name: "Downtown Flagship", tables: 20 },
  { id: "midtown", name: "Midtown Bistro", tables: 20 },
  { id: "waterfront", name: "Waterfront Grill", tables: 20 },
  { id: "airport", name: "Airport Terminal 3", tables: 20 },
  { id: "suburban", name: "Suburban Family", tables: 20 },
];
