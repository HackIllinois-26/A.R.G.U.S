"use client";

import { motion } from "framer-motion";

const PIPELINE_STEPS = [
  { step: 1, title: "Upload Videos", desc: "Upload restaurant footage to the Modal Volume. Each video provides ~2,400 frames (at 1 frame/3sec for a 2hr video).", command: "modal volume put argus-training-data raw_videos/ ./your_videos/" },
  { step: 2, title: "Extract Frames", desc: "Extract one frame every 3 seconds from each video in parallel. A100-level throughput across all videos simultaneously.", command: "modal run backend/training.py extract" },
  { step: 3, title: "Auto-Label with Vision LLM", desc: "Qwen2.5-VL classifies every frame into 5 table states: EMPTY, JUST_SEATED, MID_MEAL, FINISHING, CHECK_STAGE.", command: "modal run backend/training.py label" },
  { step: 4, title: "Fine-Tune CLIP", desc: "Fine-tune CLIP ViT-L/14 on your labeled frames. Unfreezes last 4 encoder layers + classification head. ~2-4hrs on A100.", command: "modal run backend/training.py train" },
  { step: 5, title: "Export Weights", desc: "Copy trained weights to the inference volume. The main pipeline will use these for sub-200ms classification.", command: "modal run backend/training.py export" },
];

const TABLE_STATES = [
  { state: "EMPTY", color: "bg-emerald-500", desc: "No guests, table bare/reset" },
  { state: "JUST_SEATED", color: "bg-sky-500", desc: "Guests present, menus open, no food" },
  { state: "MID_MEAL", color: "bg-amber-500", desc: "Food on table, active eating" },
  { state: "FINISHING", color: "bg-orange-500", desc: "Mostly empty plates, slowing down" },
  { state: "CHECK_STAGE", color: "bg-red-500", desc: "Bill visible, preparing to leave" },
];

export default function TrainingPage() {
  return (
    <>
      <h1 className="text-3xl font-bold text-gradient mb-1">Training Pipeline</h1>
      <p className="text-sm text-white/40 mb-6">CLIP ViT-L/14 fine-tuning on Modal GPU cluster</p>

      <div className="rounded-xl border border-white/[0.10] bg-black/60 backdrop-blur-md p-5 mb-6">
        <h2 className="text-sm font-medium text-white/50 mb-4">Model Architecture</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          {[
            { label: "Base Model", value: "CLIP ViT-L/14", sub: "Pre-trained visual understanding", color: "text-sky-400" },
            { label: "Auto-Labeler", value: "Qwen2.5-VL 7B", sub: "Vision LLM for frame classification", color: "text-orange-400" },
            { label: "Compute", value: "Modal A100 GPU", sub: "Parallel extraction + training", color: "text-emerald-400" },
          ].map(m => (
            <div key={m.label} className="bg-black/40 border border-white/[0.08] rounded-lg p-4">
              <p className={`text-xs font-medium ${m.color} mb-1`}>{m.label}</p>
              <p className="text-sm font-medium text-white/90">{m.value}</p>
              <p className="text-xs text-white/30 mt-1">{m.sub}</p>
            </div>
          ))}
        </div>

        <h3 className="text-xs font-medium text-white/40 mb-3">5 Classification States</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {TABLE_STATES.map(s => (
            <div key={s.state} className="flex items-center gap-2 bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2">
              <span className={`w-2 h-2 rounded-full ${s.color}`} />
              <div>
                <p className="text-xs font-medium text-white/80">{s.state}</p>
                <p className="text-xs text-white/30">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <h2 className="text-sm font-medium text-white/50 mb-3">Pipeline Steps</h2>
      <div className="space-y-2 mb-6">
        {PIPELINE_STEPS.map((step, i) => (
          <motion.div key={step.step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: i * 0.06 }}
            className="rounded-xl border border-white/[0.10] bg-black/60 backdrop-blur-md p-4">
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/[0.06] text-sm font-medium text-white/60 shrink-0">{step.step}</div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-white/90 mb-1">{step.title}</h3>
                <p className="text-xs text-white/40 mb-2 leading-relaxed">{step.desc}</p>
                <div className="bg-black/40 rounded-lg px-3 py-2">
                  <code className="text-xs font-mono text-emerald-400">{step.command}</code>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="rounded-xl border border-white/[0.10] bg-black/60 backdrop-blur-md p-5">
        <h2 className="text-sm font-medium text-white/50 mb-3">Quick Start</h2>
        <p className="text-sm text-white/40 mb-3">Run all steps in sequence with a single command:</p>
        <div className="bg-black/40 rounded-lg px-4 py-2.5 mb-4">
          <code className="text-sm font-mono text-emerald-400">modal run backend/training.py full</code>
        </div>
        <p className="text-sm text-white/40 mb-3">Or check current status:</p>
        <div className="bg-black/40 rounded-lg px-4 py-2.5">
          <code className="text-sm font-mono text-emerald-400">modal run backend/training.py status</code>
        </div>
      </div>
    </>
  );
}
