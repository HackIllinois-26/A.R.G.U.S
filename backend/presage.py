"""
Presage Integration — Biometric sensing for waiting guests.

In production, this module connects to the Presage SDK camera feed.
For development/demo, it generates realistic mock biometric data.

Presage captures:
  - Heart rate & breathing rate
  - Emotional state / engagement level
  - Facial expressions (patience indicators)
  - Movement patterns (stationary vs. pacing vs. exit-directed)
"""

from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass, field, asdict
from typing import Literal


UrgencyLevel = Literal["calm", "moderate", "urgent", "leaving"]

FIRST_NAMES = [
    "James", "Maria", "Chen", "Aisha", "Raj", "Sofia", "Marcus",
    "Yuki", "David", "Priya", "Omar", "Elena", "Kai", "Nina",
    "Liam", "Zara", "Felix", "Rosa", "Andre", "Mei",
]


@dataclass
class PresageReading:
    """Single biometric reading from Presage SDK for one person."""
    heart_rate: int
    breathing_rate: int
    engagement: float          # 0–1
    frustration: float         # 0–1
    movement_intensity: float  # 0–1 (0=stationary, 1=pacing/exiting)
    exit_directed: bool        # moving toward exit?
    facial_patience: float     # 0–1 (1=very patient)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class WaitingParty:
    """A party waiting to be seated, with aggregated Presage biometrics."""
    party_id: str
    party_name: str
    party_size: int
    wait_start: float
    preferred_seating: str          # "any", "booth", "patio", "window"
    readings: list[PresageReading]
    urgency_score: float = 0.0     # 1–10 computed score
    urgency_level: UrgencyLevel = "calm"
    best_table_match: str | None = None
    notes: str = ""

    @property
    def wait_minutes(self) -> int:
        return max(0, int((time.time() - self.wait_start) / 60))

    def to_dict(self) -> dict:
        d = asdict(self)
        d["wait_minutes"] = self.wait_minutes
        return d


def compute_urgency(party: WaitingParty) -> tuple[float, UrgencyLevel]:
    """
    Compute urgency score (1–10) from Presage biometrics.

    Factors:
      - Elevated heart rate (vs. resting ~72 bpm)
      - Low engagement / high frustration
      - Movement toward exit
      - Wait duration (longer = higher base urgency)
    """
    if not party.readings:
        base = min(10, 1 + party.wait_minutes * 0.3)
        level: UrgencyLevel = "calm" if base < 4 else "moderate" if base < 7 else "urgent"
        return round(base, 1), level

    n = len(party.readings)
    avg_hr = sum(r.heart_rate for r in party.readings) / n
    avg_frustration = sum(r.frustration for r in party.readings) / n
    avg_engagement = sum(r.engagement for r in party.readings) / n
    avg_movement = sum(r.movement_intensity for r in party.readings) / n
    any_exit = any(r.exit_directed for r in party.readings)
    avg_patience = sum(r.facial_patience for r in party.readings) / n

    hr_score = max(0, (avg_hr - 72) / 30) * 2.5
    frustration_score = avg_frustration * 3.0
    engagement_penalty = (1 - avg_engagement) * 1.5
    movement_score = avg_movement * 2.0
    exit_score = 3.0 if any_exit else 0.0
    patience_bonus = -(avg_patience * 1.5)
    wait_score = min(2.0, party.wait_minutes * 0.15)

    raw = 1.0 + hr_score + frustration_score + engagement_penalty + movement_score + exit_score + patience_bonus + wait_score
    score = max(1.0, min(10.0, raw))

    if any_exit or score >= 8.5:
        level = "leaving"
    elif score >= 6.0:
        level = "urgent"
    elif score >= 3.5:
        level = "moderate"
    else:
        level = "calm"

    return round(score, 1), level


# ---------------------------------------------------------------------------
# Mock data generation for demo / development
# ---------------------------------------------------------------------------

def _mock_reading(wait_minutes: int, scenario: str = "normal") -> PresageReading:
    """Generate a single realistic Presage reading."""
    base_hr = 72
    base_frustration = 0.1
    base_engagement = 0.8
    base_patience = 0.9

    time_factor = min(1.0, wait_minutes / 20)

    if scenario == "relaxed":
        return PresageReading(
            heart_rate=base_hr + random.randint(-3, 5),
            breathing_rate=14 + random.randint(-1, 1),
            engagement=max(0, 0.85 - time_factor * 0.1 + random.uniform(-0.05, 0.05)),
            frustration=max(0, 0.05 + time_factor * 0.1 + random.uniform(-0.03, 0.03)),
            movement_intensity=random.uniform(0, 0.1),
            exit_directed=False,
            facial_patience=max(0, 0.9 - time_factor * 0.1),
        )
    elif scenario == "impatient":
        return PresageReading(
            heart_rate=base_hr + int(time_factor * 25) + random.randint(-3, 5),
            breathing_rate=16 + int(time_factor * 4) + random.randint(-1, 1),
            engagement=max(0, 0.4 - time_factor * 0.2 + random.uniform(-0.05, 0.05)),
            frustration=min(1, 0.4 + time_factor * 0.4 + random.uniform(-0.05, 0.05)),
            movement_intensity=min(1, 0.3 + time_factor * 0.4),
            exit_directed=time_factor > 0.7 and random.random() > 0.4,
            facial_patience=max(0, 0.4 - time_factor * 0.3),
        )
    elif scenario == "leaving":
        return PresageReading(
            heart_rate=base_hr + random.randint(15, 30),
            breathing_rate=18 + random.randint(0, 4),
            engagement=random.uniform(0.05, 0.15),
            frustration=random.uniform(0.7, 0.95),
            movement_intensity=random.uniform(0.6, 0.95),
            exit_directed=True,
            facial_patience=random.uniform(0, 0.15),
        )
    else:
        return PresageReading(
            heart_rate=base_hr + int(time_factor * 12) + random.randint(-3, 5),
            breathing_rate=15 + int(time_factor * 2) + random.randint(-1, 1),
            engagement=max(0, base_engagement - time_factor * 0.3 + random.uniform(-0.1, 0.1)),
            frustration=min(1, base_frustration + time_factor * 0.3 + random.uniform(-0.05, 0.1)),
            movement_intensity=min(1, time_factor * 0.2 + random.uniform(0, 0.1)),
            exit_directed=False,
            facial_patience=max(0, base_patience - time_factor * 0.4),
        )


def generate_mock_waiting_list(num_parties: int = 5) -> list[WaitingParty]:
    """Generate a realistic mock waiting list with Presage biometrics."""
    now = time.time()
    seating_prefs = ["any", "booth", "patio", "window"]

    scenarios_pool = [
        ("relaxed", 3), ("relaxed", 5), ("normal", 8),
        ("normal", 12), ("impatient", 15), ("impatient", 10),
        ("leaving", 18), ("normal", 6), ("relaxed", 2),
        ("impatient", 20),
    ]

    parties = []
    used_names = set()

    for i in range(num_parties):
        scenario, wait_min = scenarios_pool[i % len(scenarios_pool)]
        name = random.choice([n for n in FIRST_NAMES if n not in used_names])
        used_names.add(name)
        party_size = random.choices([2, 3, 4, 5, 6], weights=[30, 25, 25, 12, 8])[0]

        readings = [_mock_reading(wait_min, scenario) for _ in range(party_size)]

        party = WaitingParty(
            party_id=f"wait-{i+1:03d}",
            party_name=name,
            party_size=party_size,
            wait_start=now - wait_min * 60,
            preferred_seating=random.choice(seating_prefs),
            readings=readings,
        )

        score, level = compute_urgency(party)
        party.urgency_score = score
        party.urgency_level = level

        parties.append(party)

    parties.sort(key=lambda p: -p.urgency_score)
    return parties
