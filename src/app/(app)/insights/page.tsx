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
  if (v > 0.3) return "text-orange-400";
  return "text-emerald-400";
}

export default function InsightsPage() {
  return (
    <>
      <h1 className="text-3xl font-bold text-gradient mb-1">Insights</h1>
      <p className="text-sm text-white/40 mb-6">6 weeks of historical analysis</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { t: "Total Sessions", v: "8,400", s: "across 5 locations" },
          { t: "Avg Turn Time", v: "51m", s: "all locations" },
          { t: "Stress Incidents", v: "847", s: "peak stress > 0.7" },
          { t: "Lingering Tables", v: "312", s: "> 90 min sessions" },
        ].map(m => (
          <div key={m.t} className="rounded-xl border border-white/[0.10] bg-black/60 backdrop-blur-md p-4">
            <p className="text-xs text-white/40 mb-2">{m.t}</p>
            <p className="text-2xl font-semibold text-white">{m.v}</p>
            <p className="text-xs text-white/30 mt-1">{m.s}</p>
          </div>
        ))}
      </div>

      <h2 className="text-sm font-medium text-white/50 mb-3">By Location</h2>
      <div className="space-y-2 mb-6">
        {LOCATIONS.map(loc => (
          <div key={loc.name} className="rounded-xl border border-white/[0.10] bg-black/60 backdrop-blur-md p-4">
            <p className="text-sm font-medium text-white/90 mb-3">{loc.name}</p>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-lg font-semibold text-white">{loc.avgTurn}m</p>
                <p className="text-xs text-white/30 mt-1">Avg Turn</p>
              </div>
              <div className="border-x border-white/[0.06]">
                <p className="text-lg font-semibold text-white">{loc.peakHour}</p>
                <p className="text-xs text-white/30 mt-1">Peak Hour</p>
              </div>
              <div>
                <p className={`text-lg font-semibold ${stressColor(loc.avgStress)}`}>{Math.round(loc.avgStress * 100)}%</p>
                <p className="text-xs text-white/30 mt-1">Avg Stress</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <h2 className="text-sm font-medium text-white/50 mb-3">Key Patterns</h2>
      <div className="rounded-xl border border-white/[0.10] bg-black/60 backdrop-blur-md divide-y divide-white/[0.06]">
        {PATTERNS.map(p => (
          <div key={p.label} className="px-4 py-3">
            <p className="text-xs text-white/30 mb-0.5">{p.label}</p>
            <p className="text-sm font-medium text-white/90">{p.value}</p>
            <p className="text-xs text-white/50 mt-0.5">{p.detail}</p>
          </div>
        ))}
      </div>
    </>
  );
}
