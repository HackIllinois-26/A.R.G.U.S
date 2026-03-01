"""
Mock data generator for ARGUS — 5 locations × 20 tables.

Generates Presage biometric streams, camera frames, and
6 weeks of synthetic historical dining session data.
"""

from __future__ import annotations

import base64
import io
import json
import random
import time
from dataclasses import dataclass, field, asdict
from typing import Generator

try:
    from PIL import Image, ImageDraw
except ImportError:
    Image = None  # type: ignore

# ---------------------------------------------------------------------------
# Locations
# ---------------------------------------------------------------------------

LOCATIONS = [
    {"id": "downtown", "name": "Downtown Flagship", "tables": 20},
    {"id": "midtown", "name": "Midtown Bistro", "tables": 20},
    {"id": "waterfront", "name": "Waterfront Grill", "tables": 20},
    {"id": "airport", "name": "Airport Terminal 3", "tables": 20},
    {"id": "suburban", "name": "Suburban Family", "tables": 20},
]

# ---------------------------------------------------------------------------
# Biometric data models
# ---------------------------------------------------------------------------

@dataclass
class PresageBiometrics:
    guest_id: str
    stress: float
    engagement: float
    heart_rate: int
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class TableSnapshot:
    table_id: str
    location_id: str
    guest_count: int
    biometrics: list[PresageBiometrics]
    frame_b64: str
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "table_id": self.table_id,
            "location_id": self.location_id,
            "guest_count": self.guest_count,
            "biometrics": [b.to_dict() for b in self.biometrics],
            "frame_b64": self.frame_b64,
            "timestamp": self.timestamp,
        }


# ---------------------------------------------------------------------------
# Phase definitions — each table cycles through a dining arc
# ---------------------------------------------------------------------------

PHASE_LIBRARY = [
    {"phase": "empty",        "stress": 0.0,  "engagement": 0.0, "hr": 0},
    {"phase": "seated",       "stress": 0.15, "engagement": 0.8, "hr": 72},
    {"phase": "ordering",     "stress": 0.10, "engagement": 0.9, "hr": 74},
    {"phase": "waiting",      "stress": 0.35, "engagement": 0.5, "hr": 78},
    {"phase": "eating",       "stress": 0.05, "engagement": 0.85,"hr": 70},
    {"phase": "dessert",      "stress": 0.08, "engagement": 0.8, "hr": 68},
    {"phase": "wants_check",  "stress": 0.50, "engagement": 0.3, "hr": 82},
    {"phase": "paying",       "stress": 0.15, "engagement": 0.4, "hr": 74},
    {"phase": "left",         "stress": 0.0,  "engagement": 0.0, "hr": 0},
]

PROBLEM_SCENARIOS = [
    [
        {"phase": "seated",       "stress": 0.20, "engagement": 0.6, "hr": 78},
        {"phase": "waiting_long", "stress": 0.75, "engagement": 0.2, "hr": 92},
        {"phase": "frustrated",   "stress": 0.90, "engagement": 0.1, "hr": 98},
        {"phase": "eating",       "stress": 0.30, "engagement": 0.5, "hr": 80},
        {"phase": "wants_check",  "stress": 0.60, "engagement": 0.2, "hr": 86},
    ],
    [
        {"phase": "seated",       "stress": 0.25, "engagement": 0.5, "hr": 80},
        {"phase": "ordering",     "stress": 0.30, "engagement": 0.4, "hr": 82},
        {"phase": "waiting",      "stress": 0.85, "engagement": 0.15,"hr": 95},
        {"phase": "angry",        "stress": 0.95, "engagement": 0.05,"hr": 102},
    ],
    [
        {"phase": "eating",       "stress": 0.10, "engagement": 0.7, "hr": 72},
        {"phase": "dessert",      "stress": 0.12, "engagement": 0.6, "hr": 70},
        {"phase": "wants_check",  "stress": 0.45, "engagement": 0.3, "hr": 78},
        {"phase": "lingering",    "stress": 0.55, "engagement": 0.2, "hr": 80},
        {"phase": "lingering",    "stress": 0.60, "engagement": 0.15,"hr": 82},
    ],
]


def _build_table_scenario(table_num: int) -> list[dict]:
    """Deterministically assign a scenario to each table number."""
    if table_num % 7 == 0:
        return PROBLEM_SCENARIOS[table_num % len(PROBLEM_SCENARIOS)]
    start = table_num % len(PHASE_LIBRARY)
    length = 4 + (table_num % 4)
    phases = []
    for i in range(length):
        phases.append(PHASE_LIBRARY[(start + i) % len(PHASE_LIBRARY)])
    return phases


def _jitter(value: float, amount: float = 0.08) -> float:
    return max(0.0, min(1.0, value + random.uniform(-amount, amount)))


PHASE_COLORS = {
    "empty": (30, 30, 40), "seated": (40, 60, 80), "ordering": (50, 70, 90),
    "waiting": (80, 60, 30), "waiting_long": (120, 50, 20), "eating": (30, 80, 50),
    "dessert": (60, 50, 80), "wants_check": (100, 70, 20), "paying": (50, 50, 60),
    "left": (25, 25, 30), "frustrated": (120, 30, 30), "angry": (140, 20, 20),
    "lingering": (90, 70, 40),
}


def _generate_frame(table_id: str, location_id: str, phase: str) -> str:
    if Image is None:
        return base64.b64encode(b"PLACEHOLDER").decode()

    bg = PHASE_COLORS.get(phase, (30, 30, 40))
    img = Image.new("RGB", (320, 240), color=bg)
    draw = ImageDraw.Draw(img)
    draw.text((10, 10), f"{location_id}", fill=(100, 100, 100))
    draw.text((10, 100), f"Table {table_id}", fill=(220, 220, 220))
    draw.text((10, 130), f"{phase.upper()}", fill=(160, 200, 255))

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=50)
    return base64.b64encode(buf.getvalue()).decode()


# ---------------------------------------------------------------------------
# Snapshot generators
# ---------------------------------------------------------------------------

def get_table_snapshot(
    table_id: str,
    location_id: str,
    phase_index: int = 0,
) -> TableSnapshot:
    table_num = int(table_id) if table_id.isdigit() else hash(table_id) % 20
    scenario = _build_table_scenario(table_num)
    step = scenario[phase_index % len(scenario)]
    is_empty = step["phase"] in ("empty", "left")
    guest_count = 0 if is_empty else random.randint(2, 6)

    biometrics = [
        PresageBiometrics(
            guest_id=f"{location_id}-t{table_id}-g{g}",
            stress=_jitter(step["stress"]),
            engagement=_jitter(step["engagement"]),
            heart_rate=step["hr"] + random.randint(-4, 4) if step["hr"] else 0,
        )
        for g in range(guest_count)
    ]

    return TableSnapshot(
        table_id=table_id,
        location_id=location_id,
        guest_count=guest_count,
        biometrics=biometrics,
        frame_b64=_generate_frame(table_id, location_id, step["phase"]),
    )


def get_location_snapshot(
    location_id: str,
    num_tables: int = 20,
    phase_index: int = 0,
) -> list[dict]:
    return [
        get_table_snapshot(str(t + 1), location_id, phase_index).to_dict()
        for t in range(num_tables)
    ]


def get_all_locations_snapshot(phase_index: int = 0) -> dict:
    """Returns { location_id: [table_snapshots] } for all 5 locations."""
    result = {}
    for loc in LOCATIONS:
        result[loc["id"]] = get_location_snapshot(
            loc["id"], loc["tables"], phase_index
        )
    return result


# ---------------------------------------------------------------------------
# Historical data generator — 6 weeks of synthetic dining sessions
# ---------------------------------------------------------------------------

@dataclass
class HistoricalSession:
    session_id: str
    location_id: str
    table_id: str
    party_size: int
    seated_at: float
    left_at: float
    duration_minutes: int
    avg_stress: float
    avg_engagement: float
    peak_stress: float
    phases_observed: list[str]
    issues: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


def generate_historical_data(
    num_weeks: int = 6,
    sessions_per_day_per_location: int = 40,
) -> list[dict]:
    """
    Generate synthetic historical dining sessions.
    6 weeks × 7 days × 5 locations × 40 sessions/day = ~8,400 sessions.
    """
    sessions: list[dict] = []
    base_time = time.time() - (num_weeks * 7 * 86400)
    session_counter = 0

    for day in range(num_weeks * 7):
        day_time = base_time + (day * 86400)
        for loc in LOCATIONS:
            for _ in range(sessions_per_day_per_location):
                session_counter += 1
                table_id = str(random.randint(1, loc["tables"]))
                party_size = random.choices([2, 3, 4, 5, 6], weights=[30, 25, 25, 12, 8])[0]

                hour = random.choices(
                    [11, 12, 13, 17, 18, 19, 20, 21],
                    weights=[10, 20, 15, 10, 25, 25, 20, 10],
                )[0]
                seated_at = day_time + hour * 3600 + random.randint(0, 3599)
                duration = random.gauss(55, 20)
                duration = max(20, min(120, duration))

                avg_stress = random.betavariate(2, 8)
                peak_stress = min(1.0, avg_stress + random.uniform(0.1, 0.4))
                avg_engagement = random.betavariate(6, 3)

                possible_issues = []
                if avg_stress > 0.4:
                    possible_issues.append("elevated_stress")
                if duration > 90:
                    possible_issues.append("lingering")
                if peak_stress > 0.7:
                    possible_issues.append("frustration_spike")

                phases = ["seated", "ordering", "waiting", "eating"]
                if random.random() > 0.4:
                    phases.append("dessert")
                phases.extend(["wants_check", "paying", "left"])

                sessions.append(HistoricalSession(
                    session_id=f"sess-{session_counter:06d}",
                    location_id=loc["id"],
                    table_id=table_id,
                    party_size=party_size,
                    seated_at=seated_at,
                    left_at=seated_at + duration * 60,
                    duration_minutes=int(duration),
                    avg_stress=round(avg_stress, 3),
                    avg_engagement=round(avg_engagement, 3),
                    peak_stress=round(peak_stress, 3),
                    phases_observed=phases,
                    issues=possible_issues,
                ).to_dict())

    return sessions


def get_historical_chunk(chunk_index: int, total_chunks: int = 10) -> list[dict]:
    """
    Get a single chunk of historical data for parallel processing.
    Used by the bulk processor to split work across Modal containers.
    """
    all_data = generate_historical_data()
    chunk_size = len(all_data) // total_chunks
    start = chunk_index * chunk_size
    end = start + chunk_size if chunk_index < total_chunks - 1 else len(all_data)
    return all_data[start:end]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print(f"=== ARGUS Mock Data ===")
    print(f"Locations: {len(LOCATIONS)}")
    for loc in LOCATIONS:
        print(f"  {loc['id']}: {loc['name']} ({loc['tables']} tables)")

    all_snap = get_all_locations_snapshot(phase_index=2)
    total_tables = sum(len(tables) for tables in all_snap.values())
    print(f"\nTotal tables across all locations: {total_tables}")

    hist = generate_historical_data()
    print(f"Historical sessions generated: {len(hist)}")
    print(f"Sample: {json.dumps(hist[0], indent=2, default=str)[:300]}")
