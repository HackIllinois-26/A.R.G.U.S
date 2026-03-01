"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

const API_BASE = process.env.NEXT_PUBLIC_ARGUS_API ?? "https://girishskandhas--argus";
const EP = `${API_BASE}-api-history.modal.run`;

interface RushHour {
  hour: number;
  sessions: number;
  avg_turn_min: number;
}

interface TableStat {
  table_id: string;
  total_sessions: number;
  avg_turn_min: number;
  avg_stress: number;
  avg_engagement: number;
  issue_count: number;
}

interface PartySizeStat {
  party_size: number;
  count: number;
  avg_turn_min: number;
}

interface Stats {
  total_sessions: number;
  avg_turn_min: number;
  median_turn_min: number;
  rush_hours: RushHour[];
  peak_hour: RushHour | null;
  fastest_tables: TableStat[];
  slowest_tables: TableStat[];
  stress_incidents: number;
  linger_incidents: number;
  busiest_day_sessions: number;
  avg_daily_sessions: number;
  party_size_breakdown: PartySizeStat[];
  table_stats: TableStat[];
}

interface Insights {
  overall_grade: string;
  grade_reasoning: string;
  rush_analysis: { peak_hours: string; recommendation: string };
  table_performance: { best_tables: string; worst_tables: string; recommendation: string };
  service_quality: { stress_summary: string; engagement_summary: string; recommendation: string };
  improvement_areas: string[];
  waiter_recommendations: { high_stress_tables: string; quick_turn_strategy: string; upsell_opportunities: string };
  inference_latency_ms?: number;
}

interface HistoryResult {
  stats: Stats;
  insights: Insights;
  total_sessions: number;
  processing_time_ms: number;
}

const fade = (delay: number) => ({
  initial: { opacity: 0, y: 16 } as const,
  animate: { opacity: 1, y: 0 } as const,
  transition: { duration: 0.4, delay },
});

const GRADE_COLOR: Record<string, string> = {
  A: "text-emerald-400 border-emerald-400/30 bg-emerald-400/[0.08]",
  B: "text-cyan-400 border-cyan-400/30 bg-cyan-400/[0.08]",
  C: "text-amber-400 border-amber-400/30 bg-amber-400/[0.08]",
  D: "text-orange-400 border-orange-400/30 bg-orange-400/[0.08]",
  F: "text-red-400 border-red-400/30 bg-red-400/[0.08]",
};

function formatHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

export default function HistoryPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HistoryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(EP, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: HistoryResult = await r.json();
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reach Modal backend");
    } finally {
      setLoading(false);
    }
  }, []);

  if (!result && !loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-argus-text mb-3">Historical Analytics</h1>
          <p className="text-lg text-argus-muted max-w-lg mx-auto">
            Analyze 6 weeks of dining data using AI inference on Modal.
            Rush patterns, table performance, service quality, and actionable improvements.
          </p>
        </div>
        <button
          onClick={runAnalysis}
          className="px-8 py-3 rounded-full text-base font-semibold bg-cyan-500/15 text-cyan-400 border border-cyan-400/30 hover:bg-cyan-500/25 transition-colors cursor-pointer"
        >
          Run Analysis
        </button>
        {error && (
          <p className="text-sm text-red-400 mt-2">{error}</p>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
        <div className="relative w-20 h-20 flex items-center justify-center">
          <div className="absolute w-20 h-20 rounded-full border border-cyan-400/40 animate-ring-pulse" />
          <div className="absolute w-12 h-12 rounded-full border border-cyan-400/20 animate-ring-pulse [animation-delay:0.4s]" />
          <svg className="animate-spin h-6 w-6 text-cyan-400" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-lg text-argus-text font-semibold">Running AI Analysis</p>
          <p className="text-sm text-argus-dim mt-1">
            Crunching 8,400 sessions in sandboxed containers + LLM inference...
          </p>
        </div>
      </div>
    );
  }

  const { stats, insights } = result!;
  const gradeStyle = GRADE_COLOR[insights.overall_grade] ?? GRADE_COLOR.C;

  return (
    <div className="pb-20">
      {/* Header */}
      <motion.div {...fade(0)} className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-argus-text">Historical Analytics</h1>
          <p className="text-sm text-argus-dim mt-1">
            {stats.total_sessions.toLocaleString()} sessions analyzed in {(result!.processing_time_ms / 1000).toFixed(1)}s
            {insights.inference_latency_ms && ` (LLM: ${(insights.inference_latency_ms / 1000).toFixed(1)}s)`}
          </p>
        </div>
        <button
          onClick={runAnalysis}
          disabled={loading}
          className="px-5 py-2 rounded-full text-sm font-medium border border-white/[0.08] text-argus-muted hover:text-argus-text hover:bg-white/[0.04] transition-colors cursor-pointer disabled:opacity-50"
        >
          Re-run
        </button>
      </motion.div>

      {/* Grade + top stats */}
      <motion.div {...fade(0.05)} className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
        <div className={`rounded-2xl border p-5 text-center ${gradeStyle}`}>
          <p className="text-[10px] uppercase tracking-widest opacity-70 mb-1">Overall Grade</p>
          <p className="text-5xl font-black">{insights.overall_grade}</p>
          <p className="text-xs mt-2 opacity-70">{insights.grade_reasoning}</p>
        </div>
        {[
          { label: "Avg Turn", value: `${stats.avg_turn_min}m`, color: "text-argus-text" },
          { label: "Peak Hour", value: stats.peak_hour ? formatHour(stats.peak_hour.hour) : "--", sub: stats.peak_hour ? `${stats.peak_hour.sessions} sessions` : "", color: "text-cyan-400" },
          { label: "Stress Events", value: stats.stress_incidents.toString(), sub: `${((stats.stress_incidents / stats.total_sessions) * 100).toFixed(1)}% of sessions`, color: stats.stress_incidents > 500 ? "text-red-400" : "text-amber-400" },
          { label: "Avg Daily", value: Math.round(stats.avg_daily_sessions).toString(), sub: "sessions/day", color: "text-emerald-400" },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 text-center">
            <p className="text-[10px] uppercase tracking-widest text-argus-dim mb-2">{s.label}</p>
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
            {s.sub && <p className="text-xs text-argus-dim mt-1">{s.sub}</p>}
          </div>
        ))}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Rush Analysis */}
        <motion.div {...fade(0.1)} className="glass rounded-2xl p-6 border border-white/[0.08]">
          <h2 className="text-lg font-bold text-argus-text mb-1">Rush Patterns</h2>
          <p className="text-sm text-argus-muted mb-4">{insights.rush_analysis.peak_hours}</p>

          <div className="space-y-1.5 mb-4">
            {stats.rush_hours
              .sort((a, b) => b.sessions - a.sessions)
              .slice(0, 8)
              .map((rh) => {
                const maxSessions = Math.max(...stats.rush_hours.map((r) => r.sessions));
                const pct = (rh.sessions / maxSessions) * 100;
                return (
                  <div key={rh.hour} className="flex items-center gap-3">
                    <span className="text-xs text-argus-dim w-14 text-right font-mono">{formatHour(rh.hour)}</span>
                    <div className="flex-1 h-5 rounded bg-white/[0.03] overflow-hidden">
                      <div
                        className="h-full rounded bg-cyan-400/30"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-argus-muted w-12 font-mono">{rh.sessions}</span>
                  </div>
                );
              })}
          </div>

          <div className="rounded-xl bg-cyan-400/[0.06] border border-cyan-400/15 p-3">
            <p className="text-xs text-cyan-400 font-semibold mb-1">AI Recommendation</p>
            <p className="text-sm text-argus-muted">{insights.rush_analysis.recommendation}</p>
          </div>
        </motion.div>

        {/* Table Performance */}
        <motion.div {...fade(0.15)} className="glass rounded-2xl p-6 border border-white/[0.08]">
          <h2 className="text-lg font-bold text-argus-text mb-4">Table Performance</h2>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-emerald-400 mb-2">Fastest Tables</p>
              {stats.fastest_tables.map((t) => (
                <div key={t.table_id} className="flex justify-between py-1.5 border-b border-white/[0.04] last:border-0">
                  <span className="text-sm text-argus-text">T{t.table_id}</span>
                  <span className="text-sm text-emerald-400 font-mono">{t.avg_turn_min}m</span>
                </div>
              ))}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-red-400 mb-2">Slowest Tables</p>
              {stats.slowest_tables.map((t) => (
                <div key={t.table_id} className="flex justify-between py-1.5 border-b border-white/[0.04] last:border-0">
                  <span className="text-sm text-argus-text">T{t.table_id}</span>
                  <span className="text-sm text-red-400 font-mono">{t.avg_turn_min}m</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-sm text-argus-muted mb-2">{insights.table_performance.best_tables}</p>
          <p className="text-sm text-argus-muted mb-3">{insights.table_performance.worst_tables}</p>

          <div className="rounded-xl bg-cyan-400/[0.06] border border-cyan-400/15 p-3">
            <p className="text-xs text-cyan-400 font-semibold mb-1">AI Recommendation</p>
            <p className="text-sm text-argus-muted">{insights.table_performance.recommendation}</p>
          </div>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Service Quality */}
        <motion.div {...fade(0.2)} className="glass rounded-2xl p-6 border border-white/[0.08]">
          <h2 className="text-lg font-bold text-argus-text mb-4">Service Quality</h2>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 text-center">
              <p className="text-[10px] uppercase tracking-widest text-argus-dim mb-1">Stress Rate</p>
              <p className="text-2xl font-bold text-amber-400">
                {((stats.stress_incidents / stats.total_sessions) * 100).toFixed(1)}%
              </p>
            </div>
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 text-center">
              <p className="text-[10px] uppercase tracking-widest text-argus-dim mb-1">Linger Rate</p>
              <p className="text-2xl font-bold text-orange-400">
                {((stats.linger_incidents / stats.total_sessions) * 100).toFixed(1)}%
              </p>
            </div>
          </div>

          <p className="text-sm text-argus-muted mb-2">{insights.service_quality.stress_summary}</p>
          <p className="text-sm text-argus-muted mb-3">{insights.service_quality.engagement_summary}</p>

          <div className="rounded-xl bg-cyan-400/[0.06] border border-cyan-400/15 p-3">
            <p className="text-xs text-cyan-400 font-semibold mb-1">AI Recommendation</p>
            <p className="text-sm text-argus-muted">{insights.service_quality.recommendation}</p>
          </div>
        </motion.div>

        {/* Waiter Recommendations */}
        <motion.div {...fade(0.25)} className="glass rounded-2xl p-6 border border-white/[0.08]">
          <h2 className="text-lg font-bold text-argus-text mb-4">Staff Optimization</h2>

          {[
            { label: "High-Stress Tables", value: insights.waiter_recommendations.high_stress_tables, color: "text-red-400" },
            { label: "Quick Turn Strategy", value: insights.waiter_recommendations.quick_turn_strategy, color: "text-emerald-400" },
            { label: "Upsell Opportunities", value: insights.waiter_recommendations.upsell_opportunities, color: "text-amber-400" },
          ].map((item) => (
            <div key={item.label} className="mb-4 last:mb-0">
              <p className={`text-xs font-semibold ${item.color} mb-1`}>{item.label}</p>
              <p className="text-sm text-argus-muted">{item.value}</p>
            </div>
          ))}
        </motion.div>
      </div>

      {/* Improvements */}
      <motion.div {...fade(0.3)} className="glass rounded-2xl p-6 border border-white/[0.08] mb-8">
        <h2 className="text-lg font-bold text-argus-text mb-4">Areas for Improvement</h2>
        <div className="space-y-3">
          {insights.improvement_areas.map((area, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-cyan-400/[0.1] border border-cyan-400/20 flex items-center justify-center text-xs text-cyan-400 font-bold">
                {i + 1}
              </span>
              <p className="text-base text-argus-muted">{area}</p>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Party Size Breakdown */}
      <motion.div {...fade(0.35)} className="glass rounded-2xl p-6 border border-white/[0.08]">
        <h2 className="text-lg font-bold text-argus-text mb-4">Turn Time by Party Size</h2>
        <div className="grid grid-cols-5 gap-3">
          {stats.party_size_breakdown.map((ps) => (
            <div key={ps.party_size} className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 text-center">
              <p className="text-2xl font-bold text-argus-text">{ps.party_size}</p>
              <p className="text-[10px] uppercase tracking-widest text-argus-dim mb-2">guests</p>
              <p className="text-lg font-bold text-cyan-400">{ps.avg_turn_min}m</p>
              <p className="text-[10px] text-argus-dim">{ps.count} sessions</p>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
