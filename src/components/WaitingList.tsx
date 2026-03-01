"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { WaitingParty, WaitingUrgency } from "../../types/argus";

const URGENCY_STYLE: Record<WaitingUrgency, { bg: string; text: string; dot: string; label: string }> = {
  calm:     { bg: "bg-emerald-500/10", text: "text-emerald-400", dot: "bg-emerald-400", label: "Calm" },
  moderate: { bg: "bg-amber-500/10",   text: "text-amber-400",   dot: "bg-amber-400",   label: "Moderate" },
  urgent:   { bg: "bg-red-500/10",     text: "text-red-400",     dot: "bg-red-400",     label: "Urgent" },
  leaving:  { bg: "bg-red-600/15",     text: "text-red-300",     dot: "bg-red-500",     label: "Leaving!" },
};

const SEATING_ICON: Record<string, string> = {
  any: "\u{1FA91}", booth: "\u{1F6CB}\uFE0F", patio: "\u2600\uFE0F", window: "\u{1FA9F}",
};

interface Props {
  parties: WaitingParty[];
}

export function WaitingList({ parties }: Props) {
  return (
    <div className="glass rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-argus-glass-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm">&#x1F465;</span>
            <span className="text-[11px] font-bold tracking-[0.15em] uppercase text-argus-muted">
              Waiting List
            </span>
          </div>
          <span className="text-[10px] font-bold text-argus-dim">
            {parties.length} {parties.length === 1 ? "party" : "parties"}
          </span>
        </div>
        {parties.length > 0 && (
          <p className="text-[9px] text-argus-faint mt-1 tracking-wide">
            Ordered by Presage urgency — not arrival time
          </p>
        )}
      </div>

      {/* List */}
      <div className="max-h-[400px] overflow-y-auto">
        <AnimatePresence mode="popLayout">
          {parties.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="px-4 py-8 text-center"
            >
              <p className="text-argus-dim text-xs">No parties waiting</p>
            </motion.div>
          ) : (
            parties.map((party, i) => (
              <WaitingPartyRow key={party.party_id} party={party} index={i} />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function WaitingPartyRow({ party, index }: { party: WaitingParty; index: number }) {
  const style = URGENCY_STYLE[party.urgency_level] ?? URGENCY_STYLE.calm;
  const seatIcon = SEATING_ICON[party.preferred_seating] ?? "\u{1FA91}";

  const avgHR = party.readings.length > 0
    ? Math.round(party.readings.reduce((s, r) => s + r.heart_rate, 0) / party.readings.length)
    : null;
  const avgEngagement = party.readings.length > 0
    ? party.readings.reduce((s, r) => s + r.engagement, 0) / party.readings.length
    : null;
  const anyExitBehavior = party.readings.some(r => r.exit_directed);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="px-4 py-3 border-b border-argus-glass-border/50 last:border-b-0 hover:bg-argus-surface/30 transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-bold text-argus-text truncate">{party.party_name}</span>
          <span className="text-[10px] text-argus-dim">
            party of {party.party_size}
          </span>
        </div>
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full ${style.bg} shrink-0`}>
          <span className={`w-1.5 h-1.5 rounded-full ${style.dot} ${party.urgency_level === "leaving" ? "animate-pulse-dot" : ""}`} />
          <span className={`text-[10px] font-bold tracking-wider uppercase ${style.text}`}>
            {style.label}
          </span>
        </div>
      </div>

      {/* Metrics row */}
      <div className="flex items-center gap-3 text-[10px]">
        <span className="text-argus-muted font-semibold">
          {party.wait_minutes}m wait
        </span>
        <span className="text-argus-faint">|</span>
        <span className="text-argus-muted">{seatIcon} {party.preferred_seating}</span>
        {avgHR !== null && (
          <>
            <span className="text-argus-faint">|</span>
            <span className={avgHR > 85 ? "text-red-400" : "text-argus-muted"}>
              &#x2764;&#xFE0F; {avgHR} bpm
            </span>
          </>
        )}
        {avgEngagement !== null && (
          <>
            <span className="text-argus-faint">|</span>
            <span className={avgEngagement < 0.3 ? "text-amber-400" : "text-argus-muted"}>
              ENG {Math.round(avgEngagement * 100)}%
            </span>
          </>
        )}
      </div>

      {/* Exit warning */}
      {anyExitBehavior && (
        <div className="mt-2 flex items-center gap-1.5 bg-red-500/10 rounded px-2 py-1">
          <span className="text-[10px]">&#x26A0;&#xFE0F;</span>
          <span className="text-[10px] font-semibold text-red-300">
            Exit behavior detected — intervene now
          </span>
        </div>
      )}

      {/* Urgency bar */}
      <div className="mt-2 h-1 bg-argus-card rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${
            party.urgency_score >= 7 ? "bg-red-500" :
            party.urgency_score >= 4 ? "bg-amber-500" : "bg-emerald-500"
          }`}
          initial={{ width: 0 }}
          animate={{ width: `${party.urgency_score * 10}%` }}
          transition={{ duration: 0.5, delay: index * 0.1 }}
        />
      </div>
    </motion.div>
  );
}
