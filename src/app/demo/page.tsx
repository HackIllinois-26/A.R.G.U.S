"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";

/* ── types ─────────────────────────────────────────────────────────────── */

interface Biometrics {
  stress: number;
  engagement: number;
  patience: number;
  movement: number;
  heart_rate: number;
}

interface TableEntry {
  id: number;
  state: string;
  guests: number;
  wait_time: string;
  seated_since: number;
  biometrics: Biometrics | null;
}

interface PersonEntry {
  id: number;
  status: string;
  table_id: number | null;
}

interface TimelineEntry {
  t: number;
  vl_state: string;
  vl_confidence: number;
  total_guests: number;
  seated: number;
  standing: number;
  energy_level: string;
  service_activity: string;
  body_language: string;
  behavioral_notes: string;
  tables: TableEntry[];
  persons: PersonEntry[];
}

interface Timeline {
  duration: number;
  fps: number;
  frames: number;
  entries: TimelineEntry[];
}

/* ── style maps ────────────────────────────────────────────────────────── */

const STATE_COLORS: Record<string, string> = {
  EMPTY: "text-slate-400",
  JUST_SEATED: "text-blue-400",
  MID_MEAL: "text-emerald-400",
  FINISHING: "text-orange-400",
  CHECK_STAGE: "text-red-400",
};

const STATE_BG: Record<string, string> = {
  EMPTY: "bg-slate-500/10 border-slate-500/20",
  JUST_SEATED: "bg-blue-500/10 border-blue-500/20",
  MID_MEAL: "bg-emerald-500/10 border-emerald-500/20",
  FINISHING: "bg-orange-500/10 border-orange-500/20",
  CHECK_STAGE: "bg-red-500/10 border-red-500/20",
};

const STATE_DOT: Record<string, string> = {
  EMPTY: "bg-slate-400",
  JUST_SEATED: "bg-blue-400",
  MID_MEAL: "bg-emerald-400",
  FINISHING: "bg-orange-400",
  CHECK_STAGE: "bg-red-400",
};

const STATE_LABELS: Record<string, string> = {
  EMPTY: "Empty",
  JUST_SEATED: "Just Seated",
  MID_MEAL: "Mid Meal",
  FINISHING: "Finishing",
  CHECK_STAGE: "Check Stage",
};

const STATE_ACCENT: Record<string, string> = {
  EMPTY: "border-l-slate-400",
  JUST_SEATED: "border-l-blue-400",
  MID_MEAL: "border-l-emerald-400",
  FINISHING: "border-l-orange-400",
  CHECK_STAGE: "border-l-red-400",
};

/* ── small components ──────────────────────────────────────────────────── */

function BiometricBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] text-argus-dim w-[68px] shrink-0">
        {label}
      </span>
      <div className="flex-1 h-1 rounded-full bg-argus-card overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="text-[9px] text-argus-muted w-7 text-right font-mono">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

function TableCard({
  table,
  expanded,
  onToggle,
}: {
  table: TableEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const bg = STATE_BG[table.state] ?? STATE_BG.EMPTY;
  const dot = STATE_DOT[table.state] ?? STATE_DOT.EMPTY;
  const color = STATE_COLORS[table.state] ?? STATE_COLORS.EMPTY;
  const label = STATE_LABELS[table.state] ?? table.state;
  const accent = STATE_ACCENT[table.state] ?? STATE_ACCENT.EMPTY;
  const bio = table.biometrics;

  return (
    <div
      className={`rounded-lg border border-l-[3px] ${accent} ${bg} transition-all duration-500 cursor-pointer`}
      onClick={onToggle}
    >
      <div className="p-2.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-bold text-argus-muted">
            Table {table.id}
          </span>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${dot}`} />
            <span className={`text-[10px] font-semibold ${color}`}>
              {label}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px]">
          <span className="text-argus-dim">
            {table.guests > 0 ? `${table.guests} guests` : "No guests"}
          </span>
          <span
            className={`font-mono ${
              table.state === "EMPTY"
                ? "text-emerald-400"
                : table.state === "CHECK_STAGE"
                ? "text-red-400"
                : "text-argus-muted"
            }`}
          >
            {table.wait_time}
          </span>
        </div>
      </div>

      {expanded && bio && (
        <div className="px-2.5 pb-2.5 pt-1 border-t border-white/5 space-y-1.5">
          <BiometricBar label="Stress" value={bio.stress} color="bg-red-500" />
          <BiometricBar
            label="Engagement"
            value={bio.engagement}
            color="bg-emerald-500"
          />
          <BiometricBar
            label="Patience"
            value={bio.patience}
            color="bg-blue-500"
          />
          <BiometricBar
            label="Movement"
            value={bio.movement}
            color="bg-amber-500"
          />
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[9px] text-argus-dim">Heart Rate</span>
            <span className="text-sm font-bold text-red-400 font-mono">
              {bio.heart_rate}
            </span>
            <span className="text-[9px] text-argus-dim">BPM</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── main page ─────────────────────────────────────────────────────────── */

export default function DemoPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasVideo, setHasVideo] = useState(true);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [expandedTable, setExpandedTable] = useState<number | null>(null);

  useEffect(() => {
    fetch("/demo/analysis_timeline.json")
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data: Timeline) => setTimeline(data))
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setFrameCount((p) => p + 1), 1000 / 12);
    return () => clearInterval(interval);
  }, []);

  const findEntry = useCallback(
    (time: number): TimelineEntry | null => {
      if (!timeline || timeline.entries.length === 0) return null;
      const looped = timeline.duration > 0 ? time % timeline.duration : 0;
      let best = timeline.entries[0];
      for (const e of timeline.entries) {
        if (e.t <= looped) best = e;
        else break;
      }
      return best;
    },
    [timeline]
  );

  const current = findEntry(currentTime);

  const tables = useMemo(() => current?.tables ?? [], [current]);
  const persons = useMemo(() => current?.persons ?? [], [current]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentTime(v.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onError = () => setHasVideo(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("error", onError);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("error", onError);
    };
  }, []);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Live Demo</h1>
          <p className="text-xs text-argus-dim mt-0.5">
            Person tracking + table state machine + per-table Presage
            biometrics &mdash; powered by YOLOv8m &amp; Qwen2.5-VL on Modal
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              isPlaying ? "bg-emerald-400 animate-pulse-dot" : "bg-argus-dim"
            }`}
          />
          <span className="text-[10px] uppercase tracking-widest text-argus-dim">
            {isPlaying ? "Analyzing" : "Paused"}
          </span>
        </div>
      </div>

      {/* Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-4">
        {/* Video panel */}
        <div className="glass rounded-xl overflow-hidden">
          <div className="relative aspect-video bg-black">
            {hasVideo ? (
              <video
                ref={videoRef}
                className="w-full h-full object-contain"
                src="/demo/demo.mp4"
                autoPlay
                loop
                muted
                playsInline
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <div className="w-16 h-16 rounded-full border-2 border-cyan-500/30 flex items-center justify-center">
                  <div className="w-10 h-10 rounded-full border-2 border-cyan-500/50 animate-ring-pulse" />
                </div>
                <p className="text-sm text-argus-muted">
                  Demo video not found
                </p>
                <p className="text-xs text-argus-dim max-w-md text-center leading-relaxed">
                  Run{" "}
                  <code className="text-cyan-400">
                    modal run backend/demo_render.py
                  </code>{" "}
                  then download both files.
                </p>
              </div>
            )}
          </div>

          {/* Stats strip */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-t border-argus-glass-border text-[10px] text-argus-dim">
            <span>
              FRAME{" "}
              <span className="text-argus-muted font-mono">
                {String(frameCount).padStart(4, "0")}
              </span>
            </span>
            <span>
              TIME{" "}
              <span className="text-argus-muted font-mono">
                {currentTime.toFixed(1)}s
              </span>
            </span>
            {current && (
              <>
                <span>
                  TRACKED{" "}
                  <span className="text-cyan-400">
                    {current.total_guests} persons
                  </span>
                </span>
                <span>
                  SEATED{" "}
                  <span className="text-emerald-400">{current.seated}</span>
                  {" / "}STANDING{" "}
                  <span className="text-amber-400">{current.standing}</span>
                </span>
                <span>
                  TABLES{" "}
                  <span className="text-blue-400">{tables.length}</span>
                </span>
              </>
            )}
            <span className="ml-auto">
              PIPELINE{" "}
              <span className="text-emerald-400">5 agents active</span>
            </span>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-3 overflow-y-auto max-h-[calc(100vh-180px)] pr-1">
          {loadError && !timeline && (
            <div className="glass rounded-xl p-3 border border-amber-500/20">
              <p className="text-xs text-amber-400">
                analysis_timeline.json not found &mdash; render and download
                from Modal first.
              </p>
            </div>
          )}

          {/* ── Table cards with per-table biometrics ── */}
          <div className="glass rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-widest text-argus-dim">
                Table States
              </span>
              <span className="text-[9px] text-argus-dim">
                tap to expand biometrics
              </span>
            </div>
            {tables.length > 0 ? (
              <div className="space-y-1.5">
                {tables.map((t) => (
                  <TableCard
                    key={t.id}
                    table={t}
                    expanded={expandedTable === t.id}
                    onToggle={() =>
                      setExpandedTable(expandedTable === t.id ? null : t.id)
                    }
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-argus-dim py-2">
                Waiting for tracking data...
              </p>
            )}
          </div>

          {/* ── Person tracking roster ── */}
          <div className="glass rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-widest text-argus-dim mb-2">
              Person Tracking
            </div>
            {persons.length > 0 ? (
              <div className="grid grid-cols-2 gap-1">
                {persons.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] ${
                      p.status === "Standing"
                        ? "bg-amber-500/10 text-amber-400"
                        : "bg-cyan-500/10 text-cyan-400"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        p.status === "Standing"
                          ? "bg-amber-400"
                          : "bg-cyan-400"
                      }`}
                    />
                    <span className="font-mono font-bold">P{p.id}</span>
                    <span className="text-argus-dim">{p.status}</span>
                    {p.table_id && (
                      <span className="ml-auto text-argus-muted font-mono">
                        T{p.table_id}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-argus-dim py-2">No persons tracked</p>
            )}
          </div>

          {/* ── Floor summary ── */}
          <div className="glass rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-widest text-argus-dim mb-2">
              Floor Summary
            </div>
            {current ? (
              <>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div className="bg-argus-surface/50 rounded-lg p-2 text-center">
                    <div className="text-lg font-bold">
                      {current.total_guests}
                    </div>
                    <div className="text-[9px] text-argus-dim">Total</div>
                  </div>
                  <div className="bg-argus-surface/50 rounded-lg p-2 text-center">
                    <div className="text-lg font-bold text-cyan-400">
                      {current.seated}
                    </div>
                    <div className="text-[9px] text-argus-dim">Seated</div>
                  </div>
                  <div className="bg-argus-surface/50 rounded-lg p-2 text-center">
                    <div className="text-lg font-bold text-amber-400">
                      {current.standing}
                    </div>
                    <div className="text-[9px] text-argus-dim">Standing</div>
                  </div>
                </div>
                <div className="flex gap-3 text-[10px] text-argus-muted">
                  <span>
                    Energy:{" "}
                    <span className="text-argus-text capitalize">
                      {current.energy_level}
                    </span>
                  </span>
                  <span>
                    Service:{" "}
                    <span className="text-argus-text capitalize">
                      {current.service_activity}
                    </span>
                  </span>
                </div>
              </>
            ) : (
              <p className="text-xs text-argus-dim">--</p>
            )}
          </div>

          {/* ── Behavioral analysis ── */}
          <div className="glass rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-widest text-argus-dim mb-2">
              Behavioral Analysis
            </div>
            {current ? (
              <div className="space-y-1.5">
                {current.body_language && (
                  <div>
                    <span className="text-[9px] text-argus-dim">
                      Body Language
                    </span>
                    <p className="text-[11px] text-argus-muted leading-relaxed">
                      {current.body_language}
                    </p>
                  </div>
                )}
                {current.behavioral_notes && (
                  <div>
                    <span className="text-[9px] text-argus-dim">Notes</span>
                    <p className="text-[11px] text-argus-muted leading-relaxed">
                      {current.behavioral_notes}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-argus-dim">--</p>
            )}
          </div>

          {/* ── Agent pipeline ── */}
          <div className="glass rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-widest text-argus-dim mb-2">
              Agent Pipeline
            </div>
            <div className="space-y-1">
              {[
                ["Vision Classifier", "CLIP + Qwen2.5-VL"],
                ["Person Tracker", "YOLOv8m + IoU"],
                ["Turn Predictor", "Llama 3.1 8B"],
                ["Anomaly Detector", "Llama 3.1 8B + Sandbox"],
                ["Host Recommender", "Llama 3.1 70B"],
                ["Memory Writer", "Supermemory"],
              ].map(([name, model]) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-dot" />
                  <span className="text-[10px] text-argus-muted flex-1">
                    {name}
                  </span>
                  <span className="text-[9px] text-argus-dim font-mono">
                    {model}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
