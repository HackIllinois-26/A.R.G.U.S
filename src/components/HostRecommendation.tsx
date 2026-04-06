"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { HostRecommendation as Rec } from "../../types/argus";

const URGENCY_STYLE: Record<string, { border: string; dot: string; label: string }> = {
  low:      { border: "border-white/[0.06]",       dot: "bg-emerald-500", label: "Low" },
  medium:   { border: "border-orange-500/20",      dot: "bg-orange-500",  label: "Medium" },
  high:     { border: "border-red-500/20",         dot: "bg-red-500",     label: "High" },
  critical: { border: "border-red-500/30",         dot: "bg-red-500",     label: "Critical" },
};

interface Props { recommendation: Rec | null; updatedAt?: string; }

export function HostRecommendation({ recommendation, updatedAt }: Props) {
  const rec = recommendation;
  const style = URGENCY_STYLE[rec?.urgency ?? "low"] ?? URGENCY_STYLE.low;

  return (
    <div className={`rounded-xl overflow-hidden border bg-black/60 backdrop-blur-md ${style.border}`}>
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.06]">
        <p className="text-xs font-medium text-white/50">Host Recommendation</p>
      </div>
      <div className="p-4">
        <AnimatePresence mode="wait">
          {!rec ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-6 text-center">
              <p className="text-white/30 text-sm">Run an analysis to get recommendations</p>
            </motion.div>
          ) : (
            <motion.div key={rec.primary_action} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
              <p className="text-sm text-white/80 leading-relaxed mb-3">{rec.primary_action}</p>
              {rec.secondary_actions.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {rec.secondary_actions.map((action, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-white/20 mt-0.5 text-xs">-</span>
                      <p className="text-xs text-white/50 leading-relaxed">{action}</p>
                    </div>
                  ))}
                </div>
              )}
              {rec.reasoning && (
                <div className="bg-white/[0.06] rounded-lg px-3 py-2 mb-3">
                  <p className="text-xs text-white/30 leading-relaxed">{rec.reasoning}</p>
                </div>
              )}
              <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${style.dot} ${rec.urgency === "critical" || rec.urgency === "high" ? "animate-pulse-dot" : ""}`} />
                  <span className="text-xs text-white/40">{style.label} priority</span>
                </div>
                {updatedAt && <span className="text-xs text-white/20 font-mono">{updatedAt}</span>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
