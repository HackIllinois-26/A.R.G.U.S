"use client";

import { useEffect } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";

interface Props {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

export function AnimatedCounter({
  value,
  duration = 0.8,
  decimals = 0,
  prefix = "",
  suffix = "",
  className = "",
}: Props) {
  const mv = useMotionValue(0);
  const display = useTransform(mv, (v) => {
    const n = decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString();
    return `${prefix}${n}${suffix}`;
  });

  useEffect(() => {
    const ctrl = animate(mv, value, { duration, ease: [0.25, 0.46, 0.45, 0.94] });
    return ctrl.stop;
  }, [value, duration, mv]);

  return <motion.span className={className}>{display}</motion.span>;
}
