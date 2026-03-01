"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { TableCard } from "./TableCard";
import { StatsBar } from "./StatsBar";
import { BootScreen } from "./BootScreen";
import { WaitingList } from "./WaitingList";
import { HostRecommendation } from "./HostRecommendation";
import type {
  AnalysisStats, BootResult, FloorAnalysis,
  LocationResult, TableStatus, Location,
  WaitingParty, HostRecommendation as HostRec,
  TableState, Vibe, Urgency, WaitingUrgency,
} from "../../types/argus";
import { LOCATIONS } from "../../types/argus";

const API_BASE = process.env.NEXT_PUBLIC_ARGUS_API ?? "https://girishskandhas--argus";
const EP = {
  boot: `${API_BASE}-api-boot.modal.run`,
  rush: `${API_BASE}-api-rush-hour.modal.run`,
};
const RUSH_MS = 30_000;
const REFRESH_MS = 60_000;

/* ------------------------------------------------------------------ */
/*  Mock helpers                                                       */
/* ------------------------------------------------------------------ */

const TABLE_STATES: TableState[] = ["EMPTY", "JUST_SEATED", "MID_MEAL", "FINISHING", "CHECK_STAGE"];

function mockTable(id: string, loc: string): TableStatus {
  const states = TABLE_STATES;
  const vibes: Vibe[] = ["happy", "neutral", "stressed", "angry", "about_to_leave"];
  const state = states[Math.floor(Math.random() * states.length)];
  const s = Math.random();
  const isEmpty = state === "EMPTY";
  const low = isEmpty ? 0 : Math.floor(Math.random() * 20) + 3;
  const high = low + Math.floor(Math.random() * 10) + 2;

  return {
    table_id: id,
    location_id: loc,
    state,
    vibe: isEmpty ? "neutral" : vibes[Math.floor(Math.random() * vibes.length)],
    phase: isEmpty ? "empty" : "eating",
    party_size: isEmpty ? 0 : Math.floor(Math.random() * 5) + 2,
    confidence: 0.7 + Math.random() * 0.3,
    visual_cues: [],
    stress_avg: isEmpty ? 0 : s,
    engagement_avg: isEmpty ? 0 : 1 - s * 0.8,
    predicted_turn_minutes: isEmpty ? null : Math.floor((low + high) / 2),
    predicted_turn_low: isEmpty ? null : low,
    predicted_turn_high: isEmpty ? null : high,
    prediction_confidence: 0.65,
    prediction_reasoning: "",
    urgency: (s > 0.8 ? "high" : s > 0.6 ? "medium" : "none") as Urgency,
    alerts: s > 0.8 ? ["Elevated stress detected"] : [],
    action_needed: s > 0.7 ? "Check on table" : null,
    summary: `Table ${id}: ${state}`,
    inference_latency_ms: 0,
    total_latency_ms: 0,
  };
}

function mockLoc(l: Location): LocationResult {
  const t = Array.from({ length: l.tables }, (_, i) => mockTable(String(i + 1), l.id));
  return {
    location_id: l.id,
    tables: t,
    table_count: l.tables,
    alert_count: t.filter(x => x.alerts.length > 0).length,
    latency_ms: 0,
  };
}

function mockWaitingList(): WaitingParty[] {
  const names = ["James", "Maria", "Chen", "Aisha", "Raj", "Sofia", "Marcus"];
  const levels: WaitingUrgency[] = ["calm", "moderate", "urgent", "leaving"];
  const prefs = ["any", "booth", "patio", "window"];
  const now = Date.now() / 1000;

  return names.slice(0, 4 + Math.floor(Math.random() * 3)).map((name, i) => {
    const waitMin = Math.floor(Math.random() * 20) + 2;
    const score = Math.min(10, 1 + waitMin * 0.4 + Math.random() * 2);
    const level = score >= 8 ? "leaving" : score >= 6 ? "urgent" : score >= 3.5 ? "moderate" : "calm";
    const hr = 72 + Math.floor(score * 3);
    const eng = Math.max(0.05, 1 - score * 0.1);

    return {
      party_id: `wait-${i + 1}`,
      party_name: name,
      party_size: Math.floor(Math.random() * 4) + 2,
      wait_start: now - waitMin * 60,
      wait_minutes: waitMin,
      preferred_seating: prefs[Math.floor(Math.random() * prefs.length)],
      urgency_score: Math.round(score * 10) / 10,
      urgency_level: level as WaitingUrgency,
      best_table_match: null,
      notes: "",
      readings: Array.from({ length: Math.floor(Math.random() * 3) + 2 }, () => ({
        heart_rate: hr + Math.floor(Math.random() * 10) - 5,
        breathing_rate: 15 + Math.floor(Math.random() * 4),
        engagement: eng + Math.random() * 0.1 - 0.05,
        frustration: Math.min(1, score * 0.1),
        movement_intensity: Math.min(1, score * 0.08),
        exit_directed: level === "leaving" && Math.random() > 0.3,
        facial_patience: Math.max(0, 1 - score * 0.1),
      })),
    };
  }).sort((a, b) => b.urgency_score - a.urgency_score);
}

function mockRecommendation(loc: string): HostRec {
  const recs: HostRec[] = [
    {
      primary_action: "Quote 10 minutes for the party of 3. Table 3 freeing in ~8 min (high confidence).",
      secondary_actions: ["Party of 2 near door showing moderate stress — monitor closely.", "Table 14 overdue by 5 min in check stage."],
      urgency: "medium",
      reasoning: "Table 3 is in CHECK_STAGE with high confidence. Party of 3 is best match for this 4-top.",
    },
    {
      primary_action: "Seat party of 2 at bar immediately — exit behavior detected after 15 min wait.",
      secondary_actions: ["Table 7 (4-top) frees in ~16 min, avoid quoting as option.", "Tables 5 and 12 simultaneously in FINISHING — watch for server bottleneck."],
      urgency: "high",
      reasoning: "Presage detects exit-directed movement and elevated heart rate in longest-waiting party.",
    },
    {
      primary_action: "All tables occupied, no imminent turns. Manage expectations for 20+ min wait.",
      secondary_actions: ["Offer drinks at bar for waiting parties.", "Table 9 lingering at 85 min — consider a check-in."],
      urgency: "low",
      reasoning: "Floor is at full capacity with no tables in CHECK_STAGE. Earliest predicted turn in 12 min.",
    },
  ];
  return recs[Math.floor(Math.random() * recs.length)];
}

/* ------------------------------------------------------------------ */
/*  Dashboard Component                                                */
/* ------------------------------------------------------------------ */

export function Dashboard() {
  const [locResults, setLocResults] = useState<LocationResult[]>(LOCATIONS.map(mockLoc));
  const [selLoc, setSelLoc] = useState(LOCATIONS[0].id);
  const [stats, setStats] = useState<AnalysisStats | null>(null);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [peakContainers, setPeakContainers] = useState(0);
  const [loading, setLoading] = useState(false);

  const [booting, setBooting] = useState(false);
  const [bootProg, setBootProg] = useState(0);
  const [bootSess, setBootSess] = useState(0);
  const [bootRes, setBootRes] = useState<BootResult | null>(null);
  const [showBoot, setShowBoot] = useState(false);

  const [rush, setRush] = useState(false);
  const [phase, setPhase] = useState(0);
  const rushRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [waitingList, setWaitingList] = useState<WaitingParty[]>(mockWaitingList());
  const [recommendation, setRecommendation] = useState<HostRec | null>(mockRecommendation("downtown"));
  const [lastUpdate, setLastUpdate] = useState("");

  const [clock, setClock] = useState("");
  useEffect(() => {
    setClock(new Date().toLocaleTimeString());
    const t = setInterval(() => setClock(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setLastUpdate(new Date().toLocaleTimeString());
  }, [recommendation]);

  /* Boot */
  const handleBoot = useCallback(async () => {
    setShowBoot(true); setBooting(true); setBootProg(0); setBootSess(0);
    const fake = setInterval(() => {
      setBootProg(p => Math.min(p + 8, 90));
      setBootSess(s => Math.min(s + 840, 7560));
    }, 600);
    try {
      const r = await fetch(EP.boot, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const d: BootResult = await r.json();
      clearInterval(fake); setBootProg(100); setBootSess(d.sessions_processed); setBootRes(d);
    } catch {
      clearInterval(fake); setBootProg(100); setBootSess(8400);
      setBootRes({ total_sessions: 8400, sessions_processed: 8400, chunks_completed: 10, processing_time_ms: 11500 });
    } finally {
      setBooting(false); setTimeout(() => setShowBoot(false), 2000);
    }
  }, []);

  /* Rush */
  const fireRush = useCallback(async (idx: number) => {
    setLoading(true);
    try {
      const r = await fetch(EP.rush, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phase_index: idx }) });
      const d: FloorAnalysis = await r.json();
      setLocResults(d.locations);
      setStats(d.stats);
      setSessionTotal(p => p + d.stats.tables_analyzed);
      setPeakContainers(p => Math.max(p, d.stats.modal_invocations));

      if (d.waiting_list?.length) {
        setWaitingList(d.waiting_list);
      }
      if (d.recommendations?.length) {
        const locRec = d.recommendations.find(r => r.location_id === selLoc) ?? d.recommendations[0];
        setRecommendation(locRec);
      }
    } catch {
      setLocResults(LOCATIONS.map(mockLoc));
      setWaitingList(mockWaitingList());
      setRecommendation(mockRecommendation(selLoc));
    } finally {
      setLoading(false);
    }
  }, [selLoc]);

  const toggleRush = useCallback(() => {
    if (rush) {
      if (rushRef.current) clearInterval(rushRef.current);
      rushRef.current = null;
      setRush(false);
    } else {
      setRush(true);
      fireRush(phase);
      rushRef.current = setInterval(() => {
        setPhase(p => { const n = p + 1; fireRush(n); return n; });
      }, RUSH_MS);
    }
  }, [rush, phase, fireRush]);

  useEffect(() => () => { if (rushRef.current) clearInterval(rushRef.current); }, []);

  /* Refresh mock data periodically for demo */
  useEffect(() => {
    if (rush) return;
    const t = setInterval(() => {
      setLocResults(LOCATIONS.map(mockLoc));
      setWaitingList(mockWaitingList());
      setRecommendation(mockRecommendation(selLoc));
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [rush, selLoc]);

  const cur = locResults.find(l => l.location_id === selLoc);
  const tables = cur?.tables ?? [];
  const alerts = locResults.reduce((s, l) => s + (l.alert_count ?? 0), 0);
  const locName = LOCATIONS.find(l => l.id === selLoc)?.name ?? selLoc;

  const stateBreakdown = tables.reduce<Record<string, number>>((acc, t) => {
    const st = t.state ?? "UNKNOWN";
    acc[st] = (acc[st] || 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <BootScreen visible={showBoot} progress={bootProg} sessionsProcessed={bootSess} bootResult={bootRes} />

      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-[0.25em] font-mono text-argus-text">
            A.R.G.U.S.
          </h1>
          <p className="text-[10px] tracking-[0.15em] uppercase text-argus-dim mt-0.5">
            5-Agent Restaurant Intelligence
          </p>
        </div>
        <div className="flex items-center gap-3">
          {loading && (
            <svg className="animate-spin h-4 w-4 text-argus-dim" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
          <span className="text-xs text-argus-faint font-mono">{clock}</span>
          {alerts > 0 && (
            <span className="min-w-[24px] h-6 flex items-center justify-center bg-red-600 text-white text-xs font-bold rounded-full px-1.5">
              {alerts}
            </span>
          )}
        </div>
      </div>

      <StatsBar
        stats={stats}
        sessionTotal={sessionTotal}
        peakContainers={peakContainers}
        isRushHour={rush}
        waitingCount={waitingList.length}
        autoRefresh={!rush}
      />

      {/* Buttons */}
      <div className="flex gap-3 mb-4">
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={handleBoot}
          disabled={booting}
          className="flex-1 py-3 rounded-xl text-xs font-bold text-argus-text border border-argus-glass-border bg-argus-card hover:bg-argus-surface transition-colors disabled:opacity-50 cursor-pointer"
        >
          {booting ? "Processing..." : bootRes ? `\u2713 ${bootRes.sessions_processed.toLocaleString()} loaded` : "Load Historical Data"}
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={toggleRush}
          className={`flex-1 py-3 rounded-xl text-xs font-bold text-white cursor-pointer transition-colors ${
            rush
              ? "bg-gradient-to-r from-red-700 to-red-900 hover:from-red-600"
              : "bg-gradient-to-r from-emerald-600 to-emerald-800 hover:from-emerald-500"
          }`}
        >
          {rush ? "\u25A0  Stop Rush Hour" : "\u25B6  Simulate Rush Hour"}
        </motion.button>
      </div>

      {/* Location tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
        {LOCATIONS.map(loc => {
          const lr = locResults.find(l => l.location_id === loc.id);
          const a = lr?.alert_count ?? 0;
          const active = selLoc === loc.id;
          return (
            <button
              key={loc.id}
              onClick={() => setSelLoc(loc.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-[11px] font-semibold tracking-wide whitespace-nowrap border transition-all cursor-pointer ${
                active
                  ? "bg-gradient-to-r from-emerald-600 to-emerald-800 border-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                  : "bg-argus-card border-argus-border text-argus-muted hover:text-argus-text"
              }`}
            >
              {loc.name}
              {a > 0 && (
                <span className="min-w-[16px] h-4 flex items-center justify-center bg-red-600 text-white text-[9px] font-bold rounded-full px-1">
                  {a}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* State breakdown pills */}
      <div className="flex gap-2 flex-wrap mb-4">
        {(["EMPTY", "JUST_SEATED", "MID_MEAL", "FINISHING", "CHECK_STAGE"] as const).map(st => {
          const count = stateBreakdown[st] ?? 0;
          const colors: Record<string, string> = {
            EMPTY: "bg-emerald-500/15 text-emerald-400",
            JUST_SEATED: "bg-sky-500/15 text-sky-400",
            MID_MEAL: "bg-amber-500/15 text-amber-400",
            FINISHING: "bg-orange-500/15 text-orange-400",
            CHECK_STAGE: "bg-red-500/15 text-red-400",
          };
          return (
            <span key={st} className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide ${colors[st]}`}>
              {st.replace(/_/g, " ")} {count}
            </span>
          );
        })}
      </div>

      {/* === 3-PANEL LAYOUT === */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">

        {/* Panel 1: Floor View */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-argus-dim">
              Floor View — {locName}
            </span>
            <span className="text-[10px] text-argus-faint">
              {tables.length} tables
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {tables.map((t, i) => (
              <TableCard key={`${t.location_id}-${t.table_id}`} table={t} index={i} />
            ))}
          </div>
        </div>

        {/* Sidebar: Panels 2 & 3 */}
        <div className="space-y-4">
          {/* Panel 3: Host Recommendation */}
          <HostRecommendation
            recommendation={recommendation}
            locationName={locName}
            updatedAt={lastUpdate}
          />

          {/* Panel 2: Waiting List */}
          <WaitingList parties={waitingList} />
        </div>
      </div>
    </>
  );
}
