"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";

interface Biometrics { stress: number; engagement: number; patience: number; movement: number; heart_rate: number; }
interface TableEntry { id: number; state: string; guests: number; wait_time: string; seated_since: number; biometrics: Biometrics | null; }
interface PersonEntry { id: number; status: string; table_id: number | null; }
interface TimelineEntry {
  t: number; vl_state: string; vl_confidence: number; total_guests: number;
  seated: number; standing: number; energy_level: string; service_activity: string;
  body_language: string; behavioral_notes: string; tables: TableEntry[]; persons: PersonEntry[];
}
interface Timeline { duration: number; fps: number; frames: number; entries: TimelineEntry[]; }

const STATE_COLORS: Record<string, string> = { EMPTY: "text-white/40", JUST_SEATED: "text-sky-400", MID_MEAL: "text-emerald-400", FINISHING: "text-orange-400", CHECK_STAGE: "text-red-400" };
const STATE_BG: Record<string, string> = { EMPTY: "bg-black/40 border-white/[0.08]", JUST_SEATED: "bg-sky-950/50 border-sky-500/20", MID_MEAL: "bg-emerald-950/50 border-emerald-500/20", FINISHING: "bg-orange-950/50 border-orange-500/20", CHECK_STAGE: "bg-red-950/50 border-red-500/20" };
const STATE_DOT: Record<string, string> = { EMPTY: "bg-white/30", JUST_SEATED: "bg-sky-400", MID_MEAL: "bg-emerald-400", FINISHING: "bg-orange-400", CHECK_STAGE: "bg-red-400" };
const STATE_LABELS: Record<string, string> = { EMPTY: "Empty", JUST_SEATED: "Just Seated", MID_MEAL: "Mid Meal", FINISHING: "Finishing", CHECK_STAGE: "Check Stage" };
const STATE_ACCENT: Record<string, string> = { EMPTY: "border-l-white/20", JUST_SEATED: "border-l-sky-400", MID_MEAL: "border-l-emerald-400", FINISHING: "border-l-orange-400", CHECK_STAGE: "border-l-red-400" };

function BiometricBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-white/40 w-[68px] shrink-0">{label}</span>
      <div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="text-xs text-white/50 w-8 text-right font-mono">{Math.round(value * 100)}%</span>
    </div>
  );
}

function DemoTableCard({ table, expanded, onToggle }: { table: TableEntry; expanded: boolean; onToggle: () => void }) {
  const bg = STATE_BG[table.state] ?? STATE_BG.EMPTY;
  const dot = STATE_DOT[table.state] ?? STATE_DOT.EMPTY;
  const color = STATE_COLORS[table.state] ?? STATE_COLORS.EMPTY;
  const label = STATE_LABELS[table.state] ?? table.state;
  const accent = STATE_ACCENT[table.state] ?? STATE_ACCENT.EMPTY;
  const bio = table.biometrics;

  return (
    <div className={`rounded-lg border border-l-[3px] ${accent} ${bg} transition-all duration-300 cursor-pointer`} onClick={onToggle}>
      <div className="p-2.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-white/80">Table {table.id}</span>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
            <span className={`text-xs font-medium ${color}`}>{label}</span>
          </div>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-white/40">{table.guests > 0 ? `${table.guests} guests` : "No guests"}</span>
          <span className={`font-mono ${table.state === "EMPTY" ? "text-emerald-400" : table.state === "CHECK_STAGE" ? "text-red-400" : "text-white/50"}`}>{table.wait_time}</span>
        </div>
      </div>
      {expanded && bio && (
        <div className="px-2.5 pb-2.5 pt-1 border-t border-white/[0.04] space-y-1.5">
          <BiometricBar label="Stress" value={bio.stress} color="bg-red-500" />
          <BiometricBar label="Engagement" value={bio.engagement} color="bg-emerald-500" />
          <BiometricBar label="Patience" value={bio.patience} color="bg-sky-500" />
          <BiometricBar label="Movement" value={bio.movement} color="bg-orange-500" />
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-xs text-white/40">Heart Rate</span>
            <span className="text-sm font-medium text-red-400 font-mono">{bio.heart_rate}</span>
            <span className="text-xs text-white/40">BPM</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DemoPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasVideo, setHasVideo] = useState(true);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [expandedTable, setExpandedTable] = useState<number | null>(null);

  useEffect(() => { fetch("/demo/analysis_timeline.json").then((r) => { if (!r.ok) throw new Error("Not found"); return r.json(); }).then((data: Timeline) => setTimeline(data)).catch(() => setLoadError(true)); }, []);
  useEffect(() => { const interval = setInterval(() => setFrameCount((p) => p + 1), 1000 / 12); return () => clearInterval(interval); }, []);

  const findEntry = useCallback((time: number): TimelineEntry | null => {
    if (!timeline || timeline.entries.length === 0) return null;
    const looped = timeline.duration > 0 ? time % timeline.duration : 0;
    let best = timeline.entries[0];
    for (const e of timeline.entries) { if (e.t <= looped) best = e; else break; }
    return best;
  }, [timeline]);

  const current = findEntry(currentTime);
  const tables = useMemo(() => current?.tables ?? [], [current]);
  const persons = useMemo(() => current?.persons ?? [], [current]);

  useEffect(() => {
    const v = videoRef.current; if (!v) return;
    const onTime = () => setCurrentTime(v.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onError = () => setHasVideo(false);
    v.addEventListener("timeupdate", onTime); v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause); v.addEventListener("error", onError);
    return () => { v.removeEventListener("timeupdate", onTime); v.removeEventListener("play", onPlay); v.removeEventListener("pause", onPause); v.removeEventListener("error", onError); };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gradient">Live Demo</h1>
          <p className="text-sm text-white/40 mt-0.5">Person tracking + table state classification + per-table biometrics</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${isPlaying ? "bg-emerald-400 animate-pulse-dot" : "bg-white/20"}`} />
          <span className="text-xs text-white/40">{isPlaying ? "Analyzing" : "Paused"}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
        <div className="rounded-xl border border-white/[0.10] bg-black/60 backdrop-blur-md overflow-hidden">
          <div className="relative aspect-video bg-black">
            {hasVideo ? (
              <video ref={videoRef} className="w-full h-full object-contain" src="/demo/demo.mp4" autoPlay loop muted playsInline />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <p className="text-sm text-white/50">Demo video not found</p>
                <p className="text-xs text-white/30 max-w-md text-center leading-relaxed">
                  Run <code className="text-emerald-400">modal run backend/demo_render.py</code> then download both files.
                </p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 border-t border-white/[0.06] text-xs text-white/40">
            <span>Frame <span className="text-white/70 font-mono">{String(frameCount).padStart(4, "0")}</span></span>
            <span>Time <span className="text-white/70 font-mono">{currentTime.toFixed(1)}s</span></span>
            {current && (<>
              <span>Tracked <span className="text-white/70">{current.total_guests} persons</span></span>
              <span>Seated <span className="text-emerald-400">{current.seated}</span> / Standing <span className="text-orange-400">{current.standing}</span></span>
              <span>Tables <span className="text-white/70">{tables.length}</span></span>
            </>)}
            <span className="ml-auto">Pipeline <span className="text-emerald-400">5 agents</span></span>
          </div>
        </div>

        <div className="space-y-3 overflow-y-auto max-h-[calc(100vh-180px)] pr-1">
          {loadError && !timeline && (
            <div className="rounded-lg border border-orange-500/20 bg-orange-500/[0.06] p-3">
              <p className="text-xs text-orange-400">analysis_timeline.json not found &mdash; render and download from Modal first.</p>
            </div>
          )}

          <div className="rounded-xl border border-white/[0.10] bg-black/60 backdrop-blur-md p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-white/50">Table States</span>
              <span className="text-xs text-white/20">tap to expand</span>
            </div>
            {tables.length > 0 ? (
              <div className="space-y-1.5">
                {tables.map((t) => (<DemoTableCard key={t.id} table={t} expanded={expandedTable === t.id} onToggle={() => setExpandedTable(expandedTable === t.id ? null : t.id)} />))}
              </div>
            ) : <p className="text-xs text-white/30 py-2">Waiting for tracking data...</p>}
          </div>

          <div className="rounded-xl border border-white/[0.10] bg-black/60 backdrop-blur-md p-3">
            <p className="text-xs font-medium text-white/50 mb-2">Person Tracking</p>
            {persons.length > 0 ? (
              <div className="grid grid-cols-2 gap-1">
                {persons.map((p) => (
                  <div key={p.id} className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${p.status === "Standing" ? "bg-orange-950/60 text-orange-400 border border-orange-500/15" : "bg-black/40 text-white/70 border border-white/[0.08]"}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${p.status === "Standing" ? "bg-orange-400" : "bg-white/30"}`} />
                    <span className="font-mono font-medium">P{p.id}</span>
                    <span className="text-white/40">{p.status}</span>
                    {p.table_id && <span className="ml-auto text-white/50 font-mono">T{p.table_id}</span>}
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-white/30 py-2">No persons tracked</p>}
          </div>

          <div className="rounded-xl border border-white/[0.10] bg-black/60 backdrop-blur-md p-3">
            <p className="text-xs font-medium text-white/50 mb-2">Floor Summary</p>
            {current ? (
              <>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {[
                    { v: current.total_guests, l: "Total", c: "text-white" },
                    { v: current.seated, l: "Seated", c: "text-emerald-400" },
                    { v: current.standing, l: "Standing", c: "text-orange-400" },
                  ].map(s => (
                    <div key={s.l} className="bg-black/40 rounded-lg p-2 text-center border border-white/[0.08]">
                      <div className={`text-base font-semibold ${s.c}`}>{s.v}</div>
                      <div className="text-xs text-white/30">{s.l}</div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 text-xs text-white/50">
                  <span>Energy: <span className="text-white/80 capitalize">{current.energy_level}</span></span>
                  <span>Service: <span className="text-white/80 capitalize">{current.service_activity}</span></span>
                </div>
              </>
            ) : <p className="text-xs text-white/30">--</p>}
          </div>

          <div className="rounded-xl border border-white/[0.10] bg-black/60 backdrop-blur-md p-3">
            <p className="text-xs font-medium text-white/50 mb-2">Behavioral Analysis</p>
            {current ? (
              <div className="space-y-1.5">
                {current.body_language && (<div><span className="text-xs text-white/30">Body Language</span><p className="text-xs text-white/60 leading-relaxed">{current.body_language}</p></div>)}
                {current.behavioral_notes && (<div><span className="text-xs text-white/30">Notes</span><p className="text-xs text-white/60 leading-relaxed">{current.behavioral_notes}</p></div>)}
              </div>
            ) : <p className="text-xs text-white/30">--</p>}
          </div>

          <div className="rounded-xl border border-white/[0.10] bg-black/60 backdrop-blur-md p-3">
            <p className="text-xs font-medium text-white/50 mb-2">Agent Pipeline</p>
            <div className="space-y-1">
              {[["Vision Classifier","CLIP + Qwen2.5-VL"],["Person Tracker","YOLOv8m + IoU"],["Turn Predictor","Llama 3.1 8B"],["Anomaly Detector","Llama 3.1 8B + Sandbox"],["Host Recommender","Llama 3.1 70B"],["Memory Writer","Supermemory"]].map(([name, model]) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="text-xs text-white/70 flex-1">{name}</span>
                  <span className="text-xs text-white/30 font-mono">{model}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
