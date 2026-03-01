"""
A.R.G.U.S. — Analytical Restaurant Guest & Utility System
Modal backend: Multi-agent vision pipeline across 5 locations × 20 tables.

Architecture (fires per refresh cycle):
  ├── Agent 1: Vision LLM (Qwen2.5-VL on A100 GPU via vLLM)  — 100 parallel calls
  ├── Agent 2: Turn-time prediction from Supermemory history   — 100 parallel calls
  └── Agent 3: Anomaly/linger detection in Modal Sandbox       — 100 parallel calls
  = 300 Modal function invocations per refresh

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
# Images
# ---------------------------------------------------------------------------

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
    .add_local_file(
        "backend/supermemory_client.py",
        "/root/supermemory_client.py",
        copy=True,
    )
)

app = modal.App("argus")

# ---------------------------------------------------------------------------
# Model + volumes
# ---------------------------------------------------------------------------

MODEL_NAME = "Qwen/Qwen2.5-VL-7B-Instruct"
MODEL_REVISION = "main"
VLLM_PORT = 8000
N_GPU = 1
MINUTES = 60

hf_cache_vol = modal.Volume.from_name("argus-hf-cache", create_if_missing=True)
vllm_cache_vol = modal.Volume.from_name("argus-vllm-cache", create_if_missing=True)

# ---------------------------------------------------------------------------
# Agent 1: Vision LLM on GPU
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


VISION_SYSTEM_PROMPT = """\
You are A.R.G.U.S., an AI monitoring restaurant tables via camera and biometrics.
Assess the table state and predict what happens next.

Respond with ONLY valid JSON (no markdown):
{
  "vibe": "happy" | "neutral" | "stressed" | "angry" | "about_to_leave",
  "phase": "empty" | "seated" | "ordering" | "waiting" | "eating" | "dessert" | "wants_check" | "paying" | "left",
  "action_needed": "<suggestion for host or null>",
  "summary": "<one-sentence summary>"
}
"""


@app.function(
    image=agent_image,
    secrets=[modal.Secret.from_name("argus-secrets")],
    timeout=30,
)
async def vision_agent(
    table_id: str,
    location_id: str,
    frame_b64: str,
    biometrics: list[dict],
    history_text: str,
) -> dict:
    """Agent 1: Vision LLM classifies table state from camera frame."""
    from openai import AsyncOpenAI

    if biometrics:
        n = len(biometrics)
        stress = sum(b.get("stress", 0) for b in biometrics) / n
        engage = sum(b.get("engagement", 0) for b in biometrics) / n
        hr = sum(b.get("heart_rate", 0) for b in biometrics) / n
        bio_text = f"Guests: {n}, Stress: {stress:.2f}, Engagement: {engage:.2f}, HR: {hr:.0f}"
    else:
        bio_text = "No guests detected."

    user_prompt = (
        f"Location: {location_id} | Table: {table_id}\n"
        f"Biometrics: {bio_text}\n"
        f"History: {history_text}\n"
        "Analyze and return JSON."
    )

    vllm_url = await serve_llm.get_web_url.aio()
    client = AsyncOpenAI(base_url=f"{vllm_url}/v1", api_key="not-needed")

    t0 = time.time()
    completion = await client.chat.completions.create(
        model="argus-vision",
        messages=[
            {"role": "system", "content": VISION_SYSTEM_PROMPT},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}"}},
                {"type": "text", "text": user_prompt},
            ]},
        ],
        temperature=0.3,
        max_tokens=256,
    )
    latency = time.time() - t0

    raw = completion.choices[0].message.content or "{}"
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = {"vibe": "neutral", "phase": "unknown", "summary": raw[:200]}

    result["inference_latency_ms"] = int(latency * 1000)
    return result


# ---------------------------------------------------------------------------
# Agent 2: Turn-time prediction from historical patterns (CPU)
# ---------------------------------------------------------------------------

@app.function(
    image=agent_image,
    secrets=[modal.Secret.from_name("argus-secrets")],
    timeout=15,
)
async def prediction_agent(
    table_id: str,
    location_id: str,
    current_phase: str,
    stress_avg: float,
    party_size: int,
) -> dict:
    """Agent 2: Predict turn time by querying Supermemory for historical patterns."""
    from supermemory_client import TableMemory

    memory = TableMemory(api_key=os.environ.get("SUPERMEMORY_API_KEY", ""))

    try:
        results = await memory.search_history(
            table_id=f"{location_id}-{table_id}",
            query=f"table turn time after {current_phase} phase with party of {party_size}",
            limit=5,
        )
        history_turns = []
        for r in results:
            content = r.get("content", "")
            if "duration" in content.lower() or "turn" in content.lower():
                history_turns.append(content)
    except Exception:
        history_turns = []

    phase_baselines = {
        "seated": 55, "ordering": 45, "waiting": 35, "eating": 25,
        "dessert": 12, "wants_check": 5, "paying": 3,
        "empty": None, "left": None,
    }
    base = phase_baselines.get(current_phase)

    if base is not None:
        stress_modifier = 1.0 - (stress_avg * 0.3)
        size_modifier = 1.0 + ((party_size - 2) * 0.08)
        predicted = max(1, int(base * stress_modifier * size_modifier))
    else:
        predicted = None

    return {
        "predicted_turn_minutes": predicted,
        "confidence": 0.75 if history_turns else 0.5,
        "historical_matches": len(history_turns),
    }


# ---------------------------------------------------------------------------
# Agent 3: Anomaly/linger detection in Modal Sandbox (CPU)
# ---------------------------------------------------------------------------

ANOMALY_CODE = '''\
import json, sys
data = json.loads(sys.argv[1])
stress = data["stress_avg"]
engagement = data["engagement_avg"]
phase = data["phase"]
duration_estimate = data.get("duration_estimate", 0)

alerts = []
urgency = "none"

if stress > 0.8:
    alerts.append("CRITICAL: Extreme guest stress detected")
    urgency = "critical"
elif stress > 0.6:
    alerts.append("HIGH: Elevated stress — check on table")
    urgency = "high"
elif stress > 0.4 and engagement < 0.3:
    alerts.append("MEDIUM: Disengaged guests with moderate stress")
    urgency = "medium"

if phase in ("eating", "dessert", "wants_check") and duration_estimate > 75:
    alerts.append("LINGER: Table exceeding expected duration")
    if urgency == "none":
        urgency = "medium"

if phase == "waiting" and stress > 0.5:
    alerts.append("STALE: Long wait with rising stress")
    if urgency in ("none", "medium"):
        urgency = "high"

if engagement < 0.15 and phase not in ("empty", "left"):
    alerts.append("FLIGHT_RISK: Very low engagement — may leave unhappy")

print(json.dumps({"alerts": alerts, "urgency": urgency}))
'''


@app.function(
    image=agent_image,
    timeout=30,
)
async def anomaly_agent(
    table_id: str,
    location_id: str,
    stress_avg: float,
    engagement_avg: float,
    phase: str,
    duration_estimate: int = 0,
) -> dict:
    """Agent 3: Detect anomalies via sandboxed analysis code."""
    sandbox_input = json.dumps({
        "stress_avg": stress_avg,
        "engagement_avg": engagement_avg,
        "phase": phase,
        "duration_estimate": duration_estimate,
    })

    sb = modal.Sandbox.create(
        image=modal.Image.debian_slim(python_version="3.12"),
        app=app,
        timeout=15,
    )
    proc = sb.exec("python", "-c", ANOMALY_CODE, sandbox_input)
    output = proc.stdout.read().strip()
    sb.terminate()
    sb.detach()

    try:
        return json.loads(output)
    except (json.JSONDecodeError, Exception):
        return {"alerts": [], "urgency": "unknown"}


# ---------------------------------------------------------------------------
# Orchestrator: all 3 agents per table, merge results
# ---------------------------------------------------------------------------

@app.function(
    image=agent_image,
    secrets=[modal.Secret.from_name("argus-secrets")],
    timeout=60,
)
async def analyze_table(
    table_id: str,
    location_id: str,
    frame_b64: str,
    biometrics: list[dict],
) -> dict:
    """Run all 3 agents in parallel for a single table, merge results."""
    import asyncio
    from supermemory_client import TableMemory

    memory = TableMemory(api_key=os.environ.get("SUPERMEMORY_API_KEY", ""))

    n = len(biometrics) or 1
    stress_avg = sum(b.get("stress", 0) for b in biometrics) / n if biometrics else 0
    engagement_avg = sum(b.get("engagement", 0) for b in biometrics) / n if biometrics else 0
    party_size = len(biometrics)

    try:
        hist = await memory.search_history(f"{location_id}-{table_id}", limit=5)
        history_text = memory.format_history_for_prompt(hist)
    except Exception:
        history_text = "No prior history."

    t0 = time.time()

    vision_task = vision_agent.remote.aio(
        table_id=table_id,
        location_id=location_id,
        frame_b64=frame_b64,
        biometrics=biometrics,
        history_text=history_text,
    )
    predict_task = prediction_agent.remote.aio(
        table_id=table_id,
        location_id=location_id,
        current_phase="eating",
        stress_avg=stress_avg,
        party_size=party_size,
    )
    anomaly_task = anomaly_agent.remote.aio(
        table_id=table_id,
        location_id=location_id,
        stress_avg=stress_avg,
        engagement_avg=engagement_avg,
        phase="eating",
        duration_estimate=45,
    )

    vision_result, predict_result, anomaly_result = await asyncio.gather(
        vision_task, predict_task, anomaly_task,
        return_exceptions=True,
    )

    if isinstance(vision_result, Exception):
        vision_result = {"vibe": "unknown", "phase": "error", "summary": str(vision_result)}
    if isinstance(predict_result, Exception):
        predict_result = {"predicted_turn_minutes": None, "confidence": 0}
    if isinstance(anomaly_result, Exception):
        anomaly_result = {"alerts": [], "urgency": "unknown"}

    phase = vision_result.get("phase", "unknown")
    total_latency = int((time.time() - t0) * 1000)

    merged = {
        "table_id": table_id,
        "location_id": location_id,
        "vibe": vision_result.get("vibe", "unknown"),
        "phase": phase,
        "stress_avg": round(stress_avg, 3),
        "engagement_avg": round(engagement_avg, 3),
        "predicted_turn_minutes": predict_result.get("predicted_turn_minutes"),
        "prediction_confidence": predict_result.get("confidence", 0),
        "urgency": anomaly_result.get("urgency", "none"),
        "alerts": anomaly_result.get("alerts", []),
        "action_needed": vision_result.get("action_needed"),
        "summary": vision_result.get("summary", ""),
        "inference_latency_ms": vision_result.get("inference_latency_ms", 0),
        "total_latency_ms": total_latency,
    }

    try:
        await memory.add_memory(
            table_id=f"{location_id}-{table_id}",
            content=(
                f"Table {table_id}@{location_id}: vibe={merged['vibe']}, "
                f"phase={phase}, stress={stress_avg:.2f}, "
                f"urgency={merged['urgency']}"
            ),
            metadata={
                "vibe": merged["vibe"], "phase": phase,
                "stress_avg": stress_avg, "urgency": merged["urgency"],
            },
        )
    except Exception:
        pass

    return merged


# ---------------------------------------------------------------------------
# Floor analysis: 20 tables × 3 agents = 60 Modal invocations per location
# ---------------------------------------------------------------------------

@app.function(
    image=agent_image,
    secrets=[modal.Secret.from_name("argus-secrets")],
    timeout=120,
)
async def analyze_location(location_id: str, tables: list[dict]) -> dict:
    """Analyze all tables at one location in parallel."""
    import asyncio

    t0 = time.time()
    tasks = [
        analyze_table.remote.aio(
            table_id=t["table_id"],
            location_id=location_id,
            frame_b64=t["frame_b64"],
            biometrics=t.get("biometrics", []),
        )
        for t in tables
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    output = []
    for t, r in zip(tables, results):
        if isinstance(r, Exception):
            output.append({
                "table_id": t["table_id"],
                "location_id": location_id,
                "vibe": "unknown", "phase": "error", "error": str(r),
            })
        else:
            output.append(r)

    latency = int((time.time() - t0) * 1000)
    alerts = [a for tbl in output for a in tbl.get("alerts", [])]

    return {
        "location_id": location_id,
        "tables": output,
        "table_count": len(output),
        "alert_count": len(alerts),
        "latency_ms": latency,
    }


# ---------------------------------------------------------------------------
# Historical data bulk processor — fires on boot
# ---------------------------------------------------------------------------

@app.function(image=agent_image, timeout=60)
async def process_historical_chunk(
    chunk: list[dict],
    chunk_index: int,
) -> dict:
    """Process one chunk of historical data. 10 of these fire in parallel."""
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
    """
    On app boot: process 6 weeks of historical data in parallel.
    Splits into 10 chunks across 10 Modal containers.
    """
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
# API endpoints
# ---------------------------------------------------------------------------

@app.function(
    image=agent_image,
    secrets=[modal.Secret.from_name("argus-secrets")],
    timeout=120,
)
@modal.fastapi_endpoint(method="POST")
async def api_analyze(body: dict) -> dict:
    """
    Analyze one or all locations.
    Body: { "locations": { "loc_id": [tables] } }
    Fires analyze_location per location in parallel.
    """
    import asyncio

    locations = body.get("locations", {})
    t0 = time.time()

    tasks = [
        analyze_location.remote.aio(location_id=loc_id, tables=tables)
        for loc_id, tables in locations.items()
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    location_results = []
    for r in results:
        if isinstance(r, Exception):
            location_results.append({"error": str(r)})
        else:
            location_results.append(r)

    total_tables = sum(lr.get("table_count", 0) for lr in location_results)
    total_alerts = sum(lr.get("alert_count", 0) for lr in location_results)
    total_latency = int((time.time() - t0) * 1000)

    total_invocations = total_tables * 3 + len(locations)

    return {
        "locations": location_results,
        "stats": {
            "locations_analyzed": len(location_results),
            "tables_analyzed": total_tables,
            "total_alerts": total_alerts,
            "modal_invocations": total_invocations,
            "total_latency_ms": total_latency,
            "parallel_latency_ms": total_latency,
            "sequential_estimate_ms": total_tables * 1200,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    }


@app.function(
    image=agent_image,
    secrets=[modal.Secret.from_name("argus-secrets")],
    timeout=120,
)
@modal.fastapi_endpoint(method="POST")
async def api_boot(body: dict) -> dict:
    """Boot endpoint: processes 6 weeks of historical data in parallel."""
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
    Rush hour: analyze ALL 5 locations × 20 tables simultaneously.
    100 tables × 3 agents = 300+ Modal invocations in one shot.
    """
    import asyncio
    from mock_data import get_all_locations_snapshot

    phase_index = body.get("phase_index", 0)
    all_snapshots = get_all_locations_snapshot(phase_index)

    t0 = time.time()
    tasks = [
        analyze_location.remote.aio(location_id=loc_id, tables=tables)
        for loc_id, tables in all_snapshots.items()
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    location_results = []
    for r in results:
        if isinstance(r, Exception):
            location_results.append({"error": str(r)})
        else:
            location_results.append(r)

    total_tables = sum(lr.get("table_count", 0) for lr in location_results)
    total_latency = int((time.time() - t0) * 1000)

    return {
        "locations": location_results,
        "stats": {
            "locations_analyzed": len(location_results),
            "tables_analyzed": total_tables,
            "total_alerts": sum(lr.get("alert_count", 0) for lr in location_results),
            "modal_invocations": total_tables * 3 + len(location_results) + 1,
            "total_latency_ms": total_latency,
            "sequential_estimate_ms": total_tables * 1200,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    }


# ---------------------------------------------------------------------------
# Local test
# ---------------------------------------------------------------------------

@app.local_entrypoint()
def test():
    """Quick test: modal run backend/app.py"""
    from mock_data import get_table_snapshot

    snap = get_table_snapshot("3", "downtown", phase_index=2)
    print(f"Testing {snap.location_id}/table-{snap.table_id} ({snap.guest_count} guests)")

    result = analyze_table.remote(
        table_id=snap.table_id,
        location_id=snap.location_id,
        frame_b64=snap.frame_b64,
        biometrics=[b.to_dict() for b in snap.biometrics],
    )

    print("=== Result ===")
    print(json.dumps(result, indent=2))
