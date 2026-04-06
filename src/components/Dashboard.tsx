"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { HostRecommendation } from "./HostRecommendation";
import { WaitingList } from "./WaitingList";
import { CircularGauge } from "./CircularGauge";
import type {
  AnalysisStats, FloorAnalysis,
  LocationResult, TableStatus, Location,
  WaitingParty, HostRecommendation as HostRec,
  TableState, Vibe, Urgency, WaitingUrgency,
} from "../../types/argus";
import { LOCATIONS } from "../../types/argus";

const API_BASE = process.env.NEXT_PUBLIC_ARGUS_API ?? "https://girishskandhas--argus";
const EP = {
  rush: `${API_BASE}-api-rush-hour.modal.run`,
  recommend: `${API_BASE}-api-recommend.modal.run`,
};
const RUSH_MS = 30_000;
const REFRESH_MS = 60_000;

const TABLE_STATES: TableState[] = ["EMPTY", "JUST_SEATED", "MID_MEAL", "FINISHING", "CHECK_STAGE"];

function mockTable(id: string, loc: string): TableStatus {
  const state = TABLE_STATES[Math.floor(Math.random() * TABLE_STATES.length)];
  const vibes: Vibe[] = ["happy", "neutral", "stressed", "angry", "about_to_leave"];
  const s = Math.random();
  const isEmpty = state === "EMPTY";
  const low = isEmpty ? 0 : Math.floor(Math.random() * 20) + 3;
  const high = low + Math.floor(Math.random() * 10) + 2;
  return {
    table_id: id, location_id: loc, state,
    vibe: isEmpty ? "neutral" : vibes[Math.floor(Math.random() * vibes.length)],
    phase: isEmpty ? "empty" : "eating",
    party_size: isEmpty ? 0 : Math.floor(Math.random() * 5) + 2,
    confidence: 0.7 + Math.random() * 0.3, visual_cues: [],
    stress_avg: isEmpty ? 0 : s, engagement_avg: isEmpty ? 0 : 1 - s * 0.8,
    predicted_turn_minutes: isEmpty ? null : Math.floor((low + high) / 2),
    predicted_turn_low: isEmpty ? null : low, predicted_turn_high: isEmpty ? null : high,
    prediction_confidence: 0.65, prediction_reasoning: "",
    urgency: (s > 0.8 ? "high" : s > 0.6 ? "medium" : "none") as Urgency,
    alerts: s > 0.8 ? ["Elevated stress detected"] : [],
    action_needed: s > 0.7 ? "Check on table" : null,
    summary: `Table ${id}: ${state}`, inference_latency_ms: 0, total_latency_ms: 0,
  };
}

function mockLoc(l: Location): LocationResult {
  const t = Array.from({ length: l.tables }, (_, i) => mockTable(String(i + 1), l.id));
  return { location_id: l.id, tables: t, table_count: l.tables, alert_count: t.filter(x => x.alerts.length > 0).length, latency_ms: 0 };
}

function mockWaitingList(): WaitingParty[] {
  const names = ["James", "Maria", "Chen", "Aisha", "Raj", "Sofia", "Marcus"];
  const prefs = ["any", "booth", "patio", "window"];
  const now = Date.now() / 1000;
  return names.slice(0, 4 + Math.floor(Math.random() * 3)).map((name, i) => {
    const waitMin = Math.floor(Math.random() * 20) + 2;
    const score = Math.min(10, 1 + waitMin * 0.4 + Math.random() * 2);
    const level = score >= 8 ? "leaving" : score >= 6 ? "urgent" : score >= 3.5 ? "moderate" : "calm";
    const hr = 72 + Math.floor(score * 3);
    const eng = Math.max(0.05, 1 - score * 0.1);
    return {
      party_id: `wait-${i + 1}`, party_name: name, party_size: Math.floor(Math.random() * 4) + 2,
      wait_start: now - waitMin * 60, wait_minutes: waitMin,
      preferred_seating: prefs[Math.floor(Math.random() * prefs.length)],
      urgency_score: Math.round(score * 10) / 10, urgency_level: level as WaitingUrgency,
      best_table_match: null, notes: "",
      readings: Array.from({ length: Math.floor(Math.random() * 3) + 2 }, () => ({
        heart_rate: hr + Math.floor(Math.random() * 10) - 5, breathing_rate: 15 + Math.floor(Math.random() * 4),
        engagement: eng + Math.random() * 0.1 - 0.05, frustration: Math.min(1, score * 0.1),
        movement_intensity: Math.min(1, score * 0.08), exit_directed: level === "leaving" && Math.random() > 0.3,
        facial_patience: Math.max(0, 1 - score * 0.1),
      })),
    };
  }).sort((a, b) => b.urgency_score - a.urgency_score);
}

function mockRecommendation(): HostRec {
  const recs: HostRec[] = [
    { primary_action: "Quote 10 minutes for the party of 3. Table 3 freeing in ~8 min.", secondary_actions: ["Party of 2 near door showing moderate stress.", "Table 14 overdue in check stage."], urgency: "medium", reasoning: "Table 3 is in CHECK_STAGE. Party of 3 is best match." },
    { primary_action: "Seat party of 2 at bar immediately, exit behavior detected.", secondary_actions: ["Table 7 frees in ~16 min.", "Tables 5 and 12 simultaneously finishing."], urgency: "high", reasoning: "Presage detects exit-directed movement in longest-waiting party." },
    { primary_action: "All tables occupied. Manage expectations for 20+ min wait.", secondary_actions: ["Offer drinks at bar.", "Table 9 lingering at 85 min."], urgency: "low", reasoning: "Full capacity, no tables in CHECK_STAGE." },
  ];
  return recs[Math.floor(Math.random() * recs.length)];
}

interface OrderItem { name: string; delivered: boolean; orderedAgo: number; }
interface TableOrder { items: OrderItem[]; totalSpend: number; }

const MENU_ITEMS = [
  "Grilled Salmon", "Caesar Salad", "Margherita Pizza", "Wagyu Burger",
  "Truffle Pasta", "Lobster Bisque", "Chicken Parm", "Filet Mignon",
  "Tuna Tartare", "Mushroom Risotto", "French Onion Soup", "Lamb Chops",
  "Cobb Salad", "Shrimp Scampi", "NY Strip", "Pan-Seared Duck",
  "Caprese", "Fish Tacos", "Poke Bowl", "Tiramisu",
];

const PRICES: Record<string, number> = {
  "Grilled Salmon": 28, "Caesar Salad": 14, "Margherita Pizza": 18, "Wagyu Burger": 32,
  "Truffle Pasta": 26, "Lobster Bisque": 16, "Chicken Parm": 22, "Filet Mignon": 48,
  "Tuna Tartare": 19, "Mushroom Risotto": 24, "French Onion Soup": 12, "Lamb Chops": 38,
  "Cobb Salad": 16, "Shrimp Scampi": 27, "NY Strip": 44, "Pan-Seared Duck": 36,
  "Caprese": 13, "Fish Tacos": 17, "Poke Bowl": 20, "Tiramisu": 14,
};

function generateOrder(table: TableStatus): TableOrder | null {
  if (table.state === "EMPTY") return null;
  const count = Math.min(table.party_size + Math.floor(Math.random() * 2), 6);
  const shuffled = [...MENU_ITEMS].sort(() => Math.random() - 0.5);
  const items: OrderItem[] = shuffled.slice(0, count).map((name) => {
    const isEating = table.state === "MID_MEAL" || table.state === "FINISHING" || table.state === "CHECK_STAGE";
    const justSeated = table.state === "JUST_SEATED";
    const delivered = isEating ? Math.random() > 0.15 : justSeated ? false : Math.random() > 0.5;
    const orderedAgo = justSeated ? Math.floor(Math.random() * 5) + 1 : Math.floor(Math.random() * 25) + 5;
    return { name, delivered, orderedAgo };
  });
  const totalSpend = items.reduce((sum, it) => sum + (PRICES[it.name] ?? 20), 0);
  return { items, totalSpend };
}

const STATE_DOT: Record<string, string> = {
  EMPTY: "bg-emerald-500", JUST_SEATED: "bg-sky-500", MID_MEAL: "bg-amber-500",
  FINISHING: "bg-orange-500", CHECK_STAGE: "bg-red-500",
};
const STATE_TEXT: Record<string, string> = {
  EMPTY: "text-emerald-400", JUST_SEATED: "text-sky-400", MID_MEAL: "text-amber-400",
  FINISHING: "text-orange-400", CHECK_STAGE: "text-red-400",
};
const STATE_LABEL: Record<string, string> = {
  EMPTY: "Empty", JUST_SEATED: "Seated", MID_MEAL: "Mid-Meal",
  FINISHING: "Finishing", CHECK_STAGE: "Check",
};

const TABLE_CAPACITY: Record<string, number> = {
  "1": 2, "2": 2, "3": 4, "4": 4, "5": 4, "6": 6, "7": 6, "8": 4,
  "9": 2, "10": 4, "11": 4, "12": 6, "13": 2, "14": 4, "15": 4,
  "16": 6, "17": 4, "18": 2, "19": 4, "20": 6,
};

function MiniTable({ table, index, selected, onSelect }: {
  table: TableStatus; index: number; selected: boolean; onSelect: () => void;
}) {
  const isEmpty = table.state === "EMPTY";
  const dot = STATE_DOT[table.state] ?? "bg-white/20";
  const text = STATE_TEXT[table.state] ?? "text-white/40";
  const label = STATE_LABEL[table.state] ?? table.state;
  const capacity = TABLE_CAPACITY[table.table_id] ?? 4;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.015 }}
      onClick={onSelect}
      className={`rounded-xl border transition-all duration-200 cursor-pointer backdrop-blur-sm ${
        selected
          ? "border-emerald-500/40 bg-emerald-500/[0.12] ring-1 ring-emerald-500/25"
          : isEmpty
          ? "border-white/[0.08] bg-black/50 hover:border-white/[0.15]"
          : table.urgency === "high" || table.urgency === "critical"
          ? "border-red-500/30 bg-red-950/60 hover:border-red-500/40"
          : "border-white/[0.08] bg-black/50 hover:border-white/[0.15]"
      }`}
    >
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">T{table.table_id}</span>
            <span className="text-xs text-white/30">{capacity}-seat</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
            <span className={`text-xs font-medium ${text}`}>{label}</span>
          </div>
        </div>

        {!isEmpty ? (
          <>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-white/50">{table.party_size} guests</span>
            </div>
            {(table.predicted_turn_minutes != null || (table.predicted_turn_low != null && table.predicted_turn_high != null)) && (
              <p className="text-xs font-medium text-emerald-400 mb-2">
                Free in ~{table.predicted_turn_minutes != null
                  ? `${table.predicted_turn_minutes}`
                  : `${table.predicted_turn_low}-${table.predicted_turn_high}`} min
              </p>
            )}
            <div className="flex gap-3">
              <div className="flex-1">
                <div className="flex items-center justify-between text-xs text-white/30 mb-0.5">
                  <span>Stress</span>
                  <span>{Math.round(table.stress_avg * 100)}%</span>
                </div>
                <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${table.stress_avg > 0.6 ? "bg-red-500" : "bg-white/20"}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${table.stress_avg * 100}%` }}
                    transition={{ duration: 0.5, delay: index * 0.02 }}
                  />
                </div>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between text-xs text-white/30 mb-0.5">
                  <span>Engage</span>
                  <span>{Math.round(table.engagement_avg * 100)}%</span>
                </div>
                <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-emerald-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${table.engagement_avg * 100}%` }}
                    transition={{ duration: 0.5, delay: index * 0.02 }}
                  />
                </div>
              </div>
            </div>
            {table.alerts.length > 0 && (
              <p className="text-xs text-red-400 mt-2 truncate">{table.alerts[0]}</p>
            )}
          </>
        ) : (
          <p className="text-xs text-white/20 text-center py-1">{capacity} seats open</p>
        )}
      </div>
    </motion.div>
  );
}

function TableDetail({ table, onClose }: { table: TableStatus; onClose: () => void }) {
  const isEmpty = table.state === "EMPTY";
  const dot = STATE_DOT[table.state] ?? "bg-white/20";
  const text = STATE_TEXT[table.state] ?? "text-white/40";
  const label = STATE_LABEL[table.state] ?? table.state;
  const capacity = TABLE_CAPACITY[table.table_id] ?? 4;
  const [order] = useState<TableOrder | null>(() => generateOrder(table));
  const [seatedMinutes] = useState(() => {
    if (isEmpty) return 0;
    const map: Record<string, [number, number]> = {
      JUST_SEATED: [2, 8], MID_MEAL: [15, 35], FINISHING: [30, 55], CHECK_STAGE: [40, 65],
    };
    const [lo, hi] = map[table.state] ?? [5, 20];
    return lo + Math.floor(Math.random() * (hi - lo));
  });
  const pendingItems = order?.items.filter((i) => !i.delivered) ?? [];
  const deliveredItems = order?.items.filter((i) => i.delivered) ?? [];
  const hasTurnPrediction = table.predicted_turn_minutes != null || (table.predicted_turn_low != null && table.predicted_turn_high != null);
  const freeInDisplay = table.predicted_turn_minutes != null
    ? String(table.predicted_turn_minutes)
    : table.predicted_turn_low != null && table.predicted_turn_high != null
      ? `${table.predicted_turn_low}-${table.predicted_turn_high}` : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2 }}
      className="rounded-xl border border-white/[0.10] bg-black/60 backdrop-blur-md p-5"
    >
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <span className="text-xl font-semibold text-white">Table {table.table_id}</span>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/[0.06]">
            <span className={`w-2 h-2 rounded-full ${dot}`} />
            <span className={`text-xs font-medium ${text}`}>{label}</span>
          </div>
        </div>
        <button onClick={onClose} className="text-white/30 hover:text-white transition-colors text-lg leading-none px-2 py-1 rounded-lg hover:bg-white/[0.06] cursor-pointer">
          &times;
        </button>
      </div>

      {isEmpty ? (
        <div className="text-center py-6">
          <p className="text-base text-white/40">{capacity} seats available</p>
          <p className="text-sm text-white/20 mt-1">No active orders</p>
        </div>
      ) : (
        <>
          {hasTurnPrediction && freeInDisplay != null && (
            <div className="rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20 p-4 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-emerald-400/60 mb-1">Predicted free in</p>
                  <p className="text-2xl font-semibold text-emerald-400">~{freeInDisplay}<span className="text-sm font-normal ml-1">min</span></p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-white/30 mb-1">At table for</p>
                  <p className="text-lg font-medium text-white/70">{seatedMinutes}<span className="text-sm font-normal ml-1">min</span></p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: "Guests", value: <>{table.party_size}<span className="text-sm text-white/30 font-normal">/{capacity}</span></>, color: "text-white" },
              { label: "Est. Turn", value: <>{freeInDisplay ?? "--"}<span className="text-sm text-white/30 font-normal ml-1">min</span></>, color: "text-white" },
              { label: "Tab", value: <>${order?.totalSpend ?? 0}</>, color: "text-emerald-400" },
            ].map((m) => (
              <div key={m.label} className="rounded-xl bg-black/40 border border-white/[0.10] p-3 text-center">
                <p className="text-xs text-white/40 mb-1">{m.label}</p>
                <p className={`text-lg font-semibold ${m.color}`}>{m.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 mb-5">
            {[
              { label: "Stress", value: table.stress_avg, color: table.stress_avg > 0.6 ? "bg-red-500" : "bg-white/20" },
              { label: "Engagement", value: table.engagement_avg, color: "bg-emerald-500" },
            ].map((m) => (
              <div key={m.label}>
                <div className="flex justify-between text-xs text-white/40 mb-1">
                  <span>{m.label}</span><span>{Math.round(m.value * 100)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <motion.div className={`h-full rounded-full ${m.color}`} initial={{ width: 0 }} animate={{ width: `${m.value * 100}%` }} transition={{ duration: 0.4 }} />
                </div>
              </div>
            ))}
          </div>

          {order && (
            <div>
              <h3 className="text-sm font-medium text-white/80 mb-3">Order</h3>
              {pendingItems.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-medium text-orange-400 mb-2">Waiting for food</p>
                  {pendingItems.map((item) => (
                    <div key={item.name} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                        <span className="text-sm text-white/80">{item.name}</span>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <span className="text-xs text-orange-400 font-mono">{item.orderedAgo}m ago</span>
                        <span className="text-xs text-white/30 w-10 text-right">${PRICES[item.name] ?? 20}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {deliveredItems.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-emerald-400 mb-2">Delivered</p>
                  {deliveredItems.map((item) => (
                    <div key={item.name} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                        <span className="text-sm text-white/50">{item.name}</span>
                      </div>
                      <span className="text-xs text-white/30 w-10 text-right shrink-0">${PRICES[item.name] ?? 20}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {table.alerts.length > 0 && (
            <div className="mt-4 p-3 rounded-xl bg-red-500/[0.06] border border-red-500/20">
              {table.alerts.map((a, i) => (<p key={i} className="text-xs text-red-400">{a}</p>))}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

export function Dashboard() {
  const LOC = LOCATIONS[0];
  const [locResults, setLocResults] = useState<LocationResult[]>([mockLoc(LOC)]);
  const [stats, setStats] = useState<AnalysisStats | null>(null);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [peakContainers, setPeakContainers] = useState(0);
  const [loading, setLoading] = useState(false);
  const [rush, setRush] = useState(false);
  const [phase, setPhase] = useState(0);
  const rushRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [waitingList, setWaitingList] = useState<WaitingParty[]>(mockWaitingList());
  const [recommendation, setRecommendation] = useState<HostRec | null>(mockRecommendation());
  const [lastUpdate, setLastUpdate] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  const [clock, setClock] = useState("");
  useEffect(() => {
    setClock(new Date().toLocaleTimeString());
    const t = setInterval(() => setClock(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { setLastUpdate(new Date().toLocaleTimeString()); }, [recommendation]);

  const fetchAiRecommendation = useCallback(async (currentTables: TableStatus[]) => {
    setAiLoading(true);
    try {
      const payload = {
        location_id: LOC.id,
        tables: currentTables.map(t => ({
          table_id: t.table_id, state: t.state, party_size: t.party_size,
          stress_avg: t.stress_avg, engagement_avg: t.engagement_avg,
          predicted_turn_minutes: t.predicted_turn_minutes, vibe: t.vibe, urgency: t.urgency,
        })),
      };
      const r = await fetch(EP.recommend, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (d.recommendation) setRecommendation(d.recommendation);
      if (d.waiting_list?.length) setWaitingList(d.waiting_list);
    } catch { /* keep mock */ } finally { setAiLoading(false); }
  }, [LOC.id]);

  const fireRush = useCallback(async (idx: number) => {
    setLoading(true);
    try {
      const r = await fetch(EP.rush, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phase_index: idx }) });
      const d: FloorAnalysis = await r.json();
      setLocResults(d.locations); setStats(d.stats);
      setSessionTotal(p => p + d.stats.tables_analyzed);
      setPeakContainers(p => Math.max(p, d.stats.modal_invocations));
      if (d.waiting_list?.length) setWaitingList(d.waiting_list);
      if (d.recommendations?.length) setRecommendation(d.recommendations[0]);
    } catch { setLocResults([mockLoc(LOC)]); setWaitingList(mockWaitingList()); setRecommendation(mockRecommendation()); }
    finally { setLoading(false); }
  }, [LOC]);

  const toggleRush = useCallback(() => {
    if (rush) { if (rushRef.current) clearInterval(rushRef.current); rushRef.current = null; setRush(false); }
    else { setRush(true); fireRush(phase); rushRef.current = setInterval(() => { setPhase(p => { const n = p + 1; fireRush(n); return n; }); }, RUSH_MS); }
  }, [rush, phase, fireRush]);

  useEffect(() => () => { if (rushRef.current) clearInterval(rushRef.current); }, []);
  useEffect(() => { const initial = mockLoc(LOC); fetchAiRecommendation(initial.tables); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const aiRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (rush) return;
    const t = setInterval(() => { setLocResults([mockLoc(LOC)]); }, REFRESH_MS);
    aiRefreshRef.current = setInterval(() => { const fresh = mockLoc(LOC); fetchAiRecommendation(fresh.tables); }, 60_000);
    return () => { clearInterval(t); if (aiRefreshRef.current) clearInterval(aiRefreshRef.current); };
  }, [rush, fetchAiRecommendation, LOC]);

  const cur = locResults[0];
  const tables = cur?.tables ?? [];
  const alerts = cur?.alert_count ?? 0;
  const locName = LOC.name;
  const occupied = tables.filter(t => t.state !== "EMPTY").length;

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gradient mb-1">{locName}</h1>
          <p className="text-sm text-white/40">Floor overview</p>
        </div>
        <div className="flex items-center gap-3">
          {loading && (
            <svg className="animate-spin h-4 w-4 text-white/40" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
          <span className="text-sm text-white/30 font-mono tabular-nums">{clock}</span>
          {alerts > 0 && (
            <span className="min-w-[22px] h-5 flex items-center justify-center bg-red-600 text-white text-xs font-medium rounded-full px-1.5">{alerts}</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: "Occupied", value: occupied, total: tables.length, color: "text-white" },
          { label: "Alerts", value: alerts, color: alerts > 0 ? "text-red-400" : "text-white/30" },
          { label: "Waiting", value: waitingList.length, color: waitingList.length > 4 ? "text-orange-400" : "text-white/30" },
          { label: "Latency", value: stats ? `${(stats.parallel_latency_ms / 1000).toFixed(1)}s` : "--", color: "text-emerald-400" },
        ].map(s => (
          <div key={s.label} className="rounded-xl bg-black/50 border border-white/[0.10] backdrop-blur-sm px-4 py-3">
            <p className="text-xs text-white/40 mb-1">{s.label}</p>
            <p className={`text-xl font-semibold ${s.color}`}>
              {typeof s.value === "number" ? s.value : s.value}
              {"total" in s && <span className="text-sm font-normal text-white/30">/{s.total}</span>}
            </p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-5">
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={toggleRush}
          className={`px-4 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-all ${
            rush ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
          }`}
        >
          {rush ? "Stop" : "Rush Hour"}
        </motion.button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div>
          <div className="grid grid-cols-2 gap-2">
            {tables.map((t, i) => (
              <MiniTable key={`${t.location_id}-${t.table_id}`} table={t} index={i} selected={selectedTable === t.table_id} onSelect={() => setSelectedTable(selectedTable === t.table_id ? null : t.table_id)} />
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <AnimatePresence mode="wait">
            {selectedTable && tables.find((t) => t.table_id === selectedTable) && (
              <TableDetail key={selectedTable} table={tables.find((t) => t.table_id === selectedTable)!} onClose={() => setSelectedTable(null)} />
            )}
          </AnimatePresence>
          <HostRecommendation recommendation={recommendation} updatedAt={lastUpdate} />
          <WaitingList parties={waitingList} />
        </div>
      </div>
    </>
  );
}
