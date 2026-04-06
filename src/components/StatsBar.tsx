"use client";

import { AnimatedCounter } from "./AnimatedCounter";
import type { AnalysisStats } from "../../types/argus";

interface Props {
  stats: AnalysisStats | null;
  sessionTotal: number;
  peakContainers: number;
  isRushHour: boolean;
  waitingCount: number;
  autoRefresh: boolean;
}

export function StatsBar({ stats, sessionTotal, isRushHour, waitingCount, autoRefresh }: Props) {
  const pSec = stats ? stats.parallel_latency_ms / 1000 : 0;
  const sSec = stats ? stats.sequential_estimate_ms / 1000 : 0;
  const speedup = sSec > 0 ? sSec / Math.max(pSec, 0.1) : 0;
  const parPct = sSec > 0 ? Math.max(2, (pSec / sSec) * 100) : 0;

  return (
    <div className="rounded-xl border border-white/[0.10] bg-black/60 backdrop-blur-md p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-1.5 h-1.5 rounded-full ${isRushHour ? "bg-red-500 animate-pulse-dot" : autoRefresh ? "bg-emerald-500 animate-pulse-dot" : "bg-white/20"}`} />
        <span className="text-xs font-medium text-white/50">Modal Inference</span>
        <div className="ml-auto flex items-center gap-2">
          {autoRefresh && !isRushHour && (
            <span className="text-xs font-medium bg-emerald-500/[0.08] text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/15">Live</span>
          )}
          {isRushHour && (
            <span className="text-xs font-medium bg-red-500/[0.08] text-red-400 px-2 py-0.5 rounded-full border border-red-500/15">Rush Hour</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="text-center">
          <AnimatedCounter value={sessionTotal} className="text-xl font-semibold text-white" />
          <p className="text-xs text-white/40 mt-1">Analyzed</p>
        </div>
        <div className="text-center border-x border-white/[0.06]">
          <AnimatedCounter value={stats?.modal_invocations ?? 0} className="text-xl font-semibold text-white" />
          <p className="text-xs text-white/40 mt-1">Invocations</p>
        </div>
        <div className="text-center border-r border-white/[0.06]">
          <AnimatedCounter value={pSec} decimals={1} suffix="s" className="text-xl font-semibold text-emerald-400" />
          <p className="text-xs text-white/40 mt-1">Latency</p>
        </div>
        <div className="text-center">
          <AnimatedCounter value={waitingCount} className="text-xl font-semibold text-orange-400" />
          <p className="text-xs text-white/40 mt-1">Waiting</p>
        </div>
      </div>

      {stats && (
        <div className="border-t border-white/[0.06] pt-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-16 text-xs text-white/40">Sequential</span>
            <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
              <div className="h-full bg-white/15 rounded-full w-full" />
            </div>
            <span className="w-10 text-right text-xs text-white/40">{sSec.toFixed(0)}s</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-xs text-white/40">Parallel</span>
            <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${parPct}%` }} />
            </div>
            <span className="w-10 text-right text-xs text-emerald-400">{pSec.toFixed(1)}s</span>
          </div>
          <div className="flex justify-end items-center gap-2 mt-1">
            <span className="text-xs text-white/40">Speedup</span>
            <AnimatedCounter value={speedup} decimals={1} suffix="x" className="text-base font-semibold text-emerald-400" />
          </div>
        </div>
      )}
    </div>
  );
}
