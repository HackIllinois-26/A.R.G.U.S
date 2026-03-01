import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "A.R.G.U.S. — Restaurant Intelligence",
  description: "Analytical Restaurant Guest & Utility System — 5-Agent Multi-Location Floor Monitor",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-argus-base`}>
        {/* Nav */}
        <nav className="sticky top-0 z-50 glass border-b border-argus-glass-border">
          <div className="max-w-[1600px] mx-auto flex items-center justify-between px-6 h-12">
            <div className="flex items-center gap-3">
              <span className="text-base font-extrabold tracking-[0.25em] font-mono text-argus-text">
                A.R.G.U.S.
              </span>
              <span className="text-[10px] tracking-widest uppercase text-argus-dim hidden sm:inline">
                5-Agent Restaurant Intelligence
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Link
                href="/"
                className="px-4 py-1.5 text-[11px] font-semibold tracking-wide rounded-full transition-colors hover:bg-argus-card text-argus-muted hover:text-argus-text"
              >
                Floor
              </Link>
              <Link
                href="/insights"
                className="px-4 py-1.5 text-[11px] font-semibold tracking-wide rounded-full transition-colors hover:bg-argus-card text-argus-muted hover:text-argus-text"
              >
                Insights
              </Link>
              <Link
                href="/demo"
                className="px-4 py-1.5 text-[11px] font-semibold tracking-wide rounded-full transition-colors bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20"
              >
                Demo
              </Link>
              <Link
                href="/training"
                className="px-4 py-1.5 text-[11px] font-semibold tracking-wide rounded-full transition-colors hover:bg-argus-card text-argus-muted hover:text-argus-text"
              >
                Training
              </Link>
            </div>
          </div>
        </nav>

        <main className="max-w-[1600px] mx-auto px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
