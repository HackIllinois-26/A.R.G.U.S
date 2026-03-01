"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { TableCard } from "./TableCard";
import { StatsBar } from "./StatsBar";
import { BootScreen } from "./BootScreen";
import { AnimatedCounter } from "./AnimatedCounter";
import type {
  AnalysisStats, BootResult, FloorAnalysis,
  LocationResult, TableStatus, Location,
} from "../../types/argus";
import { LOCATIONS } from "../../types/argus";

const API_BASE = process.env.NEXT_PUBLIC_ARGUS_API ?? "https://girishskandhas--argus";
const EP = {
  boot: `${API_BASE}-api-boot.modal.run`,
  rush: `${API_BASE}-api-rush-hour.modal.run`,
};
const RUSH_MS = 30_000;

/* ---------- mock helpers ---------- */
function mockTable(id: string, loc: string): TableStatus {
  const vibes = ["happy","neutral","stressed","angry","about_to_leave"] as const;
  const phases = ["eating","ordering","waiting","dessert","wants_check"] as const;
  const s = Math.random();
  return {
    table_id: id, location_id: loc,
    vibe: vibes[Math.floor(Math.random()*vibes.length)],
    phase: phases[Math.floor(Math.random()*phases.length)],
    stress_avg: s, engagement_avg: 1-s*0.8,
    predicted_turn_minutes: Math.floor(Math.random()*50)+5,
    prediction_confidence: 0.6,
    urgency: s>0.7?"high":s>0.5?"medium":"none",
    alerts: s>0.8?["Elevated stress detected"]:[],
    action_needed: s>0.7?"Check on table":null,
    summary:"Mock", inference_latency_ms:0, total_latency_ms:0,
  };
}
function mockLoc(l: Location): LocationResult {
  const t = Array.from({length:l.tables},(_,i)=>mockTable(String(i+1),l.id));
  return { location_id:l.id, tables:t, table_count:l.tables, alert_count:t.filter(x=>x.alerts.length>0).length, latency_ms:0 };
}

/* ---------- component ---------- */
export function Dashboard() {
  const [locResults, setLocResults] = useState<LocationResult[]>(LOCATIONS.map(mockLoc));
  const [selLoc, setSelLoc] = useState(LOCATIONS[0].id);
  const [stats, setStats] = useState<AnalysisStats|null>(null);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [peakContainers, setPeakContainers] = useState(0);
  const [loading, setLoading] = useState(false);

  const [booting, setBooting] = useState(false);
  const [bootProg, setBootProg] = useState(0);
  const [bootSess, setBootSess] = useState(0);
  const [bootRes, setBootRes] = useState<BootResult|null>(null);
  const [showBoot, setShowBoot] = useState(false);

  const [rush, setRush] = useState(false);
  const [phase, setPhase] = useState(0);
  const rushRef = useRef<ReturnType<typeof setInterval>|null>(null);

  const [clock, setClock] = useState("");
  useEffect(()=>{
    setClock(new Date().toLocaleTimeString());
    const t=setInterval(()=>setClock(new Date().toLocaleTimeString()),1000);
    return ()=>clearInterval(t);
  },[]);

  /* boot */
  const handleBoot = useCallback(async()=>{
    setShowBoot(true); setBooting(true); setBootProg(0); setBootSess(0);
    const fake=setInterval(()=>{ setBootProg(p=>Math.min(p+8,90)); setBootSess(s=>Math.min(s+840,7560)); },600);
    try{
      const r=await fetch(EP.boot,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      const d:BootResult=await r.json();
      clearInterval(fake); setBootProg(100); setBootSess(d.sessions_processed); setBootRes(d);
    }catch{
      clearInterval(fake); setBootProg(100); setBootSess(8400);
      setBootRes({total_sessions:8400,sessions_processed:8400,chunks_completed:10,processing_time_ms:11500});
    }finally{ setBooting(false); setTimeout(()=>setShowBoot(false),2000); }
  },[]);

  /* rush */
  const fireRush = useCallback(async(idx:number)=>{
    setLoading(true);
    try{
      const r=await fetch(EP.rush,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phase_index:idx})});
      const d:FloorAnalysis=await r.json();
      setLocResults(d.locations); setStats(d.stats);
      setSessionTotal(p=>p+d.stats.tables_analyzed);
      setPeakContainers(p=>Math.max(p,d.stats.modal_invocations));
    }catch{/* offline */}finally{ setLoading(false); }
  },[]);

  const toggleRush = useCallback(()=>{
    if(rush){ if(rushRef.current) clearInterval(rushRef.current); rushRef.current=null; setRush(false); }
    else{ setRush(true); fireRush(phase);
      rushRef.current=setInterval(()=>{ setPhase(p=>{ const n=p+1; fireRush(n); return n; }); },RUSH_MS);
    }
  },[rush,phase,fireRush]);

  useEffect(()=>()=>{ if(rushRef.current) clearInterval(rushRef.current); },[]);

  const cur = locResults.find(l=>l.location_id===selLoc);
  const tables = cur?.tables ?? [];
  const alerts = locResults.reduce((s,l)=>s+(l.alert_count??0),0);

  return (
    <>
      <BootScreen visible={showBoot} progress={bootProg} sessionsProcessed={bootSess} bootResult={bootRes} />

      {/* header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-[0.25em] font-mono text-argus-text">A.R.G.U.S.</h1>
          <p className="text-[10px] tracking-[0.15em] uppercase text-argus-dim mt-0.5">Multi-Location Floor Monitor</p>
        </div>
        <div className="flex items-center gap-3">
          {loading && (
            <svg className="animate-spin h-4 w-4 text-argus-dim" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
            </svg>
          )}
          <span className="text-xs text-argus-faint font-mono">{clock}</span>
          {alerts>0 && (
            <span className="min-w-[24px] h-6 flex items-center justify-center bg-red-600 text-white text-xs font-bold rounded-full px-1.5">{alerts}</span>
          )}
        </div>
      </div>

      <StatsBar stats={stats} sessionTotal={sessionTotal} peakContainers={peakContainers} isRushHour={rush} />

      {/* buttons */}
      <div className="flex gap-3 mb-4">
        <motion.button whileTap={{scale:0.96}} onClick={handleBoot} disabled={booting}
          className="flex-1 py-3 rounded-xl text-xs font-bold text-argus-text border border-argus-glass-border bg-argus-card hover:bg-argus-surface transition-colors disabled:opacity-50 cursor-pointer">
          {booting?"Processing...":bootRes?`✓ ${bootRes.sessions_processed.toLocaleString()} loaded`:"Load Historical Data"}
        </motion.button>
        <motion.button whileTap={{scale:0.96}} onClick={toggleRush}
          className={`flex-1 py-3 rounded-xl text-xs font-bold text-white cursor-pointer transition-colors ${rush?"bg-gradient-to-r from-red-700 to-red-900 hover:from-red-600":"bg-gradient-to-r from-emerald-600 to-emerald-800 hover:from-emerald-500"}`}>
          {rush?"■  Stop Rush Hour":"▶  Simulate Rush Hour"}
        </motion.button>
      </div>

      {/* location tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
        {LOCATIONS.map(loc=>{
          const lr=locResults.find(l=>l.location_id===loc.id);
          const a=lr?.alert_count??0;
          const active=selLoc===loc.id;
          return (
            <button key={loc.id} onClick={()=>setSelLoc(loc.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-[11px] font-semibold tracking-wide whitespace-nowrap border transition-all cursor-pointer ${
                active
                  ? "bg-gradient-to-r from-emerald-600 to-emerald-800 border-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                  : "bg-argus-card border-argus-border text-argus-muted hover:text-argus-text"
              }`}>
              {loc.name}
              {a>0 && <span className="min-w-[16px] h-4 flex items-center justify-center bg-red-600 text-white text-[9px] font-bold rounded-full px-1">{a}</span>}
            </button>
          );
        })}
      </div>

      {/* table grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {tables.map((t,i)=><TableCard key={`${t.location_id}-${t.table_id}`} table={t} index={i}/>)}
      </div>
    </>
  );
}
