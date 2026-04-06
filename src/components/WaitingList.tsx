"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { WaitingParty, WaitingUrgency } from "../../types/argus";

const URGENCY_STYLE: Record<WaitingUrgency, { bg: string; text: string; dot: string; label: string }> = {
  calm:     { bg: "bg-emerald-500/[0.08]", text: "text-emerald-400", dot: "bg-emerald-400", label: "Calm" },
  moderate: { bg: "bg-orange-500/[0.08]",  text: "text-orange-400",  dot: "bg-orange-400",  label: "Moderate" },
  urgent:   { bg: "bg-red-500/[0.08]",     text: "text-red-400",     dot: "bg-red-400",     label: "Urgent" },
  leaving:  { bg: "bg-red-500/[0.12]",     text: "text-red-300",     dot: "bg-red-500",     label: "Leaving" },
};

const SEATING_LABEL: Record<string, string> = { any: "Any", booth: "Booth", patio: "Patio", window: "Window" };

interface Props { parties: WaitingParty[]; }

export function WaitingList({ parties }: Props) {
  return (
    <div className="rounded-xl overflow-hidden border border-white/[0.10] bg-black/60 backdrop-blur-md">
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-white/50">Waiting List</p>
          <span className="text-xs text-white/30">{parties.length} {parties.length === 1 ? "party" : "parties"}</span>
        </div>
        {parties.length > 0 && <p className="text-xs text-white/20 mt-1">Sorted by urgency</p>}
      </div>
      <div className="max-h-[400px] overflow-y-auto">
        <AnimatePresence mode="popLayout">
          {parties.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-4 py-8 text-center">
              <p className="text-white/30 text-sm">No parties waiting</p>
            </motion.div>
          ) : parties.map((party, i) => <WaitingPartyRow key={party.party_id} party={party} index={i} />)}
        </AnimatePresence>
      </div>
    </div>
  );
}

function WaitingPartyRow({ party, index }: { party: WaitingParty; index: number }) {
  const style = URGENCY_STYLE[party.urgency_level] ?? URGENCY_STYLE.calm;
  const seatLabel = SEATING_LABEL[party.preferred_seating] ?? party.preferred_seating;
  const avgHR = party.readings.length > 0 ? Math.round(party.readings.reduce((s, r) => s + r.heart_rate, 0) / party.readings.length) : null;
  const avgEngagement = party.readings.length > 0 ? party.readings.reduce((s, r) => s + r.engagement, 0) / party.readings.length : null;
  const anyExitBehavior = party.readings.some(r => r.exit_directed);

  return (
    <motion.div layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.2, delay: index * 0.04 }}
      className="px-4 py-3 border-b border-white/[0.06] last:border-b-0 hover:bg-white/[0.06] transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-white/90 truncate">{party.party_name}</span>
          <span className="text-xs text-white/40">party of {party.party_size}</span>
        </div>
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full ${style.bg} shrink-0`}>
          <span className={`w-1.5 h-1.5 rounded-full ${style.dot} ${party.urgency_level === "leaving" ? "animate-pulse-dot" : ""}`} />
          <span className={`text-xs font-medium ${style.text}`}>{style.label}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-white/50 flex-wrap">
        <span className="font-medium">{party.wait_minutes}m wait</span>
        <span className="text-white/15">/</span>
        <span>{seatLabel}</span>
        {avgHR !== null && (<><span className="text-white/15">/</span><span className={avgHR > 85 ? "text-red-400" : ""}>{avgHR} bpm</span></>)}
        {avgEngagement !== null && (<><span className="text-white/15">/</span><span className={avgEngagement < 0.3 ? "text-orange-400" : ""}>{Math.round(avgEngagement * 100)}% eng</span></>)}
      </div>
      {anyExitBehavior && (
        <div className="mt-2 flex items-center gap-1.5 bg-red-500/[0.08] rounded-lg px-2 py-1 border border-red-500/15">
          <span className="text-xs font-medium text-red-400">Exit behavior detected — intervene now</span>
        </div>
      )}
      <div className="mt-2 h-1 bg-white/[0.04] rounded-full overflow-hidden">
        <motion.div className={`h-full rounded-full ${party.urgency_score >= 7 ? "bg-red-500" : party.urgency_score >= 4 ? "bg-orange-500" : "bg-emerald-500"}`}
          initial={{ width: 0 }} animate={{ width: `${party.urgency_score * 10}%` }} transition={{ duration: 0.4, delay: index * 0.06 }} />
      </div>
    </motion.div>
  );
}
