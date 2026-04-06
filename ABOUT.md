# A.R.G.U.S. — Analytical Restaurant Guest & Utility System

## Inspiration

Restaurant hosts face an impossible task: juggling dozens of tables, predicting when each will turn, and managing a waiting list—all while guests grow impatient. Existing tools treat every waiting party the same: first-come, first-served. But a party that arrived 15 minutes ago and is still relaxed shouldn't get the same priority as one that arrived 8 minutes ago and is showing exit signals. We were inspired by the idea that **restaurants could be more humane and efficient if they could see what guests actually need**, not just when they arrived.

We imagined a system that watches the floor like an attentive maître d'—understanding table states, predicting turn times, detecting anomalies, and incorporating human sensing on waiting guests. That vision became A.R.G.U.S.: a multi-agent AI system that learns from every service and gets smarter over time.

## What it does

A.R.G.U.S. is a full-stack restaurant intelligence platform that:

- **Classifies table states** — EMPTY, JUST_SEATED, MID_MEAL, FINISHING, CHECK_STAGE — using a fine-tuned vision model and Vision LLM fallback
- **Tracks every person** — Individual bounding boxes with persistent IDs, motion-based standing vs. seated detection, and table clustering for accurate guest counts
- **Predicts turn times** — Per-table wait estimates (e.g., "~8 min" for finishing, "~45 min" for just seated) informed by historical patterns. Estimates scale with party size: \( \text{wait} \propto n_{\text{guests}} \) for JUST_SEATED and MID_MEAL
- **Integrates Presage** — Per-table biometrics (stress, engagement, patience, movement, heart rate) derived from visual body language and behavioral analysis
- **Recommends host actions** — A single, actionable instruction updated every 60 seconds: *"Quote 10 minutes for the party of 3. Table 3 freeing in ~8 min. Party of 2 near door showing exit signals—seat them at bar now."*
- **Learns continuously** — Supermemory stores table-level, time-pattern, staff-pattern, and anomaly memories so the system adapts to each restaurant's unique behavior

The **Host Dashboard** shows a floor view with 20 table cards, a waiting list ordered by Presage urgency (not arrival time), and a live host recommendation. The **Demo tab** runs real restaurant footage through the full pipeline with overlaid tracking boxes, per-table states, and synced analysis.

## How we built it

**Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, Framer Motion. A single-screen, mobile-friendly dashboard with three panels: Floor View, Waiting List, and Host Recommendation.

**Backend (Modal):** A 5-agent inference pipeline that fires every 60 seconds:

1. **Vision Classifier** — Fine-tuned CLIP ViT-L/14 + Qwen2.5-VL-7B fallback on A100 for ambiguous cases
2. **Turn Time Predictor** — Llama 3.1 8B + Supermemory historical context
3. **Anomaly Detector** — Llama 3.1 8B + Modal Sandbox for custom statistical analysis
4. **Host Recommender** — Llama 3.1 70B on A100 for synthesis (strongest reasoning)
5. **Memory Writer** — Structured events to Supermemory after each table turn

**Training pipeline:** Restaurant footage → Modal Volume → frame extraction (1 frame/3s) → Qwen2.5-VL auto-labeling across 8 A100 GPUs → CLIP fine-tuning → Supermemory + Presage knowledge population. Resource budget: 8 GPUs, up to 70 CPU containers for extraction.

**Demo renderer:** YOLOv8m for person detection, IoU-based tracker for persistent IDs, motion detection (centroid displacement) for standing vs. seated, union-find table clustering, per-table state machine (JUST_SEATED → MID_MEAL → FINISHING → CHECK_STAGE → EMPTY), and per-table Presage biometrics. Exports a synced `analysis_timeline.json` so the sidebar matches the video HUD exactly.

**Integrations:** Supermemory for persistent restaurant memory, Presage (mocked) for human sensing on waiting guests.

## Challenges we ran into

- **Resource constraints** — We had hard limits of 10 GPUs and 100 containers. We refactored the labeling pipeline from a single vLLM web server to 8 parallel GPU containers, each running its own instance with 4 concurrent requests, maximizing throughput without exceeding limits.

- **Vision LLM output parsing** — Qwen2.5-VL sometimes returned JSON wrapped in markdown fences or with extra text. We built a robust `_extract_json` helper to strip fences and extract valid JSON from partial output.

- **YOLO false positives** — Carpets and decor were detected as chairs; standing people were labeled seated. We removed chair/table classes entirely, added motion-based standing detection (centroid displacement over 4 frames), and applied size filters to reject noise.

- **Data sync** — The video HUD and sidebar showed different numbers. We fixed this by exporting the exact analysis data used in the HUD to `analysis_timeline.json` and syncing the frontend to `video.currentTime`.

- **State machine timing** — For a 40-second demo, we compressed real-world meal durations into a visible progression. We used staggered offsets so tables appear at different lifecycle stages, creating state diversity across the floor.

## Accomplishments that we're proud of

- **Full person-tracking pipeline** — Every person gets a persistent ID (P1, P2, …), motion-based standing detection, and table assignment. No hardcoded data; everything comes from Modal.

- **Per-table Presage biometrics** — Each table has its own stress, engagement, patience, movement, and heart rate, derived from VL analysis and adjusted by table state. FINISHING tables show higher stress and lower patience; JUST_SEATED shows high engagement.

- **Per-table wait times** — EMPTY = "Available", others scale by state and party size. The host sees exactly when each table will free up.

- **End-to-end training** — From raw videos to fine-tuned CLIP, Supermemory knowledge, and Presage baselines—all on Modal with a single CLI.

- **Sleek, modern UI** — Dark theme, glass morphism, cyan accents, and smooth animations. The demo tab feels like a real operations dashboard.

## What we learned

- **Modal's strengths** — Volumes for persistent training data, GPU functions for vLLM and CLIP, CPU functions for orchestration, and Sandbox for safe dynamic code. The combination scales from prototype to production.

- **Vision + LLM hybrid** — A fast classifier (CLIP) with a reasoning fallback (VL) gives both speed and accuracy. The VL model's structured output (state, confidence, party size, behavioral notes) feeds downstream agents and Presage baselines.

- **Motion beats geometry** — For standing vs. seated, centroid displacement over frames outperformed bounding-box aspect ratio. We use \( \bar{d} = \frac{1}{k}\sum_{i} \|c_i - c_{i-1}\| \) over the last \(k\) frames; if \( \bar{d} > \max(8\,\text{px}, 0.03 \cdot h_{\text{bbox}}) \), the person is standing. People moving across the screen are standing; stationary people at tables are seated.

- **Supermemory's value** — Restaurant behavior is highly contextual (table, server, day, weather). A persistent memory layer that learns from every turn makes predictions dramatically more accurate than generic averages.

## What's next for A.R.G.U.S

- **Real Presage integration** — Connect the Presage SDK to a waiting-area camera for live biometrics instead of visual inference.

- **Fine-tuned CLIP in production** — Deploy the trained classifier from the training pipeline as the primary vision agent, with Qwen2.5-VL only for low-confidence cases.

- **Multi-camera fusion** — Combine feeds from table cameras and waiting-area cameras for a unified floor view.

- **Host feedback loop** — Let hosts correct predictions (e.g., "Table 7 actually freed in 12 min") so Supermemory learns from real outcomes.

- **Mobile app** — Native iOS/Android host app with push notifications for urgent recommendations and anomaly alerts.
