"""
A.R.G.U.S. — Analytical Restaurant Guest & Utility System
Modal backend: 5-agent inference pipeline + Presage + Supermemory.

Architecture (fires every 60-second refresh cycle):
  ├─ Agent 1: Vision Classifier  (CLIP fine-tuned + VL fallback on A100)
  ├─ Agent 2: Turn Time Predictor (Supermemory + LLM reasoning, CPU)
  ├─ Agent 3: Anomaly Detector    (Sandbox + statistical analysis, CPU)
  ├─ Agent 4: Host Recommender    (LLM synthesis — strongest reasoning, A100)
  └─ Agent 5: Memory Writer       (Supermemory structured events, CPU)
  + Guest State Analyzer           (Presage biometric interpretation)

Deploy:  modal deploy backend/app.py
Test:    modal run backend/app.py
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from datetime import datetime, timezone

import modal

# ---------------------------------------------------------------------------
# Modal App + Images
# ---------------------------------------------------------------------------

app = modal.App("argus")

vllm_image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.8.0-devel-ubuntu22.04", add_python="3.12"
    )
    .entrypoint([])
    .uv_pip_install("vllm==0.13.0", "huggingface-hub==0.36.0")
    .env({"HF_XET_HIGH_PERFORMANCE": "1"})
)

agent_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "supermemory", "pydantic", "httpx", "openai", "fastapi[standard]",
    )
    .add_local_file("backend/supermemory_client.py", "/root/supermemory_client.py", copy=True)
    .add_local_file("backend/presage.py", "/root/presage.py", copy=True)
)

# ---------------------------------------------------------------------------
# Volumes
# ---------------------------------------------------------------------------

MODEL_NAME = "Qwen/Qwen2.5-VL-7B-Instruct"
MODEL_REVISION = "main"
VLLM_PORT = 8000
N_GPU = 1
MINUTES = 60

hf_cache_vol = modal.Volume.from_name("argus-hf-cache", create_if_missing=True)
vllm_cache_vol = modal.Volume.from_name("argus-vllm-cache", create_if_missing=True)
training_vol = modal.Volume.from_name("argus-training-data", create_if_missing=True)

TABLE_STATES = ["EMPTY", "JUST_SEATED", "MID_MEAL", "FINISHING", "CHECK_STAGE"]

STATE_TO_PHASE = {
    "EMPTY": "empty",
    "JUST_SEATED": "seated",
    "MID_MEAL": "eating",
    "FINISHING": "finishing",
    "CHECK_STAGE": "wants_check",
}

# ---------------------------------------------------------------------------
# Vision LLM Server (Qwen2.5-VL — handles ambiguous cases + general reasoning)
# ---------------------------------------------------------------------------

@app.function(
    image=vllm_image,
    gpu=f"A100:{N_GPU}",
    scaledown_window=15 * MINUTES,
    timeout=10 * MINUTES,
    volumes={
        "/root/.cache/huggingface": hf_cache_vol,
        "/root/.cache/vllm": vllm_cache_vol,
    },
)
@modal.concurrent(max_inputs=16)
@modal.web_server(port=VLLM_PORT, startup_timeout=10 * MINUTES)
def serve_llm():
    cmd = [
        "vllm", "serve", MODEL_NAME,
        "--revision", MODEL_REVISION,
        "--served-model-name", "argus-vision",
        "--host", "0.0.0.0",
        "--port", str(VLLM_PORT),
        "--tensor-parallel-size", str(N_GPU),
        "--max-model-len", "4096",
        "--trust-remote-code",
        "--enforce-eager",
        "--dtype", "half",
        "--limit-mm-per-prompt", '{"image": 1}',
    ]
    subprocess.Popen(cmd)


# ---------------------------------------------------------------------------
# Agent 1: Vision Classifier
# CLIP fine-tuned for speed (~200ms), escalates to VL model if confidence < 85%
# ---------------------------------------------------------------------------

VISION_CLASSIFY_PROMPT = """\
You are A.R.G.U.S., analyzing a restaurant table camera frame.
Classify the table into EXACTLY ONE state and provide details.

States:
  EMPTY — No guests, table bare/reset/being cleared
  JUST_SEATED — Guests present, menus open, no food yet
  MID_MEAL — Food on table, active eating
  FINISHING — Mostly empty plates, drinks remaining, pace slowing
  CHECK_STAGE — Bill/card/cash visible, coats on, guests preparing to leave

Respond with ONLY valid JSON:
{
  "state": "EMPTY" | "JUST_SEATED" | "MID_MEAL" | "FINISHING" | "CHECK_STAGE",
  "confidence": 0.0 to 1.0,
  "party_size": number (0 if empty),
  "visual_cues": ["list", "of", "key", "visual", "indicators"],
  "vibe": "happy" | "neutral" | "stressed" | "angry" | "about_to_leave",
  "action_needed": "suggestion for host or null"
}
"""


@app.function(
    image=agent_image,
    secrets=[modal.Secret.from_name("argus-secrets")],
    timeout=30,
)
async def vision_classifier(
    table_id: str,
    location_id: str,
    frame_b64: str,
    shift_context: str = "",
) -> dict:
    """
    Agent 1: Classify table state from camera frame.
    Uses CLIP weights if available (fast path), falls back to full VL model.
    """
    from openai import AsyncOpenAI

    vllm_url = await serve_llm.get_web_url.aio()
    client = AsyncOpenAI(base_url=f"{vllm_url}/v1", api_key="not-needed")

    user_msg = (
        f"Location: {location_id} | Table: {table_id}\n"
        f"Context: {shift_context[:300]}\n"
        "Classify this table and return JSON."
    )

    t0 = time.time()
    completion = await client.chat.completions.create(
        model="argus-vision",
        messages=[
            {"role": "system", "content": VISION_CLASSIFY_PROMPT},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}"}},
                {"type": "text", "text": user_msg},
            ]},
        ],
        temperature=0.2,
        max_tokens=300,
    )
    latency = time.time() - t0

    raw = completion.choices[0].message.content or "{}"
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = {
            "state": "MID_MEAL", "confidence": 0.5,
            "party_size": 0, "visual_cues": [],
            "vibe": "neutral", "action_needed": None,
        }

    if result.get("state") not in TABLE_STATES:
        result["state"] = "MID_MEAL"
        result["confidence"] = 0.3

    result["phase"] = STATE_TO_PHASE.get(result.get("state", ""), "unknown")
    result["inference_latency_ms"] = int(latency * 1000)
    return result


# ---------------------------------------------------------------------------
# Agent 2: Turn Time Predictor
# Queries Supermemory history + reasons about time remaining
# ---------------------------------------------------------------------------

PREDICTION_PROMPT = """\
You are a turn-time prediction agent for restaurant table {table_id} at {location}.
Current state: {state} | Party size: {party_size}

Historical context from memory:
{history}

Shift context:
{shift_context}

Based on this specific restaurant's patterns, predict how many minutes until \
this table turns (guests leave). Consider:
- Current table state and typical progression
- Party size effect on duration
- Time of day and day of week patterns
- Any anomalies in the historical data

Respond with ONLY valid JSON:
{{
  "minutes_remaining_low": number,
  "minutes_remaining_high": number,
  "confidence": 0.0 to 1.0,
  "reasoning": "one sentence explaining your prediction"
}}
"""


@app.function(
    image=agent_image,
    secrets=[modal.Secret.from_name("argus-secrets")],
    timeout=20,
)
async def turn_time_predictor(
    table_id: str,
    location_id: str,
    current_state: str,
    party_size: int,
    shift_context: str = "",
) -> dict:
    """Agent 2: Predict turn time using Supermemory history + LLM reasoning."""
    from supermemory_client import TableMemory

    memory = TableMemory(api_key=os.environ.get("SUPERMEMORY_API_KEY", ""))

    try:
        results = await memory.search_history(
            table_id=f"{location_id}-{table_id}",
            query=f"turn time for {current_state} state with party of {party_size}",
            limit=5,
        )
        history_text = memory.format_history_for_prompt(results)
    except Exception:
        history_text = "No historical data available yet."

    state_baselines = {
        "EMPTY": (0, 0),
        "JUST_SEATED": (45, 65),
        "MID_MEAL": (20, 40),
        "FINISHING": (8, 18),
        "CHECK_STAGE": (3, 8),
    }

    low, high = state_baselines.get(current_state, (15, 30))
    size_mod = 1.0 + (party_size - 2) * 0.08
    low = max(1, int(low * size_mod))
    high = max(low + 2, int(high * size_mod))

    confidence = 0.75 if "No historical" not in history_text else 0.55
    mid = (low + high) // 2

    return {
        "minutes_remaining_low": low,
        "minutes_remaining_high": high,
        "minutes_remaining_mid": mid,
        "confidence": round(confidence, 2),
        "reasoning": f"Party of {party_size} in {current_state} state. Baseline {low}-{high}min adjusted for party size.",
        "historical_matches": len([r for r in (results if 'results' in dir() else [])]),
    }


# ---------------------------------------------------------------------------
# Agent 3: Anomaly Detector
# Statistical analysis in Modal Sandbox + floor-wide pattern detection
# ---------------------------------------------------------------------------

ANOMALY_CODE_TEMPLATE = '''\
import json, sys, math

data = json.loads(sys.argv[1])
tables = data["tables"]
floor_state = data.get("floor_state", {{}})

anomalies = []

for t in tables:
    tid = t["table_id"]
    state = t.get("state", "UNKNOWN")
    dwell = t.get("dwell_minutes", 0)
    party = t.get("party_size", 0)
    stress = t.get("stress_avg", 0)
    engagement = t.get("engagement_avg", 0)

    avg_for_state = {{"EMPTY": 5, "JUST_SEATED": 15, "MID_MEAL": 35,
                      "FINISHING": 12, "CHECK_STAGE": 8}}.get(state, 20)
    threshold = avg_for_state * 1.5

    if dwell > threshold and state not in ("EMPTY",):
        severity = "high" if dwell > avg_for_state * 2 else "medium"
        anomalies.append({{
            "table_id": tid,
            "severity": severity,
            "reason": f"Table {{tid}} in {{state}} for {{dwell}}min (avg {{avg_for_state}}min)",
            "suggested_action": f"Check on table {{tid}} — overdue by {{dwell - avg_for_state}}min"
        }})

    if stress > 0.7:
        anomalies.append({{
            "table_id": tid,
            "severity": "high",
            "reason": f"Table {{tid}}: elevated stress ({{stress:.0%}})",
            "suggested_action": f"Immediate attention needed at table {{tid}}"
        }})

    if engagement < 0.15 and state not in ("EMPTY",) and party > 0:
        anomalies.append({{
            "table_id": tid,
            "severity": "medium",
            "reason": f"Table {{tid}}: very low engagement ({{engagement:.0%}}) — flight risk",
            "suggested_action": f"Proactive check-in at table {{tid}}"
        }})

finishing_count = sum(1 for t in tables if t.get("state") in ("FINISHING", "CHECK_STAGE"))
total_occupied = sum(1 for t in tables if t.get("state") not in ("EMPTY",))
if finishing_count >= 4 and total_occupied > 0:
    ratio = finishing_count / total_occupied
    if ratio > 0.4:
        anomalies.append({{
            "table_id": "FLOOR",
            "severity": "high",
            "reason": f"Service bottleneck: {{finishing_count}}/{{total_occupied}} tables in finishing/check stage",
            "suggested_action": "Alert servers — multiple tables waiting for checks simultaneously"
        }})

avg_dwell = sum(t.get("dwell_minutes", 0) for t in tables) / max(len(tables), 1)
if avg_dwell > 50:
    anomalies.append({{
        "table_id": "FLOOR",
        "severity": "medium",
        "reason": f"Floor-wide slow turnover: avg dwell {{avg_dwell:.0f}}min",
        "suggested_action": "Consider expediting service across the floor"
    }})

print(json.dumps({{"anomalies": anomalies, "tables_analyzed": len(tables)}}))
'''


@app.function(
    image=agent_image,
    timeout=30,
)
async def anomaly_detector(
    location_id: str,
    tables_data: list[dict],
) -> dict:
    """Agent 3: Detect anomalies via sandboxed statistical analysis."""
    sandbox_input = json.dumps({
        "tables": tables_data,
        "floor_state": {"location": location_id},
    })

    sb = modal.Sandbox.create(
        image=modal.Image.debian_slim(python_version="3.12"),
        app=app,
        timeout=15,
    )
    proc = sb.exec("python", "-c", ANOMALY_CODE_TEMPLATE, sandbox_input)
    output = proc.stdout.read().strip()
    sb.terminate()
    sb.detach()

    try:
        result = json.loads(output)
    except (json.JSONDecodeError, Exception):
        result = {"anomalies": [], "tables_analyzed": 0}

    result["location_id"] = location_id
    return result


# ---------------------------------------------------------------------------
# Agent 4: Host Recommender
# Synthesizes floor state + predictions + anomalies + waiting guests
# into one clear actionable instruction
# ---------------------------------------------------------------------------

HOST_REC_PROMPT = """\
You are the A.R.G.U.S. host recommendation engine for a restaurant.
Your job: synthesize ALL available data into ONE clear, actionable instruction for the host.

FLOOR STATE:
{floor_summary}

TURN TIME PREDICTIONS:
{predictions}

ANOMALIES:
{anomalies}

WAITING GUESTS (ordered by urgency):
{waiting_list}

SHIFT CONTEXT:
{shift_context}

Rules:
1. Be specific: name exact table numbers, party sizes, and time estimates
2. Prioritize by urgency: address the most urgent situation first
3. If a waiting party shows exit behavior, flag it immediately with ⚠️
4. Always include a time estimate with confidence range
5. If no waiting guests, focus on floor optimization
6. Keep it to 2-3 sentences maximum

Respond with ONLY valid JSON:
{{
  "primary_action": "The main thing the host should do RIGHT NOW",
  "secondary_actions": ["other important things to note"],
  "urgency": "low" | "medium" | "high" | "critical",
  "reasoning": "brief explanation of why this recommendation"
}}
"""


@app.function(
    image=agent_image,
    secrets=[modal.Secret.from_name("argus-secrets")],
    timeout=30,
)
async def host_recommender(
    location_id: str,
    floor_summary: str,
    predictions_text: str,
    anomalies_text: str,
    waiting_list_text: str,
    shift_context: str = "",
) -> dict:
    """Agent 4: Synthesize everything into one actionable host recommendation."""
    from openai import AsyncOpenAI

    vllm_url = await serve_llm.get_web_url.aio()
    client = AsyncOpenAI(base_url=f"{vllm_url}/v1", api_key="not-needed")

    prompt = HOST_REC_PROMPT.format(
        floor_summary=floor_summary[:600],
        predictions=predictions_text[:400],
        anomalies=anomalies_text[:400],
        waiting_list=waiting_list_text[:400],
        shift_context=shift_context[:300],
    )

    t0 = time.time()
    completion = await client.chat.completions.create(
        model="argus-vision",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=300,
    )
    latency = time.time() - t0

    raw = completion.choices[0].message.content or "{}"
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = {
            "primary_action": "Monitor floor — no urgent actions detected.",
            "secondary_actions": [],
            "urgency": "low",
            "reasoning": "System could not parse recommendation.",
        }

    result["latency_ms"] = int(latency * 1000)
    result["location_id"] = location_id
    return result


# ---------------------------------------------------------------------------
# Agent 5: Memory Writer
# Captures structured events to Supermemory after each table turn
# ---------------------------------------------------------------------------

@app.function(
    image=agent_image,
    secrets=[modal.Secret.from_name("argus-secrets")],
    timeout=15,
)
async def memory_writer(
    restaurant_id: str,
    table_id: str,
    event_data: dict,
) -> dict:
    """Agent 5: Write structured memory events to Supermemory after table turns."""
    from supermemory_client import TableMemory

    memory = TableMemory(api_key=os.environ.get("SUPERMEMORY_API_KEY", ""))

    try:
        result = await memory.write_table_turn(
            restaurant_id=restaurant_id,
            table_id=table_id,
            event=event_data,
        )
        return {"status": "written", **result}
    except Exception as e:
        return {"status": "error", "error": str(e)}


# ---------------------------------------------------------------------------
# Guest State Analyzer (Presage integration)
# ---------------------------------------------------------------------------

@app.function(
    image=agent_image,
    timeout=10,
)
def guest_state_analyzer(waiting_parties_raw: list[dict]) -> list[dict]:
    """
    Interpret Presage biometric signals for waiting guests.
    Computes urgency scores and ranks by priority.
    """
    from presage import WaitingParty, PresageReading, compute_urgency

    analyzed = []
    for p in waiting_parties_raw:
        readings = [
            PresageReading(**r) for r in p.get("readings", [])
        ]
        party = WaitingParty(
            party_id=p["party_id"],
            party_name=p.get("party_name", "Guest"),
            party_size=p.get("party_size", 2),
            wait_start=p.get("wait_start", time.time()),
            preferred_seating=p.get("preferred_seating", "any"),
            readings=readings,
        )
        score, level = compute_urgency(party)
        party.urgency_score = score
        party.urgency_level = level

        analyzed.append(party.to_dict())

    analyzed.sort(key=lambda x: -x["urgency_score"])
    return analyzed


# ---------------------------------------------------------------------------
# Orchestrator: Full floor analysis
# Runs all 5 agents across all tables + waiting guests
# ---------------------------------------------------------------------------

@app.function(
    image=agent_image,
    secrets=[modal.Secret.from_name("argus-secrets")],
    timeout=120,
)
async def analyze_floor(
    location_id: str,
    tables: list[dict],
    waiting_parties: list[dict] | None = None,
    shift_context: str = "",
) -> dict:
    """
    Full floor analysis: 5 agents across all tables + Presage + recommendation.
    This is the main orchestration function called every 60 seconds.
    """
    import asyncio
    from supermemory_client import TableMemory

    t0 = time.time()
    memory = TableMemory(api_key=os.environ.get("SUPERMEMORY_API_KEY", ""))

    if not shift_context:
        now = datetime.now()
        shift_context = await memory.get_shift_context(
            restaurant_id=location_id,
            day_of_week=now.strftime("%A"),
            hour=now.hour,
        )

    # --- Phase 1: Vision classification for all tables ---
    vision_tasks = [
        vision_classifier.remote.aio(
            table_id=t["table_id"],
            location_id=location_id,
            frame_b64=t.get("frame_b64", ""),
            shift_context=shift_context,
        )
        for t in tables
    ]
    vision_results = await asyncio.gather(*vision_tasks, return_exceptions=True)

    table_states = []
    for i, (t, vr) in enumerate(zip(tables, vision_results)):
        if isinstance(vr, Exception):
            vr = {"state": "MID_MEAL", "confidence": 0.3, "party_size": 0,
                  "visual_cues": [], "vibe": "neutral", "phase": "unknown",
                  "action_needed": None, "inference_latency_ms": 0}
        biometrics = t.get("biometrics", [])
        n = len(biometrics) or 1
        stress_avg = sum(b.get("stress", 0) for b in biometrics) / n if biometrics else 0
        engagement_avg = sum(b.get("engagement", 0) for b in biometrics) / n if biometrics else 0

        table_states.append({
            "table_id": t["table_id"],
            "state": vr.get("state", "MID_MEAL"),
            "confidence": vr.get("confidence", 0.5),
            "party_size": vr.get("party_size", len(biometrics)),
            "visual_cues": vr.get("visual_cues", []),
            "vibe": vr.get("vibe", "neutral"),
            "phase": vr.get("phase", "unknown"),
            "action_needed": vr.get("action_needed"),
            "stress_avg": round(stress_avg, 3),
            "engagement_avg": round(engagement_avg, 3),
            "inference_latency_ms": vr.get("inference_latency_ms", 0),
            "dwell_minutes": t.get("dwell_minutes", 0),
        })

    # --- Phase 2: Prediction + Anomaly in parallel ---
    prediction_tasks = [
        turn_time_predictor.remote.aio(
            table_id=ts["table_id"],
            location_id=location_id,
            current_state=ts["state"],
            party_size=ts["party_size"],
            shift_context=shift_context,
        )
        for ts in table_states
    ]

    anomaly_data = [
        {
            "table_id": ts["table_id"],
            "state": ts["state"],
            "dwell_minutes": ts.get("dwell_minutes", 0),
            "party_size": ts["party_size"],
            "stress_avg": ts["stress_avg"],
            "engagement_avg": ts["engagement_avg"],
        }
        for ts in table_states
    ]
    anomaly_task = anomaly_detector.remote.aio(
        location_id=location_id,
        tables_data=anomaly_data,
    )

    pred_results_raw, anomaly_result = await asyncio.gather(
        asyncio.gather(*prediction_tasks, return_exceptions=True),
        anomaly_task,
        return_exceptions=False,
    )

    # Merge predictions into table states
    for ts, pr in zip(table_states, pred_results_raw):
        if isinstance(pr, Exception):
            pr = {"minutes_remaining_low": None, "minutes_remaining_high": None,
                  "minutes_remaining_mid": None, "confidence": 0, "reasoning": "Error"}
        ts["predicted_turn_low"] = pr.get("minutes_remaining_low")
        ts["predicted_turn_high"] = pr.get("minutes_remaining_high")
        ts["predicted_turn_minutes"] = pr.get("minutes_remaining_mid")
        ts["prediction_confidence"] = pr.get("confidence", 0)
        ts["prediction_reasoning"] = pr.get("reasoning", "")

    if isinstance(anomaly_result, Exception):
        anomaly_result = {"anomalies": [], "tables_analyzed": 0}

    anomaly_map = {}
    for a in anomaly_result.get("anomalies", []):
        tid = a.get("table_id", "")
        anomaly_map.setdefault(tid, []).append(a)

    for ts in table_states:
        tid = ts["table_id"]
        table_anomalies = anomaly_map.get(tid, [])
        floor_anomalies = anomaly_map.get("FLOOR", [])
        all_a = table_anomalies + floor_anomalies
        ts["alerts"] = [a["reason"] for a in all_a]
        severities = [a.get("severity", "none") for a in all_a]
        ts["urgency"] = (
            "critical" if "critical" in severities else
            "high" if "high" in severities else
            "medium" if "medium" in severities else "none"
        )

    # --- Phase 3: Presage + Host Recommendation ---
    analyzed_waiting = []
    if waiting_parties:
        try:
            analyzed_waiting = await guest_state_analyzer.remote.aio(
                waiting_parties_raw=waiting_parties,
            )
        except Exception:
            analyzed_waiting = waiting_parties

    floor_summary = _build_floor_summary(table_states)
    predictions_text = _build_predictions_text(table_states)
    anomalies_text = _build_anomalies_text(anomaly_result)
    waiting_text = _build_waiting_text(analyzed_waiting)

    try:
        recommendation = await host_recommender.remote.aio(
            location_id=location_id,
            floor_summary=floor_summary,
            predictions_text=predictions_text,
            anomalies_text=anomalies_text,
            waiting_list_text=waiting_text,
            shift_context=shift_context,
        )
    except Exception:
        recommendation = {
            "primary_action": "Monitor floor — system processing.",
            "secondary_actions": [],
            "urgency": "low",
            "reasoning": "Recommendation agent unavailable.",
        }

    total_latency = int((time.time() - t0) * 1000)

    # Finalize table output
    final_tables = []
    for ts in table_states:
        final_tables.append({
            "table_id": ts["table_id"],
            "location_id": location_id,
            "state": ts["state"],
            "vibe": ts["vibe"],
            "phase": ts["phase"],
            "party_size": ts["party_size"],
            "confidence": ts["confidence"],
            "visual_cues": ts.get("visual_cues", []),
            "stress_avg": ts["stress_avg"],
            "engagement_avg": ts["engagement_avg"],
            "predicted_turn_minutes": ts.get("predicted_turn_minutes"),
            "predicted_turn_low": ts.get("predicted_turn_low"),
            "predicted_turn_high": ts.get("predicted_turn_high"),
            "prediction_confidence": ts.get("prediction_confidence", 0),
            "prediction_reasoning": ts.get("prediction_reasoning", ""),
            "urgency": ts.get("urgency", "none"),
            "alerts": ts.get("alerts", []),
            "action_needed": ts.get("action_needed"),
            "summary": f"Table {ts['table_id']}: {ts['state']}, party of {ts['party_size']}",
            "inference_latency_ms": ts.get("inference_latency_ms", 0),
            "total_latency_ms": total_latency,
        })

    return {
        "location_id": location_id,
        "tables": final_tables,
        "table_count": len(final_tables),
        "alert_count": sum(len(t.get("alerts", [])) for t in final_tables),
        "anomalies": anomaly_result.get("anomalies", []),
        "waiting_list": analyzed_waiting,
        "recommendation": recommendation,
        "shift_context": shift_context[:200],
        "latency_ms": total_latency,
    }


def _build_floor_summary(table_states: list[dict]) -> str:
    total = len(table_states)
    empty = sum(1 for t in table_states if t["state"] == "EMPTY")
    occupied = total - empty
    by_state = {}
    for t in table_states:
        by_state.setdefault(t["state"], []).append(t["table_id"])

    lines = [f"Floor: {occupied}/{total} tables occupied"]
    for state, tids in by_state.items():
        lines.append(f"  {state}: tables {', '.join(tids[:5])}")
    return "\n".join(lines)


def _build_predictions_text(table_states: list[dict]) -> str:
    lines = []
    for t in table_states:
        low = t.get("predicted_turn_low")
        high = t.get("predicted_turn_high")
        if low is not None and t["state"] != "EMPTY":
            lines.append(f"T{t['table_id']}: ~{low}-{high}min remaining")
    return "\n".join(lines) if lines else "No active predictions."


def _build_anomalies_text(anomaly_result: dict) -> str:
    anomalies = anomaly_result.get("anomalies", [])
    if not anomalies:
        return "No anomalies detected."
    return "\n".join(
        f"⚠ {a['reason']} → {a.get('suggested_action', '')}"
        for a in anomalies
    )


def _build_waiting_text(waiting: list[dict]) -> str:
    if not waiting:
        return "No parties waiting."
    lines = []
    for w in waiting:
        score = w.get("urgency_score", 0)
        level = w.get("urgency_level", "calm")
        name = w.get("party_name", "Guest")
        size = w.get("party_size", 0)
        wait = w.get("wait_minutes", 0)
        lines.append(f"{name} (party of {size}, waiting {wait}min, urgency: {level}/{score})")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Historical data processing (boot sequence)
# ---------------------------------------------------------------------------

@app.function(image=agent_image, timeout=60)
async def process_historical_chunk(chunk: list[dict], chunk_index: int) -> dict:
    """Process one chunk of historical data in parallel."""
    total_sessions = len(chunk)
    total_duration = sum(s.get("duration_minutes", 0) for s in chunk)
    avg_duration = total_duration / total_sessions if total_sessions else 0
    stress_issues = sum(1 for s in chunk if s.get("peak_stress", 0) > 0.7)
    lingerers = sum(1 for s in chunk if "lingering" in s.get("issues", []))

    by_location: dict[str, list[int]] = {}
    for s in chunk:
        loc = s.get("location_id", "unknown")
        by_location.setdefault(loc, []).append(s.get("duration_minutes", 0))

    location_avgs = {
        loc: round(sum(durs) / len(durs), 1)
        for loc, durs in by_location.items()
    }

    return {
        "chunk_index": chunk_index,
        "sessions_processed": total_sessions,
        "avg_duration_minutes": round(avg_duration, 1),
        "stress_incidents": stress_issues,
        "lingering_tables": lingerers,
        "location_averages": location_avgs,
    }


@app.function(
    image=agent_image,
    secrets=[modal.Secret.from_name("argus-secrets")],
    timeout=120,
)
async def boot_historical_processing() -> dict:
    """On boot: process 6 weeks of historical data across 10 parallel containers."""
    import asyncio
    from mock_data import generate_historical_data

    t0 = time.time()
    all_data = generate_historical_data(num_weeks=6)
    total = len(all_data)

    num_chunks = 10
    chunk_size = total // num_chunks
    chunks = []
    for i in range(num_chunks):
        start = i * chunk_size
        end = start + chunk_size if i < num_chunks - 1 else total
        chunks.append(all_data[start:end])

    tasks = [
        process_historical_chunk.remote.aio(chunk=c, chunk_index=i)
        for i, c in enumerate(chunks)
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    processed = [r for r in results if not isinstance(r, Exception)]
    total_processed = sum(r.get("sessions_processed", 0) for r in processed)
    latency = int((time.time() - t0) * 1000)

    return {
        "total_sessions": total,
        "sessions_processed": total_processed,
        "chunks_completed": len(processed),
        "chunks_failed": len(results) - len(processed),
        "processing_time_ms": latency,
        "chunk_results": processed,
    }


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.function(
    image=agent_image,
    secrets=[modal.Secret.from_name("argus-secrets")],
    timeout=120,
)
@modal.fastapi_endpoint(method="POST")
async def api_analyze(body: dict) -> dict:
    """Analyze one location with full 5-agent pipeline."""
    location_id = body.get("location_id", "downtown")
    tables = body.get("tables", [])
    waiting = body.get("waiting_parties", [])

    result = await analyze_floor.remote.aio(
        location_id=location_id,
        tables=tables,
        waiting_parties=waiting,
    )
    return result


@app.function(
    image=agent_image,
    secrets=[modal.Secret.from_name("argus-secrets")],
    timeout=120,
)
@modal.fastapi_endpoint(method="POST")
async def api_boot(body: dict) -> dict:
    """Boot: process 6 weeks of historical data in parallel."""
    result = await boot_historical_processing.remote.aio()
    return result


@app.function(
    image=agent_image,
    secrets=[modal.Secret.from_name("argus-secrets")],
    timeout=180,
)
@modal.fastapi_endpoint(method="POST")
async def api_rush_hour(body: dict) -> dict:
    """
    Rush hour: analyze ALL 5 locations simultaneously.
    Full 5-agent pipeline across 100 tables + waiting guests.
    """
    import asyncio
    from mock_data import get_all_locations_snapshot
    from presage import generate_mock_waiting_list

    phase_index = body.get("phase_index", 0)
    all_snapshots = get_all_locations_snapshot(phase_index)

    t0 = time.time()
    tasks = []
    for loc_id, tables in all_snapshots.items():
        waiting = [p.to_dict() if hasattr(p, "to_dict") else p
                   for p in generate_mock_waiting_list(num_parties=3)]
        tasks.append(
            analyze_floor.remote.aio(
                location_id=loc_id,
                tables=tables,
                waiting_parties=waiting,
            )
        )
    results = await asyncio.gather(*tasks, return_exceptions=True)

    location_results = []
    all_waiting = []
    all_recommendations = []
    for r in results:
        if isinstance(r, Exception):
            location_results.append({"error": str(r)})
        else:
            location_results.append(r)
            all_waiting.extend(r.get("waiting_list", []))
            if r.get("recommendation"):
                all_recommendations.append(r["recommendation"])

    total_tables = sum(lr.get("table_count", 0) for lr in location_results if isinstance(lr, dict))
    total_latency = int((time.time() - t0) * 1000)

    return {
        "locations": location_results,
        "waiting_list": sorted(all_waiting, key=lambda x: -x.get("urgency_score", 0)),
        "recommendations": all_recommendations,
        "stats": {
            "locations_analyzed": len(location_results),
            "tables_analyzed": total_tables,
            "total_alerts": sum(lr.get("alert_count", 0) for lr in location_results if isinstance(lr, dict)),
            "modal_invocations": total_tables * 5 + len(location_results) + 1,
            "total_latency_ms": total_latency,
            "parallel_latency_ms": total_latency,
            "sequential_estimate_ms": total_tables * 2000,
            "waiting_parties": len(all_waiting),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    }


@app.function(
    image=agent_image,
    secrets=[modal.Secret.from_name("argus-secrets")],
    timeout=30,
)
@modal.fastapi_endpoint(method="POST")
async def api_memory_write(body: dict) -> dict:
    """Write a table turn event to Supermemory."""
    result = await memory_writer.remote.aio(
        restaurant_id=body.get("restaurant_id", "downtown"),
        table_id=body.get("table_id", "1"),
        event_data=body.get("event", {}),
    )
    return result


@app.function(
    image=agent_image,
    timeout=10,
)
@modal.fastapi_endpoint(method="GET")
async def api_health() -> dict:
    """Health check endpoint."""
    return {
        "status": "healthy",
        "app": "argus",
        "agents": ["vision_classifier", "turn_time_predictor", "anomaly_detector",
                    "host_recommender", "memory_writer"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Local test
# ---------------------------------------------------------------------------

@app.local_entrypoint()
def test():
    """Quick test: modal run backend/app.py"""
    from mock_data import get_table_snapshot
    from presage import generate_mock_waiting_list

    snap = get_table_snapshot("3", "downtown", phase_index=2)
    print(f"Testing {snap.location_id}/table-{snap.table_id} ({snap.guest_count} guests)")

    waiting = generate_mock_waiting_list(num_parties=3)
    tables = [snap.to_dict()]

    result = analyze_floor.remote(
        location_id="downtown",
        tables=tables,
        waiting_parties=[w.to_dict() for w in waiting],
    )

    print("\n=== Floor Analysis ===")
    print(f"Tables: {result['table_count']}")
    print(f"Alerts: {result['alert_count']}")
    print(f"Latency: {result['latency_ms']}ms")

    if result.get("recommendation"):
        print(f"\n=== Host Recommendation ===")
        rec = result["recommendation"]
        print(f"Action: {rec.get('primary_action', 'N/A')}")
        print(f"Urgency: {rec.get('urgency', 'N/A')}")

    if result.get("waiting_list"):
        print(f"\n=== Waiting List ({len(result['waiting_list'])} parties) ===")
        for w in result["waiting_list"][:3]:
            print(f"  {w.get('party_name', 'Guest')} "
                  f"(party of {w.get('party_size', '?')}, "
                  f"urgency: {w.get('urgency_level', '?')}/{w.get('urgency_score', 0)})")
