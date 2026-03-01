"use client";

import { motion } from "framer-motion";
import { CircularGauge } from "./CircularGauge";
import type { TableStatus, TableState, Urgency } from "../../types/argus";

const STATE_STYLE: Record<TableState | "default", {
  gradient: string; border: string; color: string; label: string; icon: string;
}> = {
  EMPTY:       { gradient: "from-slate-900 to-slate-950",           border: "border-slate-700/40",   color: "#10b981", label: "Empty",       icon: "\u{1FA91}" },
  JUST_SEATED: { gradient: "from-sky-950 to-sky-900/80",            border: "border-sky-500/40",     color: "#0ea5e9", label: "Just Seated", icon: "\u{1F465}" },
  MID_MEAL:    { gradient: "from-amber-950/80 to-amber-900/60",     border: "border-amber-500/40",   color: "#f59e0b", label: "Mid-Meal",    icon: "\u{1F37D}\uFE0F" },
  FINISHING:   { gradient: "from-orange-950/80 to-orange-900/60",    border: "border-orange-500/40",  color: "#f97316", label: "Finishing",   icon: "\u{1F370}" },
  CHECK_STAGE: { gradient: "from-red-950/80 to-red-900/60",         border: "border-red-500/40",     color: "#ef4444", label: "Check Stage", icon: "\u{1F4B3}" },
  default:     { gradient: "from-slate-800 to-slate-900",           border: "border-slate-600/40",   color: "#475569", label: "Unknown",     icon: "\u2753" },
};

const URG_CONFIG: Record<string, { color: string; bg: string }> = {
  none:     { color: "#475569", bg: "rgba(71,85,105,0.15)" },
  medium:   { color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  high:     { color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  critical: { color: "#dc2626", bg: "rgba(220,38,38,0.15)" },
};

interface Props { table: TableStatus; index: number }

export function TableCard({ table, index }: Props) {
  const s = STATE_STYLE[table.state] ?? STATE_STYLE.default;
  const uc = URG_CONFIG[table.urgency] ?? URG_CONFIG.none;
  const isEmpty = table.state === "EMPTY";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.025, ease: "easeOut" }}
      className={`group bg-gradient-to-br ${s.gradient} ${s.border} border rounded-xl p-3 min-h-[170px] flex flex-col relative overflow-hidden`}
    >
      {/* Subtle state glow */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{ background: `radial-gradient(ellipse at 50% 0%, ${s.color}, transparent 70%)` }}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-1.5 relative z-10">
        <div className="flex items-center gap-1.5">
          <span className="text-lg font-extrabold text-argus-text">T{table.table_id}</span>
          {table.party_size > 0 && (
            <span className="text-[10px] text-argus-dim">
              &#x2022; {table.party_size}p
            </span>
          )}
        </div>
        <span
          className="text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${s.color}22`, color: s.color }}
        >
          {s.icon} {s.label}
        </span>
      </div>

      {/* Confidence bar */}
      <div className="flex items-center gap-1.5 mb-3 relative z-10">
        <div className="flex-1 h-0.5 bg-argus-card/50 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: s.color }}
            initial={{ width: 0 }}
            animate={{ width: `${(table.confidence ?? 0) * 100}%` }}
            transition={{ duration: 0.6, delay: index * 0.03 }}
          />
        </div>
        <span className="text-[9px] text-argus-faint font-mono w-8 text-right">
          {Math.round((table.confidence ?? 0) * 100)}%
        </span>
      </div>

      {/* Metrics — only show for occupied tables */}
      {!isEmpty && (
        <div className="flex items-center justify-around mb-3 flex-1 relative z-10">
          <CircularGauge value={table.stress_avg} size={44} strokeWidth={3.5} label="STR" />
          <CircularGauge value={table.engagement_avg} size={44} strokeWidth={3.5} label="ENG" />
          {table.predicted_turn_minutes != null && (
            <div className="text-center">
              {table.predicted_turn_low != null && table.predicted_turn_high != null ? (
                <>
                  <div className="flex items-baseline gap-0.5 justify-center">
                    <span className="text-[10px] text-argus-faint">~</span>
                    <span className="text-lg font-extrabold text-amber-400">
                      {table.predicted_turn_low}-{table.predicted_turn_high}
                    </span>
                  </div>
                  <p className="text-[8px] font-semibold text-argus-dim">min left</p>
                </>
              ) : (
                <>
                  <span className="text-xl font-extrabold text-amber-400">
                    {table.predicted_turn_minutes}
                  </span>
                  <p className="text-[8px] font-semibold text-argus-dim">min</p>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div className="flex-1 flex items-center justify-center relative z-10">
          <span className="text-3xl opacity-20">{"\u{1FA91}"}</span>
        </div>
      )}

      {/* Urgency badge */}
      {table.urgency !== "none" && (
        <div
          className="flex items-center gap-2 rounded-md px-2 py-1 mb-1 relative z-10"
          style={{ backgroundColor: uc.bg }}
        >
          <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ backgroundColor: uc.color }} />
          <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: uc.color }}>
            {table.urgency}
          </span>
        </div>
      )}

      {/* Alert */}
      {table.alerts.length > 0 && (
        <div className="bg-red-500/10 rounded-md px-2 py-1 relative z-10">
          <p className="text-[10px] font-medium text-red-300 truncate">{table.alerts[0]}</p>
        </div>
      )}
    </motion.div>
  );
}
