"use client";

import { NavBar } from "../../components/NavBar";
import { AppBackground } from "../../components/AppBackground";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppBackground />
      <div className="relative z-10">
        <NavBar />
        <main className="max-w-[1600px] mx-auto px-6 py-5">{children}</main>
      </div>
    </>
  );
}
