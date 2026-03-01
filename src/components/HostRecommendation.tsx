"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { HostRecommendation as Rec } from "../../types/argus";

const URGENCY_STYLE: Record<string, { border: string; glow: string; icon: string }> = {
  low:      { border: "border-emerald-500/40", glow: "shadow-emerald-500/5", icon: "\u2705" },
  medium:   { border: "border-amber-500/40",   glow: "shadow-amber-500/5",   icon: "\u{1F7E1}" },
  high:     { border: "border-red-500/40",      glow: "shadow-red-500/10",    icon: "\u26A0\uFE0F" },
  critical: { border: "border-red-600/60",      glow: "shadow-red-600/20",    icon: "\u{1F6A8}" },
};

interface Props {
  recommendation: Rec | null;
  locationName: string;
  updatedAt?: string;
}

export function HostRecommendation({ recommendation, locationName, updatedAt }: Props) {
  const rec = recommendation;
  const style = URGENCY_STYLE[rec?.urgency ?? "low"] ?? URGENCY_STYLE.low;

  return (
    <div className={`glass rounded-2xl overflow-hidden border ${style.border} shadow-lg ${style.glow}`}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-argus-glass-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm">&#x1F9E0;</span>
            <span className="text-[11px] font-bold tracking-[0.15em] uppercase text-argus-muted">
              Host Recommendation
            </span>
          </div>
          <span className="text-[9px] text-argus-faint font-mono">
            {locationName}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <AnimatePresence mode="wait">
          {!rec ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="py-6 text-center"
            >
              <p className="text-argus-dim text-xs">
                Run an analysis to get recommendations
              </p>
            </motion.div>
          ) : (
            <motion.div
              key={rec.primary_action}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35 }}
            >
              {/* Primary action */}
              <div className="flex items-start gap-3 mb-4">
                <span className="text-2xl mt-0.5 shrink-0">{style.icon}</span>
                <p className="text-sm font-semibold text-argus-text leading-relaxed">
                  {rec.primary_action}
                </p>
              </div>

              {/* Secondary actions */}
              {rec.secondary_actions.length > 0 && (
                <div className="space-y-2 mb-4">
                  {rec.secondary_actions.map((action, i) => (
                    <div key={i} className="flex items-start gap-2 pl-1">
                      <span className="text-[10px] text-argus-faint mt-0.5">&#x25B8;</span>
                      <p className="text-xs text-argus-muted leading-relaxed">{action}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Reasoning */}
              {rec.reasoning && (
                <div className="bg-argus-surface/50 rounded-lg px-3 py-2 mb-3">
                  <p className="text-[10px] text-argus-dim leading-relaxed">
                    <span className="font-semibold text-argus-faint">Why: </span>
                    {rec.reasoning}
                  </p>
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between pt-2 border-t border-argus-glass-border/50">
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    rec.urgency === "critical" || rec.urgency === "high" ? "bg-red-500 animate-pulse-dot" :
                    rec.urgency === "medium" ? "bg-amber-500" : "bg-emerald-500"
                  }`} />
                  <span className="text-[10px] font-bold tracking-wider uppercase text-argus-dim">
                    {rec.urgency} priority
                  </span>
                </div>
                {updatedAt && (
                  <span className="text-[9px] text-argus-faint font-mono">{updatedAt}</span>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
