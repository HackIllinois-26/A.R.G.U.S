"use client";

import { AnimatedCounter } from "./AnimatedCounter";
import type { AnalysisStats } from "../../types/argus";

interface Props {
  stats: AnalysisStats | null;
  sessionTotal: number;
  peakContainers: number;
  isRushHour: boolean;
}

export function StatsBar({ stats, sessionTotal, isRushHour }: Props) {
  const pSec = stats ? stats.parallel_latency_ms / 1000 : 0;
  const sSec = stats ? stats.sequential_estimate_ms / 1000 : 0;
  const speedup = sSec > 0 ? sSec / Math.max(pSec, 0.1) : 0;
  const parPct = sSec > 0 ? Math.max(2, (pSec / sSec) * 100) : 0;

  return (
    <div className="glass rounded-2xl p-4 mb-4">
      {/* header */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2 h-2 rounded-full animate-pulse-dot ${isRushHour ? "bg-red-500" : "bg-emerald-500"}`} />
        <span className="text-[10px] font-semibold tracking-[0.15em] uppercase text-argus-dim">
          Modal Inference
        </span>
        {isRushHour && (
          <span className="ml-auto text-[10px] font-semibold tracking-wider uppercase bg-red-600 text-white px-2 py-0.5 rounded">
            Rush Hour
          </span>
        )}
      </div>

      {/* big numbers */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="text-center">
          <AnimatedCounter value={sessionTotal} className="text-2xl font-bold text-argus-text" />
          <p className="text-[10px] font-semibold tracking-wider uppercase text-argus-dim mt-1">analyzed</p>
        </div>
        <div className="text-center border-x border-argus-border/50">
          <AnimatedCounter value={stats?.modal_invocations ?? 0} className="text-2xl font-bold text-argus-text" />
          <p className="text-[10px] font-semibold tracking-wider uppercase text-argus-dim mt-1">invocations</p>
        </div>
        <div className="text-center">
          <AnimatedCounter value={pSec} decimals={1} suffix="s" className="text-2xl font-bold text-emerald-400" />
          <p className="text-[10px] font-semibold tracking-wider uppercase text-argus-dim mt-1">latency</p>
        </div>
      </div>

      {/* bars */}
      {stats && (
        <div className="border-t border-argus-border pt-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-[72px] text-[10px] font-semibold tracking-wider uppercase text-argus-dim">Sequential</span>
            <div className="flex-1 h-2 bg-argus-card rounded-full overflow-hidden">
              <div className="h-full bg-argus-faint rounded-full w-full" />
            </div>
            <span className="w-10 text-right text-[10px] font-semibold text-argus-dim">{sSec.toFixed(0)}s</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-[72px] text-[10px] font-semibold tracking-wider uppercase text-argus-dim">Parallel</span>
            <div className="flex-1 h-2 bg-argus-card rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500" style={{ width: `${parPct}%` }} />
            </div>
            <span className="w-10 text-right text-[10px] font-semibold text-emerald-400">{pSec.toFixed(1)}s</span>
          </div>
          <div className="flex justify-end items-center gap-2 mt-1">
            <span className="text-[10px] font-semibold tracking-wider uppercase text-argus-dim">Speedup</span>
            <AnimatedCounter value={speedup} decimals={1} suffix="x" className="text-lg font-extrabold text-emerald-400" />
          </div>
        </div>
      )}
    </div>
  );
}
