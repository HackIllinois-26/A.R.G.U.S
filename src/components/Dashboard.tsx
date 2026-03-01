"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
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

/* ── Order data ───────────────────────────────────────────────────── */

interface OrderItem {
  name: string;
  delivered: boolean;
  orderedAgo: number; // minutes ago
}

interface TableOrder {
  items: OrderItem[];
  totalSpend: number;
}

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
    const orderedAgo = justSeated
      ? Math.floor(Math.random() * 5) + 1
      : Math.floor(Math.random() * 25) + 5;
    return { name, delivered, orderedAgo };
  });

  const totalSpend = items.reduce((sum, it) => sum + (PRICES[it.name] ?? 20), 0);
  return { items, totalSpend };
}

/* ── State styling ─────────────────────────────────────────────────── */

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

/* ── Mini table card ───────────────────────────────────────────────── */

const TABLE_CAPACITY: Record<string, number> = {
  "1": 2, "2": 2, "3": 4, "4": 4, "5": 4, "6": 6, "7": 6, "8": 4,
  "9": 2, "10": 4, "11": 4, "12": 6, "13": 2, "14": 4, "15": 4,
  "16": 6, "17": 4, "18": 2, "19": 4, "20": 6,
};

function MiniTable({
  table,
  index,
  selected,
  onSelect,
}: {
  table: TableStatus;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const isEmpty = table.state === "EMPTY";
  const dot = STATE_DOT[table.state] ?? "bg-slate-500";
  const text = STATE_TEXT[table.state] ?? "text-slate-400";
  const label = STATE_LABEL[table.state] ?? table.state;
  const capacity = TABLE_CAPACITY[table.table_id] ?? 4;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, delay: index * 0.02 }}
      onClick={onSelect}
      className={`rounded-xl border transition-all duration-300 cursor-pointer ${
        selected
          ? "border-cyan-400/50 bg-cyan-400/[0.06] ring-1 ring-cyan-400/20"
          : isEmpty
          ? "border-white/[0.04] bg-white/[0.01] hover:border-white/[0.08]"
          : table.urgency === "high" || table.urgency === "critical"
          ? "border-red-500/30 bg-red-500/[0.04]"
          : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
      }`}
    >
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-base font-bold text-argus-text">T{table.table_id}</span>
            <span className="text-[10px] text-argus-dim">{capacity}-seat</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
            <span className={`text-[10px] font-semibold ${text}`}>{label}</span>
          </div>
        </div>

        {!isEmpty ? (
          <>
            <div className="flex items-center justify-between text-[11px] mb-2">
              <span className="text-argus-muted">{table.party_size} guests</span>
              {table.predicted_turn_low != null && table.predicted_turn_high != null && (
                <span className="text-argus-dim font-mono">
                  ~{table.predicted_turn_low}-{table.predicted_turn_high}m
                </span>
              )}
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <div className="flex items-center justify-between text-[9px] text-argus-dim mb-0.5">
                  <span>Stress</span>
                  <span>{Math.round(table.stress_avg * 100)}%</span>
                </div>
                <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${table.stress_avg > 0.6 ? "bg-red-500" : "bg-argus-dim"}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${table.stress_avg * 100}%` }}
                    transition={{ duration: 0.5, delay: index * 0.02 }}
                  />
                </div>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between text-[9px] text-argus-dim mb-0.5">
                  <span>Engage</span>
                  <span>{Math.round(table.engagement_avg * 100)}%</span>
                </div>
                <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
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
              <p className="text-[10px] text-red-400 mt-2 truncate">{table.alerts[0]}</p>
            )}
          </>
        ) : (
          <p className="text-[11px] text-argus-dim/40 text-center py-1">{capacity} seats open</p>
        )}
      </div>
    </motion.div>
  );
}

/* ── Table detail panel ───────────────────────────────────────────── */

function TableDetail({ table, onClose }: { table: TableStatus; onClose: () => void }) {
  const isEmpty = table.state === "EMPTY";
  const dot = STATE_DOT[table.state] ?? "bg-slate-500";
  const text = STATE_TEXT[table.state] ?? "text-slate-400";
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
  const timeToFree = table.predicted_turn_minutes != null
    ? Math.max(1, table.predicted_turn_minutes - seatedMinutes)
    : null;

  const pendingItems = order?.items.filter((i) => !i.delivered) ?? [];
  const deliveredItems = order?.items.filter((i) => i.delivered) ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.2 }}
      className="glass rounded-2xl p-5 border border-white/[0.08]"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold text-argus-text">Table {table.table_id}</span>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.05]">
            <span className={`w-2 h-2 rounded-full ${dot}`} />
            <span className={`text-xs font-semibold ${text}`}>{label}</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-argus-dim hover:text-argus-text transition-colors text-lg leading-none px-2 py-1 rounded-lg hover:bg-white/[0.05] cursor-pointer"
        >
          &times;
        </button>
      </div>

      {isEmpty ? (
        <div className="text-center py-6">
          <p className="text-lg text-argus-dim">{capacity} seats available</p>
          <p className="text-sm text-argus-faint mt-1">No active orders</p>
        </div>
      ) : (
        <>
          {/* Prediction highlight */}
          {timeToFree != null && (
            <div className="rounded-xl bg-gradient-to-r from-cyan-500/[0.08] to-cyan-500/[0.02] border border-cyan-400/20 p-4 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-cyan-400/70 mb-1">Predicted free in</p>
                  <p className="text-3xl font-black text-cyan-400">
                    ~{timeToFree}<span className="text-lg font-medium"> min</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-widest text-argus-dim mb-1">At table for</p>
                  <p className="text-xl font-bold text-argus-muted">
                    {seatedMinutes}<span className="text-sm font-normal"> min</span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Quick info row */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 text-center">
              <p className="text-[10px] uppercase tracking-widest text-argus-dim mb-1">Guests</p>
              <p className="text-xl font-bold text-argus-text">{table.party_size}<span className="text-sm text-argus-dim font-normal">/{capacity}</span></p>
            </div>
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 text-center">
              <p className="text-[10px] uppercase tracking-widest text-argus-dim mb-1">Est. Turn</p>
              <p className="text-xl font-bold text-argus-text">
                {table.predicted_turn_low != null ? `${table.predicted_turn_low}-${table.predicted_turn_high}` : "--"}
                <span className="text-sm text-argus-dim font-normal">m</span>
              </p>
            </div>
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 text-center">
              <p className="text-[10px] uppercase tracking-widest text-argus-dim mb-1">Tab</p>
              <p className="text-xl font-bold text-emerald-400">${order?.totalSpend ?? 0}</p>
            </div>
          </div>

          {/* Biometrics */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            {[
              { label: "Stress", value: table.stress_avg, color: table.stress_avg > 0.6 ? "bg-red-500" : "bg-argus-dim" },
              { label: "Engagement", value: table.engagement_avg, color: "bg-emerald-500" },
            ].map((m) => (
              <div key={m.label}>
                <div className="flex justify-between text-xs text-argus-dim mb-1">
                  <span>{m.label}</span>
                  <span>{Math.round(m.value * 100)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${m.color}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${m.value * 100}%` }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Orders */}
          {order && (
            <div>
              <h3 className="text-sm font-semibold text-argus-text mb-3">Order</h3>

              {pendingItems.length > 0 && (
                <div className="mb-4">
                  <p className="text-[10px] uppercase tracking-widest text-amber-400 mb-2">Waiting for food</p>
                  <div className="space-y-0.5">
                    {pendingItems.map((item) => (
                      <div key={item.name} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                        <div className="flex items-center gap-2.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                          <span className="text-sm text-argus-text">{item.name}</span>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <span className="text-xs text-amber-400 font-mono">{item.orderedAgo}m ago</span>
                          <span className="text-xs text-argus-dim w-10 text-right">${PRICES[item.name] ?? 20}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {deliveredItems.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-emerald-400 mb-2">Delivered</p>
                  <div className="space-y-0.5">
                    {deliveredItems.map((item) => (
                      <div key={item.name} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                        <div className="flex items-center gap-2.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                          <span className="text-sm text-argus-muted">{item.name}</span>
                        </div>
                        <span className="text-xs text-argus-dim w-10 text-right shrink-0">${PRICES[item.name] ?? 20}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Alerts */}
          {table.alerts.length > 0 && (
            <div className="mt-4 p-3 rounded-xl bg-red-500/[0.06] border border-red-500/20">
              {table.alerts.map((a, i) => (
                <p key={i} className="text-xs text-red-400">{a}</p>
              ))}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

/* ── Dashboard ─────────────────────────────────────────────────────── */

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

  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  const [clock, setClock] = useState("");
  useEffect(() => {
    setClock(new Date().toLocaleTimeString());
    const t = setInterval(() => setClock(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { setLastUpdate(new Date().toLocaleTimeString()); }, [recommendation]);

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
  useEffect(() => {
    if (rush) return;
    const t = setInterval(() => { setLocResults([mockLoc(LOC)]); setWaitingList(mockWaitingList()); setRecommendation(mockRecommendation()); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [rush]);

  const cur = locResults[0];
  const tables = cur?.tables ?? [];
  const alerts = cur?.alert_count ?? 0;
  const locName = LOC.name;
  const occupied = tables.filter(t => t.state !== "EMPTY").length;

  return (
    <>

      {/* ── Hero row ── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-argus-text">
            {locName}
          </h1>
          <p className="text-sm text-argus-dim mt-1">Floor Overview</p>
        </div>
        <div className="flex items-center gap-3">
          {loading && (
            <svg className="animate-spin h-4 w-4 text-argus-dim" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
          <span className="text-sm text-argus-faint font-mono">{clock}</span>
          {alerts > 0 && (
            <span className="min-w-[24px] h-6 flex items-center justify-center bg-red-600 text-white text-xs font-bold rounded-full px-1.5">
              {alerts}
            </span>
          )}
        </div>
      </div>

      {/* ── Quick stats ── */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "Occupied", value: occupied, total: tables.length, color: "text-cyan-400" },
          { label: "Alerts", value: alerts, color: alerts > 0 ? "text-red-400" : "text-argus-dim" },
          { label: "Waiting", value: waitingList.length, color: waitingList.length > 4 ? "text-amber-400" : "text-argus-dim" },
          { label: "Latency", value: stats ? `${(stats.parallel_latency_ms / 1000).toFixed(1)}s` : "--", color: "text-emerald-400" },
        ].map(s => (
          <div key={s.label} className="rounded-xl bg-white/[0.02] border border-white/[0.06] px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-argus-dim mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>
              {typeof s.value === "number" ? s.value : s.value}
              {"total" in s && <span className="text-sm font-normal text-argus-dim">/{s.total}</span>}
            </p>
          </div>
        ))}
      </div>

      {/* ── Actions ── */}
      <div className="flex gap-2 mb-6">
        <Link
          href="/history"
          className="px-4 py-2 rounded-full text-[11px] font-medium border border-white/[0.08] text-argus-muted hover:text-argus-text hover:bg-white/[0.04] transition-colors"
        >
          View History
        </Link>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={toggleRush}
          className={`px-4 py-2 rounded-full text-[11px] font-medium cursor-pointer transition-colors ${
            rush
              ? "bg-red-500/15 text-red-400 border border-red-500/30"
              : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
          }`}
        >
          {rush ? "Stop" : "Rush Hour"}
        </motion.button>
      </div>

      {/* ── Main grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div>
          <div className="grid grid-cols-2 gap-2.5">
            {tables.map((t, i) => (
              <MiniTable
                key={`${t.location_id}-${t.table_id}`}
                table={t}
                index={i}
                selected={selectedTable === t.table_id}
                onSelect={() => setSelectedTable(selectedTable === t.table_id ? null : t.table_id)}
              />
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <AnimatePresence mode="wait">
            {selectedTable && tables.find((t) => t.table_id === selectedTable) && (
              <TableDetail
                key={selectedTable}
                table={tables.find((t) => t.table_id === selectedTable)!}
                onClose={() => setSelectedTable(null)}
              />
            )}
          </AnimatePresence>
          <HostRecommendation recommendation={recommendation} locationName={locName} updatedAt={lastUpdate} />
          <WaitingList parties={waitingList} />
        </div>
      </div>
    </>
  );
}
