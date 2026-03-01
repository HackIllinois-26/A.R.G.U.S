"use client";

const LOCATIONS = [
  { name: "Downtown Flagship", avgTurn: 52, peakHour: "7:30 PM", avgStress: 0.22 },
  { name: "Midtown Bistro", avgTurn: 48, peakHour: "8:00 PM", avgStress: 0.18 },
  { name: "Waterfront Grill", avgTurn: 61, peakHour: "7:00 PM", avgStress: 0.31 },
  { name: "Airport Terminal 3", avgTurn: 35, peakHour: "12:30 PM", avgStress: 0.42 },
  { name: "Suburban Family", avgTurn: 58, peakHour: "6:30 PM", avgStress: 0.15 },
];

const PATTERNS = [
  { label: "Busiest day", value: "Saturday", detail: "38% more sessions than weekday avg" },
  { label: "Highest stress time", value: "7:45 – 8:15 PM", detail: "Wait times peak, kitchen bottleneck" },
  { label: "Fastest location", value: "Airport Terminal 3", detail: "35m avg turn, travelers eat quickly" },
  { label: "Most lingering", value: "Waterfront Grill", detail: "22% of sessions exceed 90 minutes" },
];

function stressColor(v: number) {
  if (v > 0.5) return "text-red-400";
  if (v > 0.3) return "text-amber-400";
  return "text-emerald-400";
}

export default function InsightsPage() {
  return (
    <>
      <h1 className="text-2xl md:text-3xl font-extrabold tracking-[0.25em] font-mono text-argus-text mb-1">Insights</h1>
      <p className="text-[10px] tracking-[0.15em] uppercase text-argus-dim mb-8">6 weeks of historical analysis</p>

      {/* summary metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {[
          { t: "Total Sessions", v: "8,400", s: "across 5 locations", g: "from-emerald-950 to-emerald-900/80" },
          { t: "Avg Turn Time", v: "51m", s: "all locations", g: "from-slate-800 to-slate-900" },
          { t: "Stress Incidents", v: "847", s: "peak stress > 0.7", g: "from-red-950 to-red-900/80" },
          { t: "Lingering Tables", v: "312", s: "> 90 min sessions", g: "from-amber-950 to-amber-900/80" },
        ].map(m => (
          <div key={m.t} className={`bg-gradient-to-br ${m.g} border border-argus-glass-border rounded-xl p-4`}>
            <p className="text-[10px] font-semibold tracking-wider uppercase text-argus-muted mb-2">{m.t}</p>
            <p className="text-3xl font-extrabold text-argus-text">{m.v}</p>
            <p className="text-[10px] font-medium text-argus-dim mt-1">{m.s}</p>
          </div>
        ))}
      </div>

      {/* per-location */}
      <h2 className="text-[10px] font-semibold tracking-[0.2em] uppercase text-argus-muted mb-4">By Location</h2>
      <div className="space-y-3 mb-8">
        {LOCATIONS.map(loc => (
          <div key={loc.name} className="glass rounded-xl p-4">
            <p className="text-sm font-semibold text-argus-text mb-3">{loc.name}</p>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xl font-bold text-argus-text">{loc.avgTurn}m</p>
                <p className="text-[10px] font-semibold tracking-wider uppercase text-argus-dim mt-1">Avg Turn</p>
              </div>
              <div className="border-x border-argus-border/40">
                <p className="text-xl font-bold text-argus-text">{loc.peakHour}</p>
                <p className="text-[10px] font-semibold tracking-wider uppercase text-argus-dim mt-1">Peak Hour</p>
              </div>
              <div>
                <p className={`text-xl font-bold ${stressColor(loc.avgStress)}`}>{Math.round(loc.avgStress*100)}%</p>
                <p className="text-[10px] font-semibold tracking-wider uppercase text-argus-dim mt-1">Avg Stress</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* patterns */}
      <h2 className="text-[10px] font-semibold tracking-[0.2em] uppercase text-argus-muted mb-4">Key Patterns</h2>
      <div className="glass rounded-xl divide-y divide-argus-border">
        {PATTERNS.map(p => (
          <div key={p.label} className="px-4 py-3">
            <p className="text-[10px] font-semibold tracking-wider uppercase text-argus-dim mb-1">{p.label}</p>
            <p className="text-sm font-semibold text-argus-text">{p.value}</p>
            <p className="text-xs text-argus-muted mt-0.5">{p.detail}</p>
          </div>
        ))}
      </div>
    </>
  );
}
