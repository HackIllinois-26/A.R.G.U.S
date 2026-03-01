"use client";

import { useEffect } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";

interface Props {
  value: number; // 0–1
  size?: number;
  strokeWidth?: number;
  label?: string;
}

function color(v: number) {
  if (v < 0.4) return "#10b981";
  if (v < 0.7) return "#f59e0b";
  return "#ef4444";
}

export function CircularGauge({ value, size = 52, strokeWidth = 5, label }: Props) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;

  const mv = useMotionValue(0);
  const offset = useTransform(mv, (v) => c * (1 - v));
  const stroke = useTransform(mv, (v) => color(v));

  useEffect(() => {
    const ctrl = animate(mv, Math.min(1, Math.max(0, value)), {
      duration: 0.9,
      ease: [0.25, 0.46, 0.45, 0.94],
    });
    return ctrl.stop;
  }, [value, mv]);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#334155" strokeWidth={strokeWidth} fill="none" opacity={0.4} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r}
          strokeWidth={strokeWidth} fill="none"
          strokeDasharray={c} strokeDashoffset={offset}
          stroke={stroke} strokeLinecap="round"
        />
      </svg>
      <div className="flex flex-col items-center z-10">
        <span className="text-[11px] font-bold text-argus-text">{Math.round(value * 100)}</span>
        {label && <span className="text-[8px] font-semibold text-argus-dim -mt-0.5">{label}</span>}
      </div>
    </div>
  );
}
