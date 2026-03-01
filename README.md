# A.R.G.U.S.

**Analytical Restaurant Guest & Utility System**

A.R.G.U.S. is a real-time restaurant floor intelligence system. It watches an overhead camera feed, detects every person on the floor, classifies table states, predicts when parties will leave, flags anomalies, and produces actionable recommendations for the host — all powered by a 5-agent AI pipeline running on Modal.

Named after Argus Panoptes, the hundred-eyed giant of Greek mythology who never slept.

## How it works

Every 60 seconds, A.R.G.U.S. runs a full analysis cycle:

1. **Vision Classifier** (CLIP ViT-L/14, fine-tuned) classifies each table into one of five states: Empty, Just Seated, Mid-Meal, Finishing, Check Stage
2. **Turn Predictor** (Llama 3.1 8B + Supermemory) queries historical patterns and estimates minutes until the party leaves
3. **Anomaly Detector** (Llama 3.1 8B + Sandbox) runs statistical analysis in an isolated container to catch outliers
4. **Host Recommender** (Llama 3.1 70B) synthesizes all agent outputs into a single natural-language action
5. **Memory Writer** (Supermemory) records structured events after each table turn so predictions improve over time

Person detection uses YOLOv8m with IoU-based tracking. Biometric signals (heart rate, engagement, frustration) are interpreted through Presage for waiting guests.

## Stack

- **Frontend**: Next.js 15, Tailwind CSS 4, Framer Motion
- **Backend**: Modal Labs (serverless GPU cloud)
- **Models**: CLIP ViT-L/14, Qwen2.5-VL 7B, Llama 3.1 8B/70B
- **Vision**: YOLOv8m for person detection and tracking
- **Memory**: Supermemory for persistent cross-session learning
- **Biometrics**: Presage for waiting guest urgency scoring

## Pages

- `/` — Live floor overview with 20-table grid, click-to-expand detail panels, host recommendations, waiting list
- `/history` — Historical analytics powered by real AI inference (sandbox + LLM), rush patterns, table performance, service quality
- `/demo` — Pre-rendered 120s demo video with synced tracking data and timeline
- `/about` — System overview, tech stack, and agent architecture

## Running locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Backend

The backend runs on Modal. To deploy:

```bash
modal deploy backend/app.py
```

To re-render the demo video:

```bash
modal run backend/demo_render.py
modal volume get argus-training-data demo/demo_web.mp4 public/demo/demo.mp4 --force
modal volume get argus-training-data demo/analysis_timeline.json public/demo/analysis_timeline.json --force
```

To run the training pipeline (frame extraction, VL labeling, CLIP fine-tuning, Supermemory population):

```bash
modal run backend/training.py --action full
```

## Environment

The Modal secret `argus-secrets` needs:

- `SUPERMEMORY_API_KEY` — for long-term memory reads/writes

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api-analyze` | POST | Full 5-agent analysis for one location |
| `/api-history` | POST | Historical analytics with AI inference |
| `/api-rush-hour` | POST | Rush hour mode across all locations |
| `/api-memory-write` | POST | Write a table turn event to Supermemory |
| `/api-health` | GET | Health check |
