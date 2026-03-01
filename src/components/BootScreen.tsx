"use client";

import { motion, AnimatePresence } from "framer-motion";
import { AnimatedCounter } from "./AnimatedCounter";
import type { BootResult } from "../../types/argus";

interface Props {
  progress: number;
  sessionsProcessed: number;
  visible: boolean;
  bootResult: BootResult | null;
}

export function BootScreen({ progress, sessionsProcessed, visible, bootResult }: Props) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.6 } }}
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center"
        >
          <div className="absolute inset-0 bg-gradient-to-b from-argus-base via-[#0a1628] to-argus-base" />

          {/* Pulse rings */}
          <div className="relative w-32 h-32 mb-10 flex items-center justify-center z-10">
            <div className="absolute w-32 h-32 rounded-full border border-emerald-500/50 animate-ring-pulse" />
            <div className="absolute w-20 h-20 rounded-full border border-emerald-500/30 animate-ring-pulse [animation-delay:0.4s]" />
            <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <span className="text-emerald-400 text-2xl">&#x25C9;</span>
            </div>
          </div>

          <motion.h1
            initial={{ opacity: 0, letterSpacing: "0.1em" }}
            animate={{ opacity: 1, letterSpacing: "0.5em" }}
            transition={{ duration: 1, delay: 0.2 }}
            className="relative text-4xl md:text-5xl font-extrabold text-argus-text font-mono mb-2 z-10"
          >
            A.R.G.U.S.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="relative text-xs tracking-[0.15em] text-argus-dim mb-12 z-10"
          >
            Analytical Restaurant Guest &amp; Utility System
          </motion.p>

          {/* Progress */}
          <div className="relative w-80 z-10">
            <div className="w-full h-1.5 bg-argus-card rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                initial={{ width: "0%" }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
            <div className="mt-4 flex flex-col items-center">
              {!bootResult ? (
                <>
                  <p className="text-xs text-argus-muted mb-1">
                    Processing historical data across 5 locations...
                  </p>
                  <div className="flex items-center gap-1">
                    <AnimatedCounter value={sessionsProcessed} className="text-lg font-bold text-emerald-400" />
                    <span className="text-sm text-argus-dim">/ 8,400 sessions</span>
                  </div>
                </>
              ) : (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
                  <p className="text-lg font-bold text-emerald-400">System Ready</p>
                  <p className="text-xs text-argus-muted mt-1">
                    {bootResult.sessions_processed.toLocaleString()} sessions in{" "}
                    {(bootResult.processing_time_ms / 1000).toFixed(1)}s
                  </p>
                </motion.div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
