"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import clsx from "clsx";

const NAV_ITEMS = [
  { href: "/", label: "Floor" },
  { href: "/history", label: "History" },
  { href: "/demo", label: "Demo" },
  { href: "/about", label: "About" },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <div className="sticky top-0 z-50 flex justify-center py-3 pointer-events-none">
      <nav className="relative flex items-center gap-1 rounded-full bg-[rgba(15,23,42,0.85)] backdrop-blur-2xl border border-white/[0.08] p-1 shadow-[0_4px_24px_rgba(0,0,0,0.5)] pointer-events-auto">
        <span className="px-4 py-2 text-sm font-bold tracking-widest text-cyan-400 select-none">
          A.R.G.U.S.
        </span>
        <span className="w-px h-4 bg-white/[0.1]" />
        {NAV_ITEMS.map(({ href, label }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);

          return (
            <Link key={href} href={href} className="relative z-10">
              {active && (
                <motion.span
                  layoutId="nav-pill"
                  className="absolute inset-0 rounded-full bg-white/[0.1] shadow-[0_0_14px_rgba(6,182,212,0.15)]"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <span
                className={clsx(
                  "relative block px-5 py-2 text-sm font-medium tracking-wide rounded-full transition-colors duration-200",
                  active
                    ? "text-cyan-400"
                    : "text-argus-dim hover:text-argus-muted"
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
