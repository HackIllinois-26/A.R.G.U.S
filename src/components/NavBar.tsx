"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import clsx from "clsx";

const NAV_ITEMS = [
  { href: "/floor", label: "Floor" },
  { href: "/demo", label: "Demo" },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-white/[0.04] backdrop-blur-xl">
      <div className="max-w-[1600px] mx-auto px-6 flex items-center justify-between h-14">
        <Link href="/" className="text-lg font-semibold text-white tracking-tight shrink-0">
          A.R.G.U.S.
        </Link>

        <nav className="flex items-center space-x-2">
          {NAV_ITEMS.map(({ href, label }) => {
            const active = pathname.startsWith(href);

            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "relative px-3 py-2 text-xs font-light rounded-full transition-all duration-200",
                  active
                    ? "text-white"
                    : "text-white/80 hover:text-white hover:bg-white/10"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-full bg-white/[0.1] border border-white/[0.08]"
                    transition={{ type: "spring", stiffness: 400, damping: 28 }}
                    style={{ zIndex: -1 }}
                  />
                )}
                {label}
              </Link>
            );
          })}
        </nav>

        <Link
          href="/"
          className="px-5 py-2 rounded-full bg-white text-black font-normal text-xs transition-all duration-300 hover:bg-white/90 h-8 flex items-center"
        >
          Home
        </Link>
      </div>
    </header>
  );
}
