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
          exit={{ opacity: 0, transition: { duration: 0.4 } }}
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black"
        >
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-3xl md:text-4xl font-bold text-gradient mb-2"
          >
            A.R.G.U.S.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-sm text-white/40 mb-10"
          >
            Analytical Restaurant Guest &amp; Utility System
          </motion.p>

          <div className="w-72">
            <div className="w-full h-1 bg-white/[0.06] rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-orange-500"
                initial={{ width: "0%" }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
            <div className="mt-4 flex flex-col items-center">
              {!bootResult ? (
                <>
                  <p className="text-sm text-white/50 mb-1">Processing historical data...</p>
                  <div className="flex items-center gap-1">
                    <AnimatedCounter value={sessionsProcessed} className="text-base font-semibold text-emerald-400" />
                    <span className="text-sm text-white/30">/ 8,400 sessions</span>
                  </div>
                </>
              ) : (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
                  <p className="text-base font-medium text-emerald-400">System Ready</p>
                  <p className="text-sm text-white/40 mt-1">
                    {bootResult.sessions_processed.toLocaleString()} sessions in {(bootResult.processing_time_ms / 1000).toFixed(1)}s
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
