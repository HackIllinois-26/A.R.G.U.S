"use client";

import { motion } from "framer-motion";
import { CircularGauge } from "./CircularGauge";
import type { TableStatus, TableState, Urgency } from "../../types/argus";

const STATE_STYLE: Record<TableState | "default", {
  bg: string; border: string; color: string; label: string;
}> = {
  EMPTY:       { bg: "bg-black/50",      border: "border-white/[0.08]",    color: "#10b981", label: "Empty" },
  JUST_SEATED: { bg: "bg-sky-950/50",   border: "border-sky-500/20",      color: "#0ea5e9", label: "Just Seated" },
  MID_MEAL:    { bg: "bg-amber-950/50", border: "border-amber-500/20",    color: "#f59e0b", label: "Mid-Meal" },
  FINISHING:   { bg: "bg-orange-950/50", border: "border-orange-500/20",  color: "#f97316", label: "Finishing" },
  CHECK_STAGE: { bg: "bg-red-950/50",   border: "border-red-500/20",      color: "#ef4444", label: "Check Stage" },
  default:     { bg: "bg-black/50",      border: "border-white/[0.08]",   color: "#52525b", label: "Unknown" },
};

const URG_CONFIG: Record<string, { color: string; bg: string }> = {
  none:     { color: "rgba(255,255,255,0.3)", bg: "rgba(255,255,255,0.03)" },
  medium:   { color: "#f97316", bg: "rgba(249,115,22,0.06)" },
  high:     { color: "#ef4444", bg: "rgba(239,68,68,0.06)" },
  critical: { color: "#dc2626", bg: "rgba(220,38,38,0.08)" },
};

interface Props { table: TableStatus; index: number }

export function TableCard({ table, index }: Props) {
  const s = STATE_STYLE[table.state] ?? STATE_STYLE.default;
  const uc = URG_CONFIG[table.urgency] ?? URG_CONFIG.none;
  const isEmpty = table.state === "EMPTY";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.02, ease: "easeOut" }}
      className={`${s.bg} ${s.border} border rounded-xl p-3 min-h-[160px] flex flex-col backdrop-blur-sm`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-base font-semibold text-white">T{table.table_id}</span>
          {table.party_size > 0 && <span className="text-xs text-white/30">{table.party_size}p</span>}
        </div>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `${s.color}12`, color: s.color }}>{s.label}</span>
      </div>

      <div className="flex items-center gap-1.5 mb-2">
        <div className="flex-1 h-0.5 bg-white/[0.06] rounded-full overflow-hidden">
          <motion.div className="h-full rounded-full" style={{ backgroundColor: s.color }} initial={{ width: 0 }} animate={{ width: `${(table.confidence ?? 0) * 100}%` }} transition={{ duration: 0.5, delay: index * 0.02 }} />
        </div>
        <span className="text-xs text-white/30 font-mono w-8 text-right">{Math.round((table.confidence ?? 0) * 100)}%</span>
      </div>

      {!isEmpty && (
        <div className="flex items-center justify-around mb-2 flex-1">
          <CircularGauge value={table.stress_avg} size={44} strokeWidth={3.5} label="STR" />
          <CircularGauge value={table.engagement_avg} size={44} strokeWidth={3.5} label="ENG" />
          {table.predicted_turn_minutes != null && (
            <div className="text-center">
              {table.predicted_turn_low != null && table.predicted_turn_high != null ? (
                <><span className="text-base font-semibold text-orange-400">{table.predicted_turn_low}-{table.predicted_turn_high}</span><p className="text-xs text-white/30">min left</p></>
              ) : (
                <><span className="text-lg font-semibold text-orange-400">{table.predicted_turn_minutes}</span><p className="text-xs text-white/30">min</p></>
              )}
            </div>
          )}
        </div>
      )}

      {isEmpty && <div className="flex-1 flex items-center justify-center"><span className="text-sm text-white/20">Available</span></div>}

      {table.urgency !== "none" && (
        <div className="flex items-center gap-2 rounded-lg px-2 py-1 mb-1" style={{ backgroundColor: uc.bg }}>
          <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ backgroundColor: uc.color }} />
          <span className="text-xs font-medium" style={{ color: uc.color }}>{table.urgency}</span>
        </div>
      )}

      {table.alerts.length > 0 && (
        <div className="bg-red-500/[0.06] border border-red-500/15 rounded-lg px-2 py-1">
          <p className="text-xs text-red-400 truncate">{table.alerts[0]}</p>
        </div>
      )}
    </motion.div>
  );
}
