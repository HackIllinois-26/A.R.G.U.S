"""
A.R.G.U.S. Training Pipeline — Modal-native GPU training + knowledge extraction.

Resource utilization (hard limits: 10 GPUs / 100 containers):
  - Frame extraction:  up to 70 CPU containers in parallel
  - VL labeling:       8 A100 GPUs, each running local vLLM with 4 concurrent
                       requests = 32 parallel frame analyses
  - CLIP fine-tuning:  1 A100 GPU
  - Knowledge + Supermemory: CPU containers
  Peak: 8 GPUs + ~9 containers (labeling) or 70 containers (extraction)

Three training targets:
  1. CLIP ViT-L/14 fine-tuning for 5-state table classification
  2. Supermemory population with behavioral patterns from footage
  3. Presage behavioral baselines from visual body language analysis

Volume layout:
  argus-training-data/
  ├── raw_videos/           uploaded restaurant footage
  ├── extracted_frames/     1 frame per 3 seconds per video
  ├── labeled_frames/       labels.json — state + confidence per frame
  ├── deep_analysis/        analysis.json — behavioral + biometric context
  ├── knowledge/            patterns.json + presage_baselines.json
  └── model_weights/        argus_classifier_v1.pt

Usage:
  modal run backend/training.py --action status
  modal run backend/training.py --action extract
  modal run backend/training.py --action label
  modal run backend/training.py --action knowledge
  modal run backend/training.py --action populate
  modal run backend/training.py --action train
  modal run backend/training.py --action export
  modal run backend/training.py --action full
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import modal

# ---------------------------------------------------------------------------
# Modal setup
# ---------------------------------------------------------------------------

app = modal.App("argus-training")

training_vol = modal.Volume.from_name("argus-training-data", create_if_missing=True)
VOL_PATH = "/data"

TABLE_STATES = ["EMPTY", "JUST_SEATED", "MID_MEAL", "FINISHING", "CHECK_STAGE"]

FOLDER_LABEL_MAP = {
    "empty": "EMPTY",
    "full": "MID_MEAL",
    "kinda_full": "JUST_SEATED",
}

# ---------------------------------------------------------------------------
# Resource budget — stay under 10 GPUs / 100 containers
# ---------------------------------------------------------------------------

MAX_GPU_LABELERS = 8   # 8 A100s for labeling  (2 spare)
GPU_CONCURRENCY = 4    # concurrent VL requests per GPU → 32 parallel total
MAX_CPU_WORKERS = 70   # CPU containers for frame extraction (30 spare)

# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------

extract_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install("opencv-python-headless", "Pillow", "httpx")
)

labeler_image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.8.0-devel-ubuntu22.04", add_python="3.12"
    )
    .entrypoint([])
    .uv_pip_install("vllm==0.13.0", "huggingface-hub==0.36.0", "httpx")
    .env({"HF_XET_HIGH_PERFORMANCE": "1"})
)

train_image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.8.0-devel-ubuntu22.04", add_python="3.12"
    )
    .entrypoint([])
    .uv_pip_install(
        "torch", "torchvision", "transformers", "Pillow",
        "huggingface-hub==0.36.0", "accelerate", "tqdm",
    )
    .env({"HF_XET_HIGH_PERFORMANCE": "1"})
)

knowledge_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("supermemory", "httpx")
)

hf_cache = modal.Volume.from_name("argus-hf-cache", create_if_missing=True)


# ---------------------------------------------------------------------------
# Step 1: Frame extraction — up to 70 CPU containers in parallel
# ---------------------------------------------------------------------------

@app.function(
    image=extract_image,
    volumes={VOL_PATH: training_vol},
    timeout=30 * 60,
    cpu=2,
    max_containers=MAX_CPU_WORKERS,
)
def extract_frames_from_video(
    video_path: str,
    fps_target: float = 1 / 3,
    source_label: str = "",
) -> dict:
    """Extract frames from a single video. One container per video, all parallel."""
    import cv2
    from PIL import Image as PILImage

    full_path = f"{VOL_PATH}/raw_videos/{video_path}"
    if not os.path.exists(full_path):
        return {"video": video_path, "error": "File not found", "frames": 0}

    cap = cv2.VideoCapture(full_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration_sec = total_frames / fps
    frame_interval = max(1, int(fps * (1 / fps_target)))

    stem = Path(video_path).stem
    label_prefix = source_label.replace(" ", "_") if source_label else "unlabeled"
    out_dir = f"{VOL_PATH}/extracted_frames/{label_prefix}__{stem}"
    os.makedirs(out_dir, exist_ok=True)

    extracted = 0
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % frame_interval == 0:
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img = PILImage.fromarray(frame_rgb)
            img = img.resize((640, 480), PILImage.LANCZOS)
            out_path = f"{out_dir}/frame_{extracted:06d}.jpg"
            img.save(out_path, "JPEG", quality=85)
            extracted += 1
        frame_idx += 1

    cap.release()
    training_vol.commit()

    return {
        "video": video_path,
        "source_label": source_label,
        "duration_seconds": round(duration_sec, 1),
        "extracted_frames": extracted,
    }


@app.function(image=extract_image, volumes={VOL_PATH: training_vol}, timeout=5 * 60)
def list_videos() -> list[dict]:
    """List all videos with source labels from folder structure."""
    video_dir = f"{VOL_PATH}/raw_videos"
    if not os.path.exists(video_dir):
        return []
    exts = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".flv"}
    videos = []
    for item in os.listdir(video_dir):
        full = os.path.join(video_dir, item)
        if os.path.isfile(full) and Path(item).suffix.lower() in exts:
            videos.append({"path": item, "label": "mixed"})
        elif os.path.isdir(full):
            for f in os.listdir(full):
                if Path(f).suffix.lower() in exts:
                    videos.append({"path": f"{item}/{f}", "label": item})
    return videos


@app.function(image=extract_image, volumes={VOL_PATH: training_vol}, timeout=5 * 60)
def count_extracted_frames() -> dict:
    """Count extracted frames per video directory."""
    base = f"{VOL_PATH}/extracted_frames"
    if not os.path.exists(base):
        return {"total": 0, "per_video": {}}
    counts = {}
    total = 0
    for d in os.listdir(base):
        dp = os.path.join(base, d)
        if os.path.isdir(dp):
            n = len([f for f in os.listdir(dp) if f.endswith(".jpg")])
            counts[d] = n
            total += n
    return {"total": total, "per_video": counts}


# ---------------------------------------------------------------------------
# Step 2: VL labeling — 8 A100 GPUs, each with local vLLM
# ---------------------------------------------------------------------------

LABELER_MODEL = "Qwen/Qwen2.5-VL-7B-Instruct"
LABELER_PORT = 8000

LABEL_PROMPT = """\
You are analyzing a restaurant security camera frame for the A.R.G.U.S. system.

TASK 1 — TABLE STATE CLASSIFICATION
Classify what you see into EXACTLY ONE of these 5 states:
  EMPTY — No guests present. Tables bare, reset, or being cleared.
  JUST_SEATED — Guests recently arrived. Menus may be open. No food yet.
  MID_MEAL — Food is on tables. Guests actively eating.
  FINISHING — Mostly empty plates, drinks remaining, pace slowing.
  CHECK_STAGE — Bill/card/cash visible, coats on, guests preparing to leave.

If you can see multiple tables, classify based on the DOMINANT state across the floor.

TASK 2 — BEHAVIORAL CONTEXT (for building restaurant knowledge)
Describe what you observe about:
  - How many people / tables are visible and their arrangement
  - Body language: leaning in (engaged), leaning back (relaxed/done), looking around (waiting), standing (leaving)
  - Movement: active service, waitstaff visible, eating or idle
  - Energy level: busy/hectic, calm/relaxed, or empty/quiet

TASK 3 — ESTIMATED BIOMETRICS (what Presage sensors would likely detect)
Based on visual cues, estimate biometric readings:
  - Stress level (0-1): tense posture, fidgeting = higher
  - Engagement (0-1): eye contact, animated conversation, eating = higher
  - Patience (0-1): relaxed posture = higher; pacing, checking phone = lower
  - Movement intensity (0-1): stationary=0, active eating=0.3, standing/leaving=0.8

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "state": "EMPTY" | "JUST_SEATED" | "MID_MEAL" | "FINISHING" | "CHECK_STAGE",
  "confidence": 0.0 to 1.0,
  "party_size_estimate": number (total visible guests, 0 if empty),
  "tables_visible": number,
  "tables_occupied": number,
  "visual_cues": ["list", "of", "key", "observations"],
  "body_language": "one sentence describing dominant body language",
  "energy_level": "empty" | "quiet" | "relaxed" | "moderate" | "busy" | "hectic",
  "service_activity": "none" | "minimal" | "moderate" | "active" | "rushed",
  "behavioral_notes": "2-3 sentences of rich behavioral context",
  "estimated_biometrics": {
    "avg_stress": 0.0 to 1.0,
    "avg_engagement": 0.0 to 1.0,
    "avg_patience": 0.0 to 1.0,
    "avg_movement": 0.0 to 1.0,
    "estimated_heart_rate": number (resting 65-75, stressed 85-100)
  }
}
"""


def _extract_json(raw: str) -> dict:
    """Extract JSON from VL model output that may be wrapped in markdown fences."""
    import re
    text = raw.strip()
    m = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if m:
        text = m.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    if start >= 0:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        break
    raise ValueError(f"No valid JSON found in: {text[:200]}")


@app.function(
    image=labeler_image,
    gpu="A100",
    volumes={VOL_PATH: training_vol, "/root/.cache/huggingface": hf_cache},
    timeout=30 * 60,
    max_containers=MAX_GPU_LABELERS,
)
async def label_chunk(frames: list[dict]) -> list[dict]:
    """
    Boot a local vLLM server on this GPU, then label every frame in the chunk.
    Called via .map() with 8 chunks → 8 A100 containers running in parallel.
    Each container processes ~N/8 frames with GPU_CONCURRENCY concurrent requests.
    """
    import asyncio
    import base64
    import subprocess

    import httpx

    chunk_id = os.getpid()
    n_frames = len(frames)
    print(f"[GPU-{chunk_id}] Booting vLLM for {n_frames} frames...")

    subprocess.Popen([
        "vllm", "serve", LABELER_MODEL,
        "--host", "0.0.0.0",
        "--port", str(LABELER_PORT),
        "--max-model-len", "4096",
        "--trust-remote-code",
        "--enforce-eager",
        "--dtype", "half",
        "--limit-mm-per-prompt", '{"image": 1}',
    ])

    base_url = f"http://localhost:{LABELER_PORT}"
    for attempt in range(120):
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                r = await c.get(f"{base_url}/health")
                if r.status_code == 200:
                    print(f"[GPU-{chunk_id}] vLLM ready after ~{attempt * 5}s")
                    break
        except Exception:
            pass
        await asyncio.sleep(5)
    else:
        return [{"rel_path": f["rel_path"], "source_dir": f["source_dir"],
                 "error": "vLLM failed to start"} for f in frames]

    sem = asyncio.Semaphore(GPU_CONCURRENCY)
    done = 0

    async def process_one(frame_info: dict) -> dict:
        nonlocal done
        rel = frame_info["rel_path"]
        src = frame_info["source_dir"]
        async with sem:
            fpath = f"{VOL_PATH}/{rel}"
            if not os.path.exists(fpath):
                return {"rel_path": rel, "source_dir": src, "error": "File not found"}
            try:
                with open(fpath, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode()

                async with httpx.AsyncClient(timeout=120) as client:
                    resp = await client.post(
                        f"{base_url}/v1/chat/completions",
                        json={
                            "model": LABELER_MODEL,
                            "messages": [{"role": "user", "content": [
                                {"type": "image_url",
                                 "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                                {"type": "text", "text": LABEL_PROMPT},
                            ]}],
                            "temperature": 0.1,
                            "max_tokens": 600,
                        },
                    )
                    data = resp.json()

                raw = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                r = _extract_json(raw)
                if r.get("state") not in TABLE_STATES:
                    r["state"] = "EMPTY"
                    r["confidence"] = 0.0
                parse_failed = False

            except (ValueError, json.JSONDecodeError):
                r = {"state": "EMPTY", "confidence": 0.0, "party_size_estimate": 0,
                     "visual_cues": [], "behavioral_notes": ""}
                parse_failed = True
                raw = raw if "raw" in dir() else ""
            except Exception as e:
                return {"rel_path": rel, "source_dir": src, "error": str(e)}

            done += 1
            if done % 10 == 0:
                print(f"[GPU-{chunk_id}] {done}/{n_frames}")

            return {
                "rel_path": rel,
                "source_dir": src,
                "labels": {
                    "state": r.get("state", "EMPTY"),
                    "confidence": r.get("confidence", 0),
                    "party_size": r.get("party_size_estimate", 0),
                    "visual_cues": r.get("visual_cues", []),
                },
                "deep": {
                    "state": r.get("state", "EMPTY"),
                    "confidence": r.get("confidence", 0),
                    "party_size_estimate": r.get("party_size_estimate", 0),
                    "tables_visible": r.get("tables_visible", 0),
                    "tables_occupied": r.get("tables_occupied", 0),
                    "body_language": r.get("body_language", ""),
                    "energy_level": r.get("energy_level", ""),
                    "service_activity": r.get("service_activity", ""),
                    "behavioral_notes": r.get("behavioral_notes", ""),
                    "estimated_biometrics": r.get("estimated_biometrics", {}),
                    "visual_cues": r.get("visual_cues", []),
                },
                "_parse_failed": parse_failed,
                "_raw_sample": (raw[:300] if parse_failed else ""),
            }

    results = await asyncio.gather(*(process_one(f) for f in frames))
    ok = sum(1 for r in results if "error" not in r)
    print(f"[GPU-{chunk_id}] Chunk done: {ok}/{n_frames} labeled")
    return results


@app.function(
    image=extract_image,
    volumes={VOL_PATH: training_vol},
    timeout=60 * 60,
)
def auto_label_all_frames() -> dict:
    """
    Orchestrator: split frames into 8 chunks, fan out to 8 GPU containers,
    collect results, and save labels + deep analysis to volume.
    """
    base = f"{VOL_PATH}/extracted_frames"
    all_frames: list[dict] = []
    for video_dir in sorted(os.listdir(base)):
        dp = os.path.join(base, video_dir)
        if os.path.isdir(dp):
            for fname in sorted(os.listdir(dp)):
                if fname.endswith(".jpg"):
                    all_frames.append({
                        "rel_path": f"extracted_frames/{video_dir}/{fname}",
                        "source_dir": video_dir,
                    })

    if not all_frames:
        return {"error": "No extracted frames found. Run frame extraction first."}

    total = len(all_frames)
    n_gpus = min(MAX_GPU_LABELERS, max(1, total // 5))

    chunks: list[list[dict]] = [[] for _ in range(n_gpus)]
    for i, frame in enumerate(all_frames):
        chunks[i % n_gpus].append(frame)

    print(f"Distributing {total} frames across {n_gpus} A100 GPUs")
    print(f"  {GPU_CONCURRENCY} concurrent per GPU = {n_gpus * GPU_CONCURRENCY} parallel analyses")
    print(f"  ~{len(chunks[0])} frames per GPU")
    for i, ch in enumerate(chunks):
        print(f"  GPU {i}: {len(ch)} frames")

    labels: dict = {}
    deep_analysis: dict = {}
    errors = 0
    parse_fails = 0
    raw_samples: list[str] = []
    labeled = 0

    for chunk_results in label_chunk.map(chunks):
        for r in chunk_results:
            if "error" in r:
                errors += 1
                if errors <= 3:
                    print(f"  Error: {r.get('rel_path', '?')}: {r['error']}")
                continue
            fp = r["rel_path"]
            labels[fp] = r["labels"]
            deep_analysis[fp] = {**r["deep"], "source_dir": r["source_dir"]}
            if r.get("_parse_failed"):
                parse_fails += 1
                if len(raw_samples) < 5:
                    raw_samples.append(r.get("_raw_sample", ""))
            labeled += 1
        print(f"  GPU chunk done — {labeled}/{total} labeled so far")

    os.makedirs(f"{VOL_PATH}/labeled_frames", exist_ok=True)
    with open(f"{VOL_PATH}/labeled_frames/labels.json", "w") as f:
        json.dump(labels, f, indent=2)

    os.makedirs(f"{VOL_PATH}/deep_analysis", exist_ok=True)
    with open(f"{VOL_PATH}/deep_analysis/analysis.json", "w") as f:
        json.dump(deep_analysis, f, indent=2)

    training_vol.commit()

    state_counts: dict[str, int] = {}
    for lbl in labels.values():
        st = lbl.get("state", "UNKNOWN")
        state_counts[st] = state_counts.get(st, 0) + 1

    return {
        "total_frames": total,
        "labeled": labeled,
        "gpu_containers": n_gpus,
        "parse_errors": parse_fails,
        "network_errors": errors,
        "state_distribution": state_counts,
        "raw_samples": raw_samples,
    }


# ---------------------------------------------------------------------------
# Step 3: Knowledge extraction — aggregate for Supermemory + Presage
# ---------------------------------------------------------------------------

@app.function(
    image=extract_image,
    volumes={VOL_PATH: training_vol},
    timeout=30 * 60,
)
def build_knowledge_base() -> dict:
    """Aggregate deep analysis into structured patterns for Supermemory and Presage baselines."""
    analysis_path = f"{VOL_PATH}/deep_analysis/analysis.json"
    if not os.path.exists(analysis_path):
        return {"error": "No deep analysis found. Run labeling first."}

    with open(analysis_path) as f:
        analysis = json.load(f)

    state_profiles: dict[str, dict] = {s: {
        "count": 0, "party_sum": 0, "tables_occ_sum": 0,
        "bio_sum": {"stress": 0, "engagement": 0, "patience": 0, "movement": 0, "hr": 0},
        "energy_levels": {}, "service_levels": {},
        "body_language_samples": [], "behavioral_notes_samples": [],
        "visual_cues_all": [],
    } for s in TABLE_STATES}

    for fp, a in analysis.items():
        state = a.get("state", "EMPTY")
        if state not in state_profiles:
            continue
        sp = state_profiles[state]
        sp["count"] += 1
        sp["party_sum"] += a.get("party_size_estimate", 0)
        sp["tables_occ_sum"] += a.get("tables_occupied", 0)

        bio = a.get("estimated_biometrics", {})
        sp["bio_sum"]["stress"] += bio.get("avg_stress", 0)
        sp["bio_sum"]["engagement"] += bio.get("avg_engagement", 0)
        sp["bio_sum"]["patience"] += bio.get("avg_patience", 0)
        sp["bio_sum"]["movement"] += bio.get("avg_movement", 0)
        sp["bio_sum"]["hr"] += bio.get("estimated_heart_rate", 72)

        el = a.get("energy_level", "unknown")
        sp["energy_levels"][el] = sp["energy_levels"].get(el, 0) + 1
        sa = a.get("service_activity", "unknown")
        sp["service_levels"][sa] = sp["service_levels"].get(sa, 0) + 1

        if (bl := a.get("body_language", "")) and len(sp["body_language_samples"]) < 20:
            sp["body_language_samples"].append(bl)
        if (bn := a.get("behavioral_notes", "")) and len(sp["behavioral_notes_samples"]) < 20:
            sp["behavioral_notes_samples"].append(bn)
        sp["visual_cues_all"].extend(a.get("visual_cues", []))

    patterns = {}
    presage_baselines = {}

    for state, sp in state_profiles.items():
        n = max(sp["count"], 1)
        avg_bio = {k: round(v / n, 3) for k, v in sp["bio_sum"].items()}

        cue_freq: dict[str, int] = {}
        for cue in sp["visual_cues_all"]:
            c = cue.lower().strip()
            cue_freq[c] = cue_freq.get(c, 0) + 1
        top_cues = sorted(cue_freq.items(), key=lambda x: -x[1])[:15]

        patterns[state] = {
            "sample_count": sp["count"],
            "avg_party_size": round(sp["party_sum"] / n, 1),
            "avg_tables_occupied": round(sp["tables_occ_sum"] / n, 1),
            "dominant_energy": max(sp["energy_levels"], key=sp["energy_levels"].get) if sp["energy_levels"] else "unknown",
            "energy_distribution": sp["energy_levels"],
            "dominant_service": max(sp["service_levels"], key=sp["service_levels"].get) if sp["service_levels"] else "unknown",
            "service_distribution": sp["service_levels"],
            "top_visual_cues": [c[0] for c in top_cues],
            "body_language_examples": sp["body_language_samples"][:10],
            "behavioral_notes_examples": sp["behavioral_notes_samples"][:10],
        }

        presage_baselines[state] = {
            "avg_stress": avg_bio["stress"],
            "avg_engagement": avg_bio["engagement"],
            "avg_patience": avg_bio["patience"],
            "avg_movement": avg_bio["movement"],
            "avg_heart_rate": round(avg_bio["hr"]),
            "stress_range": [max(0, round(avg_bio["stress"] - 0.15, 2)), min(1, round(avg_bio["stress"] + 0.15, 2))],
            "engagement_range": [max(0, round(avg_bio["engagement"] - 0.15, 2)), min(1, round(avg_bio["engagement"] + 0.15, 2))],
            "heart_rate_range": [max(60, round(avg_bio["hr"] - 8)), round(avg_bio["hr"] + 8)],
            "sample_count": sp["count"],
        }

    folder_validation: dict[str, dict] = {}
    for fp, a in analysis.items():
        src = a.get("source_dir", "")
        for folder_key, expected_state in FOLDER_LABEL_MAP.items():
            if folder_key in src.lower():
                folder_validation.setdefault(folder_key, {"total": 0, "correct": 0})
                folder_validation[folder_key]["total"] += 1
                if a.get("state") == expected_state:
                    folder_validation[folder_key]["correct"] += 1
                break
    for v in folder_validation.values():
        v["accuracy"] = round(v["correct"] / max(v["total"], 1), 3)

    os.makedirs(f"{VOL_PATH}/knowledge", exist_ok=True)
    with open(f"{VOL_PATH}/knowledge/patterns.json", "w") as f:
        json.dump({"generated_at": time.time(), "total_frames_analyzed": len(analysis),
                    "state_profiles": patterns, "folder_validation": folder_validation}, f, indent=2)

    with open(f"{VOL_PATH}/knowledge/presage_baselines.json", "w") as f:
        json.dump({"generated_at": time.time(),
                    "description": "Visual-to-biometric baseline mapping learned from restaurant footage",
                    "baselines": presage_baselines}, f, indent=2)

    training_vol.commit()

    return {
        "frames_analyzed": len(analysis),
        "states_profiled": {s: patterns[s]["sample_count"] for s in TABLE_STATES},
        "presage_baselines_generated": len(presage_baselines),
        "folder_validation": folder_validation,
    }


# ---------------------------------------------------------------------------
# Step 4: Push knowledge to Supermemory
# ---------------------------------------------------------------------------

@app.function(
    image=knowledge_image,
    secrets=[modal.Secret.from_name("argus-secrets")],
    volumes={VOL_PATH: training_vol},
    timeout=10 * 60,
)
async def populate_supermemory() -> dict:
    """Write extracted knowledge into Supermemory as permanent restaurant memories."""
    from supermemory import AsyncSupermemory

    api_key = os.environ.get("SUPERMEMORY_API_KEY", "")
    client = AsyncSupermemory(api_key=api_key)

    patterns_path = f"{VOL_PATH}/knowledge/patterns.json"
    baselines_path = f"{VOL_PATH}/knowledge/presage_baselines.json"

    if not os.path.exists(patterns_path):
        return {"error": "No knowledge base found. Run 'knowledge' step first."}

    with open(patterns_path) as f:
        knowledge = json.load(f)
    with open(baselines_path) as f:
        baselines_data = json.load(f)

    memories_written = 0

    for state, profile in knowledge.get("state_profiles", {}).items():
        if profile["sample_count"] == 0:
            continue
        content = (
            f"ARGUS Training Data — {state} state pattern (from {profile['sample_count']} frames): "
            f"Average party size: {profile['avg_party_size']}. "
            f"Dominant energy: {profile['dominant_energy']}. "
            f"Service activity: {profile['dominant_service']}. "
            f"Top visual cues: {', '.join(profile['top_visual_cues'][:8])}. "
        )
        if profile.get("body_language_examples"):
            content += f"Typical body language: {profile['body_language_examples'][0]}. "
        if profile.get("behavioral_notes_examples"):
            content += f"Context: {profile['behavioral_notes_examples'][0]}"

        await client.add(content=content)
        memories_written += 1

    for state, baseline in baselines_data.get("baselines", {}).items():
        if baseline["sample_count"] == 0:
            continue
        content = (
            f"ARGUS Presage Baseline — {state} state: "
            f"Expected stress: {baseline['avg_stress']:.2f} (range {baseline['stress_range'][0]}-{baseline['stress_range'][1]}). "
            f"Expected engagement: {baseline['avg_engagement']:.2f} (range {baseline['engagement_range'][0]}-{baseline['engagement_range'][1]}). "
            f"Expected heart rate: {baseline['avg_heart_rate']} bpm (range {baseline['heart_rate_range'][0]}-{baseline['heart_rate_range'][1]}). "
            f"Movement: {baseline['avg_movement']:.2f}. Patience: {baseline['avg_patience']:.2f}."
        )
        await client.add(content=content)
        memories_written += 1

    total_frames = knowledge.get("total_frames_analyzed", 0)
    state_dist = {s: knowledge["state_profiles"][s]["sample_count"] for s in TABLE_STATES}
    await client.add(
        content=(f"ARGUS Training Summary: Analyzed {total_frames} frames from restaurant security footage. "
                 f"State distribution: {json.dumps(state_dist)}. Baseline patterns and biometric expectations established."),
    )
    memories_written += 1

    validation = knowledge.get("folder_validation", {})
    if validation:
        val_text = "ARGUS Label Validation: " + " ".join(
            f"{k}: {v['accuracy']:.0%} ({v['correct']}/{v['total']})." for k, v in validation.items()
        )
        await client.add(content=val_text)
        memories_written += 1

    await client.close()
    return {
        "memories_written": memories_written,
        "states_documented": [s for s in TABLE_STATES if knowledge["state_profiles"][s]["sample_count"] > 0],
        "presage_baselines_stored": len([b for b in baselines_data["baselines"].values() if b["sample_count"] > 0]),
    }


# ---------------------------------------------------------------------------
# Step 5: Fine-tune CLIP ViT-L/14 (1 GPU)
# ---------------------------------------------------------------------------

@app.function(
    image=train_image,
    gpu="A100",
    volumes={VOL_PATH: training_vol, "/root/.cache/huggingface": hf_cache},
    timeout=6 * 60 * 60,
    max_containers=1,
)
def fine_tune_clip(
    epochs: int = 15,
    batch_size: int = 32,
    learning_rate: float = 1e-4,
    unfreeze_layers: int = 4,
    min_confidence: float = 0.6,
) -> dict:
    """Fine-tune CLIP ViT-L/14 with a 5-class head. Uses 1 A100."""
    import torch
    import torch.nn as nn
    from torch.utils.data import Dataset, DataLoader, random_split
    from torchvision import transforms
    from transformers import CLIPModel, CLIPProcessor
    from PIL import Image as PILImage
    from tqdm import tqdm

    labels_path = f"{VOL_PATH}/labeled_frames/labels.json"
    if not os.path.exists(labels_path):
        return {"error": "No labels found. Run auto-labeling first."}

    with open(labels_path) as f:
        all_labels = json.load(f)

    state_to_idx = {s: i for i, s in enumerate(TABLE_STATES)}
    samples = []
    for frame_path, lbl in all_labels.items():
        if lbl.get("confidence", 0) < min_confidence:
            continue
        state = lbl.get("state")
        if state not in state_to_idx:
            continue
        full_path = f"{VOL_PATH}/{frame_path}"
        if os.path.exists(full_path):
            samples.append((full_path, state_to_idx[state]))

    if len(samples) < 30:
        return {"error": f"Only {len(samples)} valid samples. Need at least 30."}

    print(f"Training on {len(samples)} samples across {len(TABLE_STATES)} classes")
    processor = CLIPProcessor.from_pretrained("openai/clip-vit-large-patch14")

    class FrameDataset(Dataset):
        def __init__(self, items):
            self.items = items
            self.transform = transforms.Compose([
                transforms.RandomHorizontalFlip(0.5),
                transforms.RandomRotation(5),
                transforms.ColorJitter(brightness=0.2, contrast=0.2),
            ])
        def __len__(self):
            return len(self.items)
        def __getitem__(self, idx):
            path, label = self.items[idx]
            img = PILImage.open(path).convert("RGB")
            img = self.transform(img)
            inputs = processor(images=img, return_tensors="pt")
            return inputs["pixel_values"].squeeze(0), label

    dataset = FrameDataset(samples)
    train_size = int(0.85 * len(dataset))
    val_size = len(dataset) - train_size
    train_ds, val_ds = random_split(dataset, [train_size, val_size])
    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, num_workers=2)
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False, num_workers=2)

    clip_model = CLIPModel.from_pretrained("openai/clip-vit-large-patch14")
    vision_encoder = clip_model.vision_model
    projection = clip_model.visual_projection
    proj_dim = clip_model.config.projection_dim

    for param in vision_encoder.parameters():
        param.requires_grad = False
    for layer in vision_encoder.encoder.layers[-unfreeze_layers:]:
        for param in layer.parameters():
            param.requires_grad = True
    for param in projection.parameters():
        param.requires_grad = True

    classifier_head = nn.Sequential(
        nn.LayerNorm(proj_dim), nn.Dropout(0.2),
        nn.Linear(proj_dim, 256), nn.GELU(), nn.Dropout(0.1),
        nn.Linear(256, len(TABLE_STATES)),
    )

    device = torch.device("cuda")
    vision_encoder, projection, classifier_head = (
        vision_encoder.to(device), projection.to(device), classifier_head.to(device)
    )

    params = (list(filter(lambda p: p.requires_grad, vision_encoder.parameters()))
              + list(projection.parameters()) + list(classifier_head.parameters()))
    optimizer = torch.optim.AdamW(params, lr=learning_rate, weight_decay=0.01)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    criterion = nn.CrossEntropyLoss()

    best_val_acc = 0.0
    history = []

    for epoch in range(epochs):
        vision_encoder.train(); classifier_head.train()
        train_loss = train_correct = train_total = 0

        for pixel_values, lbls in tqdm(train_loader, desc=f"Epoch {epoch+1}/{epochs}"):
            pixel_values, lbls = pixel_values.to(device), lbls.to(device)
            logits = classifier_head(projection(vision_encoder(pixel_values=pixel_values).pooler_output))
            loss = criterion(logits, lbls)
            optimizer.zero_grad(); loss.backward()
            torch.nn.utils.clip_grad_norm_(params, 1.0); optimizer.step()
            train_loss += loss.item() * lbls.size(0)
            train_correct += (logits.argmax(1) == lbls).sum().item()
            train_total += lbls.size(0)

        scheduler.step()
        vision_encoder.eval(); classifier_head.eval()
        val_correct = val_total = 0
        with torch.no_grad():
            for pv, lb in val_loader:
                pv, lb = pv.to(device), lb.to(device)
                logits = classifier_head(projection(vision_encoder(pixel_values=pv).pooler_output))
                val_correct += (logits.argmax(1) == lb).sum().item()
                val_total += lb.size(0)

        t_acc = train_correct / max(train_total, 1)
        v_acc = val_correct / max(val_total, 1)
        avg_loss = train_loss / max(train_total, 1)
        history.append({"epoch": epoch+1, "train_loss": round(avg_loss, 4),
                        "train_acc": round(t_acc, 4), "val_acc": round(v_acc, 4)})
        print(f"  Loss: {avg_loss:.4f} | Train: {t_acc:.3f} | Val: {v_acc:.3f}")

        if v_acc > best_val_acc:
            best_val_acc = v_acc
            wdir = f"{VOL_PATH}/model_weights"; os.makedirs(wdir, exist_ok=True)
            torch.save({
                "vision_encoder": vision_encoder.state_dict(),
                "projection": projection.state_dict(),
                "classifier_head": classifier_head.state_dict(),
                "table_states": TABLE_STATES, "val_acc": v_acc, "epoch": epoch+1,
                "clip_base": "openai/clip-vit-large-patch14",
            }, f"{wdir}/argus_classifier_v1.pt")
            training_vol.commit()
            print(f"  -> Saved best model (val_acc={v_acc:.3f})")

    return {"samples": len(samples), "train_size": train_size, "val_size": val_size,
            "epochs": epochs, "best_val_acc": round(best_val_acc, 4), "history": history}


# ---------------------------------------------------------------------------
# Export weights to inference volume
# ---------------------------------------------------------------------------

inference_vol = modal.Volume.from_name("argus-vllm-cache", create_if_missing=True)

@app.function(
    image=extract_image,
    volumes={VOL_PATH: training_vol, "/inference": inference_vol},
    timeout=5 * 60,
)
def export_weights_to_inference() -> dict:
    import shutil
    src = f"{VOL_PATH}/model_weights/argus_classifier_v1.pt"
    if not os.path.exists(src):
        return {"error": "No trained weights found."}
    dst_dir = "/inference/argus_weights"; os.makedirs(dst_dir, exist_ok=True)
    shutil.copy2(src, f"{dst_dir}/argus_classifier_v1.pt")
    inference_vol.commit()
    return {"exported_to": f"{dst_dir}/argus_classifier_v1.pt",
            "size_mb": round(os.path.getsize(src) / 1e6, 1)}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

@app.local_entrypoint()
def main(action: str = "status"):
    """
    Actions: status, extract, label, knowledge, populate, train, export, full
    """
    if action == "status":
        videos = list_videos.remote()
        print(f"\n{'='*60}")
        print(f"  A.R.G.U.S. TRAINING PIPELINE STATUS")
        print(f"  Budget: {MAX_GPU_LABELERS} GPUs / {MAX_CPU_WORKERS + MAX_GPU_LABELERS + 2} containers")
        print(f"{'='*60}")
        print(f"\n  Videos uploaded: {len(videos)}")
        by_label: dict[str, list] = {}
        for v in videos:
            by_label.setdefault(v["label"], []).append(v["path"])
        for label, paths in by_label.items():
            print(f"    [{label}] {len(paths)} videos")
            for p in paths[:3]:
                print(f"      - {p}")
            if len(paths) > 3:
                print(f"      ... and {len(paths)-3} more")

        counts = count_extracted_frames.remote()
        print(f"\n  Extracted frames: {counts['total']}")
        for vid, n in sorted(counts.get("per_video", {}).items()):
            print(f"    {vid}: {n} frames")

    elif action == "extract":
        videos = list_videos.remote()
        if not videos:
            print("\nNo videos found. Upload first.")
            return
        print(f"\nExtracting frames from {len(videos)} videos...")
        print(f"  (up to {MAX_CPU_WORKERS} concurrent CPU containers)")
        args = [(v["path"], 1/3, v["label"]) for v in videos]
        results = []
        for r in extract_frames_from_video.starmap(args):
            results.append(r)
            if "error" in r:
                print(f"  FAIL  {r['video']}: {r['error']}")
            else:
                print(f"  OK    {r['video']}: {r.get('extracted_frames', 0)} frames")
        total = sum(r.get("extracted_frames", 0) for r in results)
        print(f"\nTotal frames extracted: {total}")

    elif action == "label":
        print(f"\nAuto-labeling with {MAX_GPU_LABELERS} A100 GPUs ({GPU_CONCURRENCY} concurrent each)")
        print(f"  Max throughput: {MAX_GPU_LABELERS * GPU_CONCURRENCY} frames analyzed simultaneously")
        print(f"  Each GPU boots vLLM (~3-5 min cold-start), then processes its chunk")
        result = auto_label_all_frames.remote()
        if "error" in result:
            print(f"ERROR: {result['error']}")
        else:
            print(f"\nLabeled {result['labeled']}/{result['total_frames']} frames")
            print(f"GPU containers used: {result.get('gpu_containers', '?')}")
            print(f"State distribution: {result['state_distribution']}")
            if result.get("parse_errors"):
                print(f"Parse errors: {result['parse_errors']}")
            if result.get("network_errors"):
                print(f"Network errors: {result['network_errors']}")
            if result.get("raw_samples"):
                print("\nSample raw VL outputs (for debugging):")
                for i, s in enumerate(result["raw_samples"]):
                    print(f"  [{i+1}] {s[:200]}")

    elif action == "knowledge":
        print("\nBuilding knowledge base from deep analysis...")
        result = build_knowledge_base.remote()
        if "error" in result:
            print(f"ERROR: {result['error']}")
        else:
            print(f"\nFrames analyzed: {result['frames_analyzed']}")
            print(f"State profiles: {result['states_profiled']}")
            print(f"Presage baselines: {result['presage_baselines_generated']}")
            if result.get("folder_validation"):
                print(f"\nFolder label validation (auto-labeler vs your folder names):")
                for folder, stats in result["folder_validation"].items():
                    print(f"  {folder}: {stats['accuracy']:.0%} ({stats['correct']}/{stats['total']})")

    elif action == "populate":
        print("\nPushing knowledge to Supermemory...")
        result = populate_supermemory.remote()
        if "error" in result:
            print(f"ERROR: {result['error']}")
        else:
            print(f"\nMemories written: {result['memories_written']}")
            print(f"States documented: {result['states_documented']}")
            print(f"Presage baselines stored: {result['presage_baselines_stored']}")

    elif action == "train":
        print("\nFine-tuning CLIP ViT-L/14 (1 A100 GPU)...")
        result = fine_tune_clip.remote()
        if "error" in result:
            print(f"ERROR: {result['error']}")
        else:
            print(f"\nTraining complete!")
            print(f"  Samples: {result['samples']} | Best Val Acc: {result['best_val_acc']}")

    elif action == "export":
        result = export_weights_to_inference.remote()
        if "error" in result:
            print(f"ERROR: {result['error']}")
        else:
            print(f"Weights exported: {result['exported_to']} ({result['size_mb']} MB)")

    elif action == "full":
        print("=" * 60)
        print("  A.R.G.U.S. FULL TRAINING PIPELINE")
        print("  CLIP + Supermemory + Presage Baselines")
        print(f"  Resource budget: {MAX_GPU_LABELERS} GPUs / {MAX_CPU_WORKERS} CPU workers")
        print("=" * 60)
        print("\n[1/6] Extracting frames...")
        main.local("extract")
        print("\n[2/6] Auto-labeling + deep behavioral analysis...")
        main.local("label")
        print("\n[3/6] Building knowledge base...")
        main.local("knowledge")
        print("\n[4/6] Populating Supermemory...")
        main.local("populate")
        print("\n[5/6] Fine-tuning CLIP classifier...")
        main.local("train")
        print("\n[6/6] Exporting weights...")
        main.local("export")
        print("\n" + "=" * 60)
        print("  PIPELINE COMPLETE")
        print("=" * 60)

    else:
        print(f"Unknown action: {action}")
        print("Valid: status, extract, label, knowledge, populate, train, export, full")
