"use client";

import { motion } from "framer-motion";

const fade = (delay: number) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.55, delay },
});

const TECH = [
  {
    name: "Modal Labs",
    desc: "Serverless GPU cloud that runs every agent, sandbox, and training job. Scales from zero to 8 A100s in seconds.",
  },
  {
    name: "YOLOv8m",
    desc: "Real-time person detection from overhead cameras. Tracks individuals across frames with IoU-based matching.",
  },
  {
    name: "CLIP ViT-L/14",
    desc: "Fine-tuned vision transformer that classifies each table into one of five dining states from a single frame.",
  },
  {
    name: "Llama 3.1 8B",
    desc: "Powers the Turn Predictor and Anomaly Detector. Fast reasoning for time estimates and statistical outlier detection.",
  },
  {
    name: "Llama 3.1 70B",
    desc: "Drives the Host Recommender. Synthesises all agent data into a single actionable recommendation for the host.",
  },
  {
    name: "Supermemory",
    desc: "Persistent long-term memory. Stores every table turn as a structured event so predictions sharpen over weeks.",
  },
  {
    name: "Presage",
    desc: "Biometric interpretation layer. Reads heart rate, engagement, frustration, and exit-directed movement from waiting guests.",
  },
  {
    name: "Next.js 15",
    desc: "React framework for the dashboard, demo player, history analytics, and this page. Server and client components.",
  },
];

const AGENTS = [
  {
    name: "Vision Classifier",
    model: "CLIP ViT-L/14",
    desc: "Reads a single overhead frame and classifies every table into one of five dining states.",
  },
  {
    name: "Turn Predictor",
    model: "Llama 3.1 8B + Supermemory",
    desc: "Pulls historical patterns from long-term memory and estimates minutes until the party leaves.",
  },
  {
    name: "Anomaly Detector",
    model: "Llama 3.1 8B",
    desc: "Catches statistical outliers like long waits, occupancy spikes, and tables that haven't been bussed.",
  },
  {
    name: "Host Recommender",
    model: "Llama 3.1 70B",
    desc: "Fuses every agent's output into one clear, natural-language action for the host.",
  },
  {
    name: "Memory Writer",
    model: "Supermemory",
    desc: "After each table turn, writes a structured event so the system gets smarter over weeks.",
  },
];

export default function AboutPage() {
  return (
    <div className="pb-24 overflow-hidden">
      {/* ── Hero (Headstarter-style) ── */}
      <div className="relative pt-24 pb-28 text-center">
        <motion.div
          {...fade(0)}
          className="inline-block px-5 py-1.5 rounded-full border border-white/[0.12] text-xs uppercase tracking-[0.3em] text-argus-muted mb-10"
        >
          Our Mission
        </motion.div>

        <motion.h1
          {...fade(0.05)}
          className="text-5xl sm:text-6xl lg:text-7xl font-light text-argus-text leading-tight max-w-4xl mx-auto"
        >
          About A.R.G.U.S.
        </motion.h1>

        <motion.p
          {...fade(0.1)}
          className="mt-8 text-lg sm:text-xl text-argus-muted max-w-3xl mx-auto leading-relaxed"
        >
          A.R.G.U.S. is building the all-seeing intelligence layer for restaurants.
        </motion.p>

        <motion.p
          {...fade(0.15)}
          className="mt-5 text-base text-argus-dim max-w-3xl mx-auto leading-relaxed px-4"
        >
          Named after Argus Panoptes, the hundred-eyed giant of Greek mythology who never
          slept, A.R.G.U.S. watches every table, every guest, every signal on the floor
          so the host always knows exactly what to do next.
        </motion.p>
      </div>

      {/* ── Tech Grid ── */}
      <motion.section {...fade(0.2)} className="max-w-6xl mx-auto mb-28 px-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {TECH.map((t, i) => (
            <motion.div
              key={t.name}
              {...fade(0.25 + i * 0.04)}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 hover:bg-white/[0.04] hover:border-white/[0.14] transition-all duration-300"
            >
              <h3 className="text-lg font-bold text-argus-text mb-2">{t.name}</h3>
              <p className="text-sm text-argus-muted leading-relaxed">{t.desc}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* ── How it works ── */}
      <motion.section {...fade(0.5)} className="max-w-4xl mx-auto mb-28 px-4">
        <p className="text-xs uppercase tracking-[0.3em] text-cyan-400/50 font-semibold mb-4">How it works</p>
        <h2 className="text-4xl sm:text-5xl font-bold text-argus-text leading-tight mb-8">
          60-second cycles.<br />Always learning.
        </h2>
        <div className="grid sm:grid-cols-2 gap-6">
          <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-8">
            <p className="text-5xl font-black text-cyan-400 mb-3">60s</p>
            <p className="text-lg text-argus-muted leading-relaxed">
              Every minute, A.R.G.U.S. scans the overhead camera, detects every person,
              classifies table states, predicts departures, flags anomalies, and delivers
              one clear recommendation to the host.
            </p>
          </div>
          <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-8">
            <p className="text-5xl font-black text-cyan-400 mb-3">&infin;</p>
            <p className="text-lg text-argus-muted leading-relaxed">
              Every table turn is written to long-term memory. Over days and weeks, predictions
              sharpen. The system learns the rhythms of each table, each shift, each season.
            </p>
          </div>
        </div>
      </motion.section>

      {/* ── Agents ── */}
      <motion.section {...fade(0.6)} className="max-w-4xl mx-auto px-4">
        <p className="text-xs uppercase tracking-[0.3em] text-cyan-400/50 font-semibold mb-4">Architecture</p>
        <h2 className="text-4xl sm:text-5xl font-bold text-argus-text leading-tight mb-10">
          Five agents. One brain.
        </h2>
        <div className="space-y-4">
          {AGENTS.map((a, i) => (
            <motion.div
              key={a.name}
              {...fade(0.65 + i * 0.05)}
              className="group rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.1] transition-all duration-300 p-6 sm:p-8"
            >
              <div className="flex items-baseline gap-3 mb-2 flex-wrap">
                <span className="text-2xl font-black text-cyan-400/30 font-mono select-none">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="text-xl font-bold text-argus-text">{a.name}</h3>
                <span className="text-sm text-argus-dim font-mono opacity-60">{a.model}</span>
              </div>
              <p className="text-lg text-argus-muted leading-relaxed pl-10">{a.desc}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>
    </div>
  );
}
