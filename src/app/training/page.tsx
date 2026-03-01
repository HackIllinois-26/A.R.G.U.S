"use client";

import { motion } from "framer-motion";

const PIPELINE_STEPS = [
  {
    step: 1,
    title: "Upload Videos",
    desc: "Upload restaurant footage to the Modal Volume. Each video provides ~2,400 frames (at 1 frame/3sec for a 2hr video).",
    command: "modal volume put argus-training-data raw_videos/ ./your_videos/",
    status: "ready",
    icon: "\u{1F4F9}",
  },
  {
    step: 2,
    title: "Extract Frames",
    desc: "Extract one frame every 3 seconds from each video in parallel. A100-level throughput across all videos simultaneously.",
    command: "modal run backend/training.py extract",
    status: "ready",
    icon: "\u{1F5BC}\uFE0F",
  },
  {
    step: 3,
    title: "Auto-Label with Vision LLM",
    desc: "Qwen2.5-VL classifies every frame into 5 table states: EMPTY, JUST_SEATED, MID_MEAL, FINISHING, CHECK_STAGE.",
    command: "modal run backend/training.py label",
    status: "ready",
    icon: "\u{1F3F7}\uFE0F",
  },
  {
    step: 4,
    title: "Fine-Tune CLIP",
    desc: "Fine-tune CLIP ViT-L/14 on your labeled frames. Unfreezes last 4 encoder layers + classification head. ~2-4hrs on A100.",
    command: "modal run backend/training.py train",
    status: "ready",
    icon: "\u{1F9E0}",
  },
  {
    step: 5,
    title: "Export Weights",
    desc: "Copy trained weights to the inference volume. The main pipeline will use these for sub-200ms classification.",
    command: "modal run backend/training.py export",
    status: "ready",
    icon: "\u{1F4E6}",
  },
];

const TABLE_STATES = [
  { state: "EMPTY",       color: "bg-emerald-500", desc: "No guests, table bare/reset" },
  { state: "JUST_SEATED", color: "bg-sky-500",     desc: "Guests present, menus open, no food" },
  { state: "MID_MEAL",    color: "bg-amber-500",   desc: "Food on table, active eating" },
  { state: "FINISHING",   color: "bg-orange-500",  desc: "Mostly empty plates, slowing down" },
  { state: "CHECK_STAGE", color: "bg-red-500",     desc: "Bill visible, preparing to leave" },
];

export default function TrainingPage() {
  return (
    <>
      <h1 className="text-2xl md:text-3xl font-extrabold tracking-[0.25em] font-mono text-argus-text mb-1">
        Training Pipeline
      </h1>
      <p className="text-[10px] tracking-[0.15em] uppercase text-argus-dim mb-8">
        CLIP ViT-L/14 fine-tuning on Modal GPU cluster
      </p>

      {/* Architecture overview */}
      <div className="glass rounded-2xl p-5 mb-8">
        <h2 className="text-[10px] font-bold tracking-[0.2em] uppercase text-argus-muted mb-4">
          Model Architecture
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-argus-surface rounded-xl p-4">
            <p className="text-xs font-bold text-sky-400 mb-1">Base Model</p>
            <p className="text-sm font-semibold text-argus-text">CLIP ViT-L/14</p>
            <p className="text-[10px] text-argus-dim mt-1">Pre-trained visual understanding</p>
          </div>
          <div className="bg-argus-surface rounded-xl p-4">
            <p className="text-xs font-bold text-amber-400 mb-1">Auto-Labeler</p>
            <p className="text-sm font-semibold text-argus-text">Qwen2.5-VL 7B</p>
            <p className="text-[10px] text-argus-dim mt-1">Vision LLM for frame classification</p>
          </div>
          <div className="bg-argus-surface rounded-xl p-4">
            <p className="text-xs font-bold text-emerald-400 mb-1">Compute</p>
            <p className="text-sm font-semibold text-argus-text">Modal A100 GPU</p>
            <p className="text-[10px] text-argus-dim mt-1">Parallel extraction + training</p>
          </div>
        </div>

        {/* 5 table states */}
        <h3 className="text-[10px] font-bold tracking-[0.15em] uppercase text-argus-muted mb-3">
          5 Classification States
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {TABLE_STATES.map(s => (
            <div key={s.state} className="flex items-center gap-2 bg-argus-card rounded-lg px-3 py-2">
              <span className={`w-2.5 h-2.5 rounded-full ${s.color}`} />
              <div>
                <p className="text-[10px] font-bold text-argus-text">{s.state}</p>
                <p className="text-[9px] text-argus-dim">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pipeline steps */}
      <h2 className="text-[10px] font-bold tracking-[0.2em] uppercase text-argus-muted mb-4">
        Pipeline Steps
      </h2>
      <div className="space-y-3 mb-8">
        {PIPELINE_STEPS.map((step, i) => (
          <motion.div
            key={step.step}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: i * 0.1 }}
            className="glass rounded-xl p-4"
          >
            <div className="flex items-start gap-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-argus-surface text-lg shrink-0">
                {step.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold text-argus-faint">STEP {step.step}</span>
                  <h3 className="text-sm font-bold text-argus-text">{step.title}</h3>
                </div>
                <p className="text-xs text-argus-muted mb-3">{step.desc}</p>
                <div className="bg-argus-base rounded-lg px-3 py-2">
                  <code className="text-[11px] font-mono text-emerald-400">{step.command}</code>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Quick start */}
      <div className="glass rounded-2xl p-5">
        <h2 className="text-[10px] font-bold tracking-[0.2em] uppercase text-argus-muted mb-4">
          Quick Start | Full Pipeline
        </h2>
        <p className="text-xs text-argus-muted mb-4">
          Run all steps in sequence with a single command:
        </p>
        <div className="bg-argus-base rounded-lg px-4 py-3 mb-4">
          <code className="text-sm font-mono text-emerald-400">modal run backend/training.py full</code>
        </div>
        <p className="text-xs text-argus-muted mb-3">
          Or check current status:
        </p>
        <div className="bg-argus-base rounded-lg px-4 py-3">
          <code className="text-sm font-mono text-emerald-400">modal run backend/training.py status</code>
        </div>
      </div>
    </>
  );
}
