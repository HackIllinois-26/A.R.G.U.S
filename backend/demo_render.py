"""
A.R.G.U.S. Demo Video Renderer (v3)

Full person-tracking pipeline:
  - YOLOv8m detects every person per frame
  - IoU tracker assigns persistent IDs across frames
  - Motion detection (centroid displacement) → Standing vs Seated
  - Seated persons clustered into table groups (union-find)
  - Per-table state machine: JUST_SEATED → MID_MEAL → FINISHING → CHECK_STAGE → EMPTY
  - Per-table Presage biometrics derived from VL analysis + state context
  - Per-table wait-time estimates
  - Exports synced analysis_timeline.json for frontend sidebar

Usage:
  modal run backend/demo_render.py
  modal volume get argus-training-data demo/demo_web.mp4 public/demo/demo.mp4 --force
  modal volume get argus-training-data demo/analysis_timeline.json public/demo/analysis_timeline.json --force
"""

from __future__ import annotations

import json
import math
import os
import random

import modal

app = modal.App("argus-demo-render")

training_vol = modal.Volume.from_name("argus-training-data", create_if_missing=True)
VOL_PATH = "/data"

demo_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0", "fonts-dejavu-core")
    .pip_install("ultralytics", "opencv-python-headless", "Pillow", "numpy")
)

# ── constants ──────────────────────────────────────────────────────────────

MOTION_HISTORY = 4          # frames of centroid history for motion calc
MOTION_THRESHOLD_MIN = 8    # min pixels to count as moving
MOTION_THRESHOLD_PCT = 0.03 # or 3% of bbox height
MIN_TRACK_FRAMES = 2        # frames before track is considered stable
MAX_MISSING_FRAMES = 10     # frames before track is dropped
TABLE_CLUSTER_DIST = 280    # max pixels between seated persons in same table
IOU_MATCH_THRESH = 0.20     # minimum IoU for tracker matching
STANDING_ASPECT_RATIO = 1.7 # bbox h/w above this → likely standing (not just "not moving")
TABLE_REMATCH_DIST = 200    # max px between centroids to reuse a table slot

# compressed state durations for 40s demo (seconds)
STATE_THRESHOLDS = {
    "MID_MEAL": 7,
    "FINISHING": 20,
    "CHECK_STAGE": 32,
}

# stagger offsets (seconds before video start) for tables detected in first 2s
# creates visual state diversity across the floor
STAGGER_OFFSETS = [0, -8, -20, -30, -4, -14, -26, -10]

WAIT_TIMES = {
    "EMPTY":       "Available",
}

STATE_STYLE = {
    "EMPTY":       {"label": "EMPTY",       "rgb": (100, 116, 139)},
    "JUST_SEATED": {"label": "JUST SEATED", "rgb": (59, 130, 246)},
    "MID_MEAL":    {"label": "MID MEAL",    "rgb": (34, 197, 94)},
    "FINISHING":   {"label": "FINISHING",    "rgb": (249, 115, 22)},
    "CHECK_STAGE": {"label": "CHECK STAGE", "rgb": (239, 68, 68)},
}

TABLE_COLORS = [
    (0, 229, 255), (255, 167, 38), (171, 71, 188),
    (38, 198, 218), (255, 112, 67), (126, 87, 194),
    (102, 187, 106), (239, 83, 80),
]

STANDING_COLOR = (255, 193, 7)  # amber

YOLO_CLASSES_TRACK = {0}  # only track persons
YOLO_CLASSES_SHOW = {
    39: ("Bottle",     (0, 230, 118)),
    40: ("Wine Glass", (0, 230, 118)),
    41: ("Cup",        (0, 230, 118)),
    45: ("Bowl",       (76, 175, 80)),
    67: ("Phone",      (156, 39, 176)),
}


# ── helpers ────────────────────────────────────────────────────────────────

def _iou(a, b):
    x1 = max(a[0], b[0]); y1 = max(a[1], b[1])
    x2 = min(a[2], b[2]); y2 = min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / max(area_a + area_b - inter, 1)


def _centroid(box):
    return ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)


def _is_moving(history, bbox_h):
    if len(history) < MOTION_HISTORY + 1:
        return False
    total = 0.0
    for i in range(-MOTION_HISTORY, 0):
        dx = history[i][0] - history[i - 1][0]
        dy = history[i][1] - history[i - 1][1]
        total += math.hypot(dx, dy)
    avg = total / MOTION_HISTORY
    thresh = max(MOTION_THRESHOLD_MIN, bbox_h * MOTION_THRESHOLD_PCT)
    return avg > thresh


def _wait_time(state, first_seen_s, current_s):
    if state == "EMPTY":
        return "Available"
    elapsed = max(0, current_s - first_seen_s)
    m, s = divmod(int(elapsed), 60)
    return f"{m}:{s:02d} seated"


def _table_bio(table_state, guests, base_bio, table_id):
    rng = random.Random(table_id * 137)
    noise = lambda: rng.uniform(-0.06, 0.06)
    s  = base_bio.get("avg_stress", 0.2)
    e  = base_bio.get("avg_engagement", 0.7)
    p  = base_bio.get("avg_patience", 0.8)
    m  = base_bio.get("avg_movement", 0.2)
    hr = base_bio.get("estimated_heart_rate", 72)

    if table_state == "JUST_SEATED":
        e += 0.12;  p += 0.05;  s -= 0.05
    elif table_state == "MID_MEAL":
        e += 0.05;  s -= 0.05;  p += 0.02
    elif table_state == "FINISHING":
        p -= 0.18;  m += 0.12;  s += 0.08;  e -= 0.1
    elif table_state == "CHECK_STAGE":
        p -= 0.28;  s += 0.18;  m += 0.18;  e -= 0.2;  hr += 6

    clamp = lambda v: max(0, min(1, v))
    return {
        "stress":     round(clamp(s + noise()), 2),
        "engagement": round(clamp(e + noise()), 2),
        "patience":   round(clamp(p + noise()), 2),
        "movement":   round(clamp(m + noise()), 2),
        "heart_rate": max(58, min(115, int(hr + rng.randint(-4, 4)))),
    }


# ── tracker ────────────────────────────────────────────────────────────────

class PersonTrack:
    __slots__ = (
        "id", "bbox", "centroid_history", "moving", "status",
        "table_id", "missing", "age", "first_frame", "conf",
    )

    def __init__(self, tid, bbox, frame_idx, conf=0.0):
        self.id = tid
        self.bbox = bbox
        self.centroid_history = [_centroid(bbox)]
        self.moving = False
        self.status = "Unknown"
        self.table_id = None
        self.missing = 0
        self.age = 1
        self.first_frame = frame_idx
        self.conf = conf


class PersonTracker:
    def __init__(self):
        self._next = 1
        self.tracks: dict[int, PersonTrack] = {}

    def update(self, detections, frame_idx):
        """detections: list of (x1,y1,x2,y2, conf)"""
        matched_t = set()
        matched_d = set()

        pairs = []
        for di, det in enumerate(detections):
            for tid, trk in self.tracks.items():
                score = _iou(det[:4], trk.bbox)
                if score >= IOU_MATCH_THRESH:
                    pairs.append((score, di, tid))
        pairs.sort(reverse=True)

        for score, di, tid in pairs:
            if di in matched_d or tid in matched_t:
                continue
            det = detections[di]
            trk = self.tracks[tid]
            trk.bbox = det[:4]
            trk.conf = det[4]
            c = _centroid(det[:4])
            trk.centroid_history.append(c)
            if len(trk.centroid_history) > MOTION_HISTORY + 3:
                trk.centroid_history = trk.centroid_history[-(MOTION_HISTORY + 3):]
            bh = det[3] - det[1]
            bw = det[2] - det[0]
            trk.moving = _is_moving(trk.centroid_history, bh)
            if trk.moving or bh / max(bw, 1) > STANDING_ASPECT_RATIO:
                trk.status = "Standing"
            else:
                trk.status = "Seated"
            trk.missing = 0
            trk.age += 1
            matched_t.add(tid)
            matched_d.add(di)

        for di, det in enumerate(detections):
            if di in matched_d:
                continue
            t = PersonTrack(self._next, det[:4], frame_idx, det[4])
            bh = det[3] - det[1]
            bw = det[2] - det[0]
            t.status = "Standing" if bh / max(bw, 1) > STANDING_ASPECT_RATIO else "Seated"
            self.tracks[self._next] = t
            self._next += 1

        to_remove = []
        for tid, trk in self.tracks.items():
            if tid not in matched_t:
                trk.missing += 1
                if trk.missing > MAX_MISSING_FRAMES:
                    to_remove.append(tid)
        for tid in to_remove:
            del self.tracks[tid]

    def stable_tracks(self):
        return [t for t in self.tracks.values() if t.age >= MIN_TRACK_FRAMES]


# ── table manager ──────────────────────────────────────────────────────────

class TableGroup:
    __slots__ = (
        "id", "person_ids", "state", "first_seen_s", "guests",
        "missing_frames", "centroid",
    )

    def __init__(self, tid, pids, first_seen_s, centroid=(0, 0)):
        self.id = tid
        self.person_ids = set(pids)
        self.state = "JUST_SEATED"
        self.first_seen_s = first_seen_s
        self.guests = len(pids)
        self.missing_frames = 0
        self.centroid = centroid


class TableManager:
    def __init__(self, fps):
        self.tables: dict[int, TableGroup] = {}
        self._next = 1
        self.fps = fps
        self._stagger_applied = False

    def update(self, seated_persons, frame_idx, vl_state=None):
        """
        seated_persons: list of (person_id, cx, cy)
        Returns active tables sorted by id.
        """
        current_s = frame_idx / self.fps
        clusters = self._cluster(seated_persons)

        pid_pos = {pid: (cx, cy) for pid, cx, cy in seated_persons}
        matched_tables = set()
        unmatched_clusters = []

        for cpids in clusters:
            cpids_set = set(cpids)
            positions = [pid_pos[pid] for pid in cpids if pid in pid_pos]
            if not positions:
                continue
            cluster_centroid = (
                sum(p[0] for p in positions) / len(positions),
                sum(p[1] for p in positions) / len(positions),
            )

            best_tid = None
            best_overlap = 0
            for tid, tbl in self.tables.items():
                if tid in matched_tables:
                    continue
                overlap = len(cpids_set & tbl.person_ids)
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_tid = tid

            if best_tid and best_overlap > 0:
                tbl = self.tables[best_tid]
                tbl.person_ids = cpids_set
                tbl.guests = len(cpids_set)
                tbl.centroid = cluster_centroid
                tbl.missing_frames = 0
                self._update_state(tbl, current_s, vl_state)
                matched_tables.add(best_tid)
            else:
                unmatched_clusters.append((cpids, cluster_centroid))

        # Spatial fallback: match remaining clusters to nearby existing tables
        for cpids, centroid in unmatched_clusters:
            cpids_set = set(cpids)
            best_tid = None
            best_dist = TABLE_REMATCH_DIST
            for tid, tbl in self.tables.items():
                if tid in matched_tables:
                    continue
                dist = math.hypot(
                    centroid[0] - tbl.centroid[0],
                    centroid[1] - tbl.centroid[1],
                )
                if dist < best_dist:
                    best_dist = dist
                    best_tid = tid

            if best_tid:
                tbl = self.tables[best_tid]
                tbl.person_ids = cpids_set
                tbl.guests = len(cpids_set)
                tbl.centroid = centroid
                tbl.missing_frames = 0
                self._update_state(tbl, current_s, vl_state)
                matched_tables.add(best_tid)
            else:
                tbl = TableGroup(self._next, cpids, current_s, centroid)
                self.tables[self._next] = tbl
                matched_tables.add(self._next)
                self._next += 1

        for tid in list(self.tables.keys()):
            if tid not in matched_tables:
                tbl = self.tables[tid]
                tbl.missing_frames += 1
                if tbl.missing_frames > self.fps * 4:
                    tbl.state = "EMPTY"
                    tbl.person_ids = set()
                    tbl.guests = 0

        # Purge tables that have been empty for a long time
        to_remove = [
            tid for tid, tbl in self.tables.items()
            if tbl.state == "EMPTY" and tbl.missing_frames > self.fps * 10
        ]
        for tid in to_remove:
            del self.tables[tid]

        # stagger initial tables for state diversity
        if not self._stagger_applied and current_s < 2.5 and len(self.tables) >= 2:
            self._stagger_applied = True
            for i, tbl in enumerate(sorted(self.tables.values(), key=lambda t: t.id)):
                if i < len(STAGGER_OFFSETS) and tbl.guests > 0:
                    tbl.first_seen_s = current_s + STAGGER_OFFSETS[i]
                    self._update_state(tbl, current_s, vl_state)

        return sorted(
            [t for t in self.tables.values() if t.guests > 0 or t.state != "EMPTY"],
            key=lambda t: t.id,
        )

    def _update_state(self, tbl, now_s, vl_state):
        if tbl.guests == 0:
            tbl.state = "EMPTY"
            return
        dur = now_s - tbl.first_seen_s
        if dur >= STATE_THRESHOLDS["CHECK_STAGE"]:
            tbl.state = "CHECK_STAGE"
        elif dur >= STATE_THRESHOLDS["FINISHING"]:
            tbl.state = "FINISHING"
        elif dur >= STATE_THRESHOLDS["MID_MEAL"]:
            tbl.state = "MID_MEAL"
        else:
            tbl.state = "JUST_SEATED"
        # VL hint can accelerate
        if vl_state == "MID_MEAL" and tbl.state == "JUST_SEATED" and dur > 4:
            tbl.state = "MID_MEAL"
        if vl_state == "FINISHING" and tbl.state == "MID_MEAL" and dur > 12:
            tbl.state = "FINISHING"

    @staticmethod
    def _cluster(seated, threshold=TABLE_CLUSTER_DIST):
        if not seated:
            return []
        n = len(seated)
        parent = list(range(n))

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a, b):
            a, b = find(a), find(b)
            if a != b:
                parent[a] = b

        for i in range(n):
            for j in range(i + 1, n):
                dist = math.hypot(
                    seated[i][1] - seated[j][1],
                    seated[i][2] - seated[j][2],
                )
                if dist < threshold:
                    union(i, j)

        groups: dict[int, list] = {}
        for i in range(n):
            r = find(i)
            groups.setdefault(r, []).append(seated[i][0])
        return list(groups.values())


# ── video selection ────────────────────────────────────────────────────────

def _pick_best_video():
    analysis_path = f"{VOL_PATH}/deep_analysis/analysis.json"
    with open(analysis_path) as f:
        analysis = json.load(f)

    scores: dict[str, int] = {}
    frames_by_dir: dict[str, list] = {}

    for fpath, data in analysis.items():
        parts = fpath.split("/")
        if len(parts) < 3:
            continue
        vdir = parts[1]
        scores.setdefault(vdir, 0)
        frames_by_dir.setdefault(vdir, [])

        state = data.get("state", "EMPTY")
        party = data.get("party_size_estimate", 0)
        score = party * 3
        if state == "MID_MEAL":
            score += 15
        elif state in ("FINISHING", "CHECK_STAGE"):
            score += 10
        elif state == "JUST_SEATED":
            score += 5
        scores[vdir] += score
        frames_by_dir[vdir].append((fpath, data))

    best = max(scores, key=scores.get)

    parts = best.split("__", 1)
    stem = parts[1] if len(parts) > 1 else parts[0]
    raw_dir = f"{VOL_PATH}/raw_videos"
    video_file = None
    for root, _, files in os.walk(raw_dir):
        for f in files:
            if stem in f:
                video_file = os.path.join(root, f)
                break
        if video_file:
            break

    return best, video_file or "", frames_by_dir.get(best, [])


# ── main render ────────────────────────────────────────────────────────────

@app.function(
    image=demo_image,
    gpu="T4",
    volumes={VOL_PATH: training_vol},
    timeout=30 * 60,
)
def render_demo_video(max_seconds: int = 40, fps_out: int = 12) -> dict:
    import cv2
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont
    from ultralytics import YOLO

    best_dir, video_file, analysis_frames = _pick_best_video()
    if not video_file:
        return {"error": f"No source video for {best_dir}"}
    print(f"Best: {best_dir}\nSource: {video_file}")

    model = YOLO("yolov8m.pt")

    cap = cv2.VideoCapture(video_file)
    fps_in = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_in = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"Input: {int(cap.get(3))}x{int(cap.get(4))} @ {fps_in:.1f}fps, {total_in/fps_in:.0f}s")

    W, H = 1280, 720
    frame_interval = max(1, round(fps_in / fps_out))
    max_out = max_seconds * fps_out
    frame_area = W * H

    # VL analysis lookup
    frame_lookup: dict[str, dict] = {}
    for fp, data in analysis_frames:
        frame_lookup[fp.split("/")[-1]] = data
    sorted_keys = sorted(frame_lookup.keys())

    os.makedirs(f"{VOL_PATH}/demo", exist_ok=True)
    raw_path = f"{VOL_PATH}/demo/demo_raw.mp4"
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(raw_path, fourcc, fps_out, (W, H))

    try:
        font_title = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 24)
        font_lg = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)
        font_md = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 15)
        font_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
        font_xs = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 11)
    except Exception:
        font_title = font_lg = font_md = font_sm = font_xs = ImageFont.load_default()

    tracker = PersonTracker()
    table_mgr = TableManager(fps_out)

    idx_in = 0
    count_out = 0
    cur_vl: dict | None = None
    timeline: list[dict] = []
    last_export_s = -1.0
    last_vl_idx = -1

    while count_out < max_out:
        ret, frame = cap.read()
        if not ret:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            idx_in = 0
            ret, frame = cap.read()
            if not ret:
                break

        if idx_in % frame_interval != 0:
            idx_in += 1
            continue
        idx_in += 1

        frame = cv2.resize(frame, (W, H))
        current_s = count_out / fps_out

        # VL analysis (changes every 3s)
        vl_idx = min(int(current_s / 3), len(sorted_keys) - 1) if sorted_keys else -1
        if vl_idx >= 0:
            cur_vl = frame_lookup[sorted_keys[vl_idx]]

        vl_state = cur_vl.get("state", "EMPTY") if cur_vl else "EMPTY"
        vl_bio = cur_vl.get("estimated_biometrics", {}) if cur_vl else {}

        # ── YOLO detection ──
        results = model(frame, verbose=False, conf=0.35)

        person_dets: list[tuple] = []
        other_dets: list[tuple] = []

        for r in results:
            for box in r.boxes:
                cid = int(box.cls[0])
                conf = float(box.conf[0])
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                box_area = (x2 - x1) * (y2 - y1)
                if box_area > frame_area * 0.35 or box_area < 300:
                    continue

                if cid in YOLO_CLASSES_TRACK and conf >= 0.35:
                    person_dets.append((x1, y1, x2, y2, conf))
                elif cid in YOLO_CLASSES_SHOW and conf >= 0.40:
                    label, color = YOLO_CLASSES_SHOW[cid]
                    other_dets.append((x1, y1, x2, y2, label, conf, color))

        # ── update tracker ──
        tracker.update(person_dets, count_out)
        stable = tracker.stable_tracks()

        seated_for_tables = [
            (t.id, t.centroid_history[-1][0], t.centroid_history[-1][1])
            for t in stable if t.status == "Seated"
        ]
        tables = table_mgr.update(seated_for_tables, count_out, vl_state)

        # assign table_id back to persons
        pid_to_table: dict[int, int] = {}
        for tbl in tables:
            for pid in tbl.person_ids:
                pid_to_table[pid] = tbl.id
        for t in stable:
            t.table_id = pid_to_table.get(t.id)

        # ── draw other objects ──
        overlay = frame.copy()
        for x1, y1, x2, y2, _, _, color in other_dets:
            cv2.rectangle(overlay, (x1, y1), (x2, y2), color, -1)
        cv2.addWeighted(overlay, 0.06, frame, 0.94, 0, frame)
        for x1, y1, x2, y2, _, _, color in other_dets:
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 1)

        # ── draw person boxes (seated only — standing people are tracked but not boxed) ──
        for trk in stable:
            if trk.status == "Standing":
                continue

            x1, y1, x2, y2 = trk.bbox

            if trk.table_id is not None:
                cidx = (trk.table_id - 1) % len(TABLE_COLORS)
                color = TABLE_COLORS[cidx]
            else:
                color = (0, 229, 255)

            # semi-transparent fill
            ov2 = frame.copy()
            cv2.rectangle(ov2, (x1, y1), (x2, y2), color, -1)
            cv2.addWeighted(ov2, 0.08, frame, 0.92, 0, frame)

            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

            cl = min(16, (x2 - x1) // 5, (y2 - y1) // 5)
            for cx, cy, dx, dy in [
                (x1, y1, 1, 1), (x2, y1, -1, 1),
                (x1, y2, 1, -1), (x2, y2, -1, -1),
            ]:
                cv2.line(frame, (cx, cy), (cx + cl * dx, cy), color, 3)
                cv2.line(frame, (cx, cy), (cx, cy + cl * dy), color, 3)

        # ── PIL HUD ──
        pil = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).convert("RGBA")
        hud = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        draw = ImageDraw.Draw(hud)

        # Top bar
        draw.rectangle([0, 0, W, 48], fill=(3, 7, 18, 210))
        draw.text((16, 10), "A.R.G.U.S.", fill=(0, 229, 255, 255), font=font_title)
        draw.text((175, 16), "VISION SYSTEM", fill=(148, 163, 184, 255), font=font_md)

        standing_count = sum(1 for t in stable if t.status == "Standing")
        seated_count = sum(1 for t in stable if t.status == "Seated")
        draw.text(
            (W - 320, 16),
            f"TRACKING {len(stable)} | {seated_count} seated  {standing_count} standing",
            fill=(148, 163, 184, 255), font=font_sm,
        )
        draw.text((W - 100, 16), f"F {count_out:04d}", fill=(100, 116, 139, 255), font=font_sm)
        draw.rectangle([0, 48, W, 50], fill=(0, 229, 255, 60))

        # Person labels (seated only)
        for trk in stable:
            if trk.status == "Standing":
                continue

            x1, y1, x2, y2 = trk.bbox
            if trk.table_id is not None:
                cidx = (trk.table_id - 1) % len(TABLE_COLORS)
                color = TABLE_COLORS[cidx]
            else:
                color = (0, 229, 255)

            tag = f"P{trk.id} Seated"
            if trk.table_id is not None:
                tag += f" T{trk.table_id}"
            bb = draw.textbbox((0, 0), tag, font=font_sm)
            tw, th = bb[2] - bb[0], bb[3] - bb[1]
            draw.rectangle([x1, y1 - th - 8, x1 + tw + 12, y1], fill=(*color, 210))
            draw.text((x1 + 6, y1 - th - 5), tag, fill=(255, 255, 255, 255), font=font_sm)

        # Other object labels
        for x1, y1, x2, y2, label, conf, color in other_dets:
            txt = f"{label} {conf:.0%}"
            bb = draw.textbbox((0, 0), txt, font=font_xs)
            tw = bb[2] - bb[0]; th = bb[3] - bb[1]
            draw.rectangle([x1, y1 - th - 6, x1 + tw + 8, y1], fill=(*color, 180))
            draw.text((x1 + 4, y1 - th - 4), txt, fill=(255, 255, 255, 255), font=font_xs)

        # ── Bottom panel: table states + biometrics ──
        panel_h = 80
        py = H - panel_h
        draw.rectangle([0, py, W, H], fill=(3, 7, 18, 225))
        draw.rectangle([0, py, W, py + 2], fill=(0, 229, 255, 50))

        # Table summary cards along the bottom
        tx = 16
        for tbl in tables[:6]:
            sc = STATE_STYLE.get(tbl.state, STATE_STYLE["EMPTY"])
            wt = _wait_time(tbl.state, tbl.first_seen_s, current_s)
            bio = _table_bio(tbl.state, tbl.guests, vl_bio, tbl.id)

            draw.rectangle([tx, py + 6, tx + 190, py + 72], fill=(15, 23, 42, 220), outline=(*sc["rgb"], 100))
            draw.rectangle([tx, py + 6, tx + 4, py + 72], fill=(*sc["rgb"], 255))

            draw.text((tx + 10, py + 8), f"Table {tbl.id}", fill=(255, 255, 255, 255), font=font_sm)
            draw.text((tx + 10, py + 24), sc["label"], fill=(*sc["rgb"], 255), font=font_md)
            draw.text((tx + 10, py + 44), f"{tbl.guests} guests | {wt}", fill=(148, 163, 184, 255), font=font_xs)

            # mini biometric bars
            metrics = [
                ("S", bio["stress"], (239, 68, 68)),
                ("E", bio["engagement"], (34, 197, 94)),
                ("P", bio["patience"], (59, 130, 246)),
            ]
            bar_x = tx + 10
            bar_y = py + 60
            for lbl, val, c in metrics:
                draw.text((bar_x, bar_y), lbl, fill=(*c, 200), font=font_xs)
                bx = bar_x + 10
                draw.rectangle([bx, bar_y + 3, bx + 40, bar_y + 7], fill=(30, 41, 59, 255))
                fw = max(1, int(40 * val))
                draw.rectangle([bx, bar_y + 3, bx + fw, bar_y + 7], fill=(*c, 255))
                bar_x += 58

            tx += 200
            if tx + 200 > W:
                break

        comp = Image.alpha_composite(pil, hud)
        out_bgr = cv2.cvtColor(np.array(comp.convert("RGB")), cv2.COLOR_RGB2BGR)
        writer.write(out_bgr)

        # ── export timeline entry every ~1s ──
        if current_s - last_export_s >= 0.95:
            last_export_s = current_s
            tbl_data = []
            for tbl in tables:
                bio = _table_bio(tbl.state, tbl.guests, vl_bio, tbl.id)
                tbl_data.append({
                    "id": tbl.id,
                    "state": tbl.state,
                    "guests": tbl.guests,
                    "wait_time": _wait_time(tbl.state, tbl.first_seen_s, current_s),
                    "seated_since": round(tbl.first_seen_s, 1),
                    "biometrics": bio,
                })

            persons_data = []
            for trk in stable:
                persons_data.append({
                    "id": trk.id,
                    "status": trk.status,
                    "table_id": trk.table_id,
                })

            timeline.append({
                "t": round(current_s, 1),
                "vl_state": vl_state,
                "vl_confidence": cur_vl.get("confidence", 0) if cur_vl else 0,
                "total_guests": len(stable),
                "seated": seated_count,
                "standing": standing_count,
                "energy_level": cur_vl.get("energy_level", "unknown") if cur_vl else "unknown",
                "service_activity": cur_vl.get("service_activity", "unknown") if cur_vl else "unknown",
                "body_language": cur_vl.get("body_language", "") if cur_vl else "",
                "behavioral_notes": cur_vl.get("behavioral_notes", "") if cur_vl else "",
                "tables": tbl_data,
                "persons": persons_data,
            })

        count_out += 1
        if count_out % 48 == 0:
            print(f"  {count_out}/{max_out}  tracking {len(stable)} persons, {len(tables)} tables")

    cap.release()
    writer.release()

    web_path = f"{VOL_PATH}/demo/demo_web.mp4"
    os.system(
        f'ffmpeg -y -i "{raw_path}" -c:v libx264 -preset fast -crf 22 '
        f'-pix_fmt yuv420p -movflags +faststart -an "{web_path}"'
    )

    timeline_path = f"{VOL_PATH}/demo/analysis_timeline.json"
    with open(timeline_path, "w") as f:
        json.dump({
            "duration": round(count_out / fps_out, 1),
            "fps": fps_out,
            "frames": count_out,
            "entries": timeline,
        }, f, indent=2)

    training_vol.commit()

    sz = os.path.getsize(web_path) if os.path.exists(web_path) else 0
    return {
        "video_dir": best_dir,
        "source": video_file,
        "frames": count_out,
        "duration_s": round(count_out / fps_out, 1),
        "size_mb": round(sz / 1e6, 1),
        "timeline_entries": len(timeline),
        "output_video": "demo/demo_web.mp4",
        "output_json": "demo/analysis_timeline.json",
    }


@app.local_entrypoint()
def main():
    print("Rendering A.R.G.U.S. demo video (v3 — full tracking)...")
    r = render_demo_video.remote()
    if "error" in r:
        print(f"ERROR: {r['error']}")
    else:
        print(f"\nRendered!")
        print(f"  Source: {r['source']}")
        print(f"  Duration: {r['duration_s']}s  ({r['frames']} frames)")
        print(f"  Size: {r['size_mb']} MB")
        print(f"  Timeline: {r['timeline_entries']} entries")
        print(f"\nDownload:")
        print(f"  modal volume get argus-training-data {r['output_video']} public/demo/demo.mp4 --force")
        print(f"  modal volume get argus-training-data {r['output_json']} public/demo/analysis_timeline.json --force")
