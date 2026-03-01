"use client";

import { motion } from "framer-motion";
import { CircularGauge } from "./CircularGauge";
import type { TableStatus, Vibe, Urgency } from "../../types/argus";

const VIBE_STYLE: Record<string, { gradient: string; border: string; color: string; label: string }> = {
  happy:          { gradient: "from-emerald-950 to-emerald-900/80", border: "border-emerald-500/60", color: "#10b981", label: "Happy" },
  neutral:        { gradient: "from-slate-800 to-slate-900",        border: "border-slate-600/60",   color: "#64748b", label: "Neutral" },
  stressed:       { gradient: "from-red-950 to-red-900/80",         border: "border-red-500/60",     color: "#ef4444", label: "Stressed" },
  angry:          { gradient: "from-red-900 to-red-950",            border: "border-red-600/60",     color: "#dc2626", label: "Angry" },
  about_to_leave: { gradient: "from-amber-950 to-amber-900/80",    border: "border-amber-500/60",   color: "#f59e0b", label: "Leaving" },
  unknown:        { gradient: "from-slate-800 to-slate-900",        border: "border-slate-600/60",   color: "#475569", label: "Unknown" },
};

const URG_COLOR: Record<string, string> = {
  none: "#475569", medium: "#f59e0b", high: "#ef4444", critical: "#dc2626", unknown: "#475569",
};

const PHASE_ICON: Record<string, string> = {
  empty: "\u{1FA91}", seated: "\u{1F465}", ordering: "\u{1F4CB}", waiting: "\u23F3",
  eating: "\u{1F37D}\uFE0F", dessert: "\u{1F370}", wants_check: "\u{1F4B3}",
  paying: "\u{1F4B5}", left: "\u{1F6AA}",
};

interface Props { table: TableStatus; index: number }

export function TableCard({ table, index }: Props) {
  const s = VIBE_STYLE[table.vibe] ?? VIBE_STYLE.unknown;
  const uc = URG_COLOR[table.urgency] ?? URG_COLOR.none;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.03, ease: "easeOut" }}
      className={`bg-gradient-to-br ${s.gradient} ${s.border} border-[1.5px] rounded-xl p-3 min-h-[180px] flex flex-col`}
    >
      {/* header */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-lg font-extrabold text-argus-text">T{table.table_id}</span>
        <span className="text-[10px] font-semibold tracking-wider uppercase text-white px-2 py-0.5 rounded" style={{ backgroundColor: s.color }}>
          {s.label}
        </span>
      </div>

      {/* phase */}
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-xs">{PHASE_ICON[table.phase] ?? "\u2753"}</span>
        <span className="text-[10px] font-semibold tracking-[0.1em] uppercase text-argus-muted">
          {table.phase.replace(/_/g, " ")}
        </span>
      </div>

      {/* gauges */}
      <div className="flex items-center justify-around mb-3 flex-1">
        <CircularGauge value={table.stress_avg} size={48} strokeWidth={4} label="STR" />
        <CircularGauge value={table.engagement_avg} size={48} strokeWidth={4} label="ENG" />
        {table.predicted_turn_minutes != null && (
          <div className="text-center">
            <span className="text-xl font-extrabold text-amber-400">{table.predicted_turn_minutes}</span>
            <p className="text-[9px] font-semibold text-argus-dim">min</p>
          </div>
        )}
      </div>

      {/* urgency */}
      {table.urgency !== "none" && (
        <div className="flex items-center gap-2 rounded-md px-2 py-1 mb-1" style={{ backgroundColor: `${uc}22` }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: uc }} />
          <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: uc }}>
            {table.urgency}
          </span>
        </div>
      )}

      {/* alert */}
      {table.alerts.length > 0 && (
        <div className="bg-red-500/10 rounded-md px-2 py-1">
          <p className="text-[10px] font-medium text-red-300 truncate">{table.alerts[0]}</p>
        </div>
      )}
    </motion.div>
  );
}
