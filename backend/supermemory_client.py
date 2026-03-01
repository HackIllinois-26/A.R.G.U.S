"""
Supermemory client — The restaurant's persistent learning layer.

Manages per-table, per-restaurant memories that accumulate over weeks of service.
Uses the official Supermemory Python SDK with semantic search and structured storage.

Memory categories:
  - Table-level: positional quirks, typical behavior per table
  - Time-pattern: day-of-week / hour patterns
  - Staff-pattern: server section performance
  - Anomaly: recurring edge cases
  - Host-pattern: per-host quoting tendencies
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from supermemory import AsyncSupermemory


class TableMemory:
    """Async wrapper around Supermemory for per-table + restaurant-wide memory ops."""

    def __init__(self, api_key: str | None = None):
        self.client = AsyncSupermemory(
            api_key=api_key or os.environ.get("SUPERMEMORY_API_KEY", ""),
        )

    def _tags(self, table_id: str) -> list[str]:
        return [f"table-{table_id}", "argus"]

    # ------------------------------------------------------------------
    # Core memory operations
    # ------------------------------------------------------------------

    async def add_memory(
        self,
        table_id: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict:
        """Store a new memory event for a table."""
        timestamp = datetime.now(timezone.utc).isoformat()
        result = await self.client.memory.create(
            content=f"[{timestamp}] {content}",
            containerTags=self._tags(table_id),
            metadata=metadata or {},
        )
        return {"id": result.id, "status": getattr(result, "status", "queued")}

    async def search_history(
        self,
        table_id: str,
        query: str = "latest service events",
        limit: int = 8,
    ) -> list[dict]:
        """Semantic search across a table's memories."""
        results = await self.client.search.memories(
            q=query,
            container_tag=f"table-{table_id}",
            search_mode="hybrid",
            limit=limit,
        )
        out = []
        for r in results.results:
            out.append({
                "content": r.memory or r.chunk or "",
                "similarity": r.similarity,
                "metadata": r.metadata,
            })
        return out

    def format_history_for_prompt(self, memories: list[dict]) -> str:
        """Format search results into an LLM-friendly context block."""
        if not memories:
            return "No prior history for this table."
        lines: list[str] = []
        for mem in memories:
            content = mem.get("content", "")
            lines.append(f"- {content}")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Shift context — loaded at start of each shift
    # ------------------------------------------------------------------

    async def get_shift_context(
        self,
        restaurant_id: str,
        day_of_week: str,
        hour: int,
        weather: str = "clear",
    ) -> str:
        """
        Query Supermemory for the most relevant historical patterns
        given tonight's conditions. Injected into every agent's prompt.
        """
        query = (
            f"Restaurant patterns for {day_of_week} evening around {hour}:00, "
            f"weather: {weather}. What are the typical turn times, "
            f"common issues, and staff patterns?"
        )
        try:
            results = await self.client.search.memories(
                q=query,
                container_tag=f"restaurant-{restaurant_id}",
                search_mode="hybrid",
                limit=10,
            )
            if not results.results:
                return self._default_shift_context(day_of_week, hour)

            lines = [f"Shift context for {day_of_week} {hour}:00 ({weather}):"]
            for r in results.results:
                content = r.memory or r.chunk or ""
                if content:
                    lines.append(f"  • {content}")
            return "\n".join(lines)
        except Exception:
            return self._default_shift_context(day_of_week, hour)

    def _default_shift_context(self, day: str, hour: int) -> str:
        peak = hour >= 18 and hour <= 21
        weekend = day.lower() in ("friday", "saturday", "sunday")
        lines = [f"Shift context for {day} {hour}:00:"]
        if peak:
            lines.append("  • Peak dining hours — expect high volume")
        if weekend:
            lines.append("  • Weekend service — turn times typically 15-20% longer")
        if peak and weekend:
            lines.append("  • High-demand period — prioritize table turnover")
        lines.append("  • No specific historical data yet — system is still learning")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Memory Writer — structured table turn events
    # ------------------------------------------------------------------

    async def write_table_turn(
        self,
        restaurant_id: str,
        table_id: str,
        event: dict,
    ) -> dict:
        """
        Write a structured memory when a table turns (guest leaves).

        Event should contain:
          - party_size, seated_duration_min, predicted_duration_min
          - table_state_at_prediction, actual_behavior
          - presage_data (engagement, HR summary)
          - day_of_week, hour, table_position
          - server_section (if known)
        """
        party = event.get("party_size", "?")
        actual = event.get("seated_duration_min", 0)
        predicted = event.get("predicted_duration_min", 0)
        delta_pct = round((actual - predicted) / max(predicted, 1) * 100) if predicted else 0
        day = event.get("day_of_week", "unknown")
        hour = event.get("hour", 0)
        position = event.get("table_position", "standard")

        content = (
            f"Table {table_id} turned: party of {party}, "
            f"seated {actual}min (predicted {predicted}min, {delta_pct:+d}%). "
            f"{day} at {hour}:00, position: {position}. "
            f"State at prediction: {event.get('table_state_at_prediction', 'unknown')}. "
            f"Behavior: {event.get('actual_behavior', 'normal')}."
        )

        presage = event.get("presage_summary", "")
        if presage:
            content += f" Presage: {presage}."

        tags = [
            f"table-{table_id}",
            f"restaurant-{restaurant_id}",
            f"day-{day.lower()}",
            "argus",
            "table-turn",
        ]

        result = await self.client.memory.create(
            content=f"[{datetime.now(timezone.utc).isoformat()}] {content}",
            containerTags=tags,
            metadata={
                "type": "table_turn",
                "party_size": party,
                "actual_duration": actual,
                "predicted_duration": predicted,
                "delta_percent": delta_pct,
                "day_of_week": day,
                "hour": hour,
                "table_position": position,
            },
        )
        return {"id": result.id, "content_summary": content[:120]}

    # ------------------------------------------------------------------
    # Table pattern queries
    # ------------------------------------------------------------------

    async def get_table_patterns(self, table_id: str, restaurant_id: str) -> str:
        """Get known behavioral patterns for a specific table."""
        query = (
            f"What are the typical dining patterns, turn times, "
            f"and any special characteristics of table {table_id}?"
        )
        try:
            results = await self.client.search.memories(
                q=query,
                container_tag=f"table-{table_id}",
                search_mode="hybrid",
                limit=5,
            )
            if not results.results:
                return f"No historical patterns for table {table_id} yet."
            lines = [f"Table {table_id} patterns:"]
            for r in results.results:
                c = r.memory or r.chunk or ""
                if c:
                    lines.append(f"  • {c}")
            return "\n".join(lines)
        except Exception:
            return f"No historical patterns for table {table_id} yet."

    # ------------------------------------------------------------------
    # Host pattern tracking
    # ------------------------------------------------------------------

    async def get_host_patterns(self, host_name: str, restaurant_id: str) -> str:
        """Get per-host quoting tendencies (over/under quoting)."""
        query = f"Host {host_name} quoting patterns and tendencies"
        try:
            results = await self.client.search.memories(
                q=query,
                container_tag=f"restaurant-{restaurant_id}",
                search_mode="hybrid",
                limit=5,
            )
            if not results.results:
                return f"No historical patterns for host {host_name} yet."
            lines = [f"Host {host_name} patterns:"]
            for r in results.results:
                c = r.memory or r.chunk or ""
                if c:
                    lines.append(f"  • {c}")
            return "\n".join(lines)
        except Exception:
            return f"No historical patterns for host {host_name} yet."

    async def write_host_quote_result(
        self,
        restaurant_id: str,
        host_name: str,
        quoted_minutes: int,
        actual_minutes: int,
    ) -> dict:
        """Track a host's quote accuracy for learning their tendencies."""
        delta = actual_minutes - quoted_minutes
        tendency = "over-quoted" if delta < -3 else "under-quoted" if delta > 3 else "accurate"

        content = (
            f"Host {host_name} quoted {quoted_minutes}min, "
            f"actual was {actual_minutes}min ({tendency}, delta: {delta:+d}min)"
        )

        result = await self.client.memory.create(
            content=f"[{datetime.now(timezone.utc).isoformat()}] {content}",
            containerTags=[f"restaurant-{restaurant_id}", f"host-{host_name.lower()}", "argus", "host-pattern"],
            metadata={"type": "host_quote", "host": host_name, "quoted": quoted_minutes, "actual": actual_minutes, "delta": delta},
        )
        return {"id": result.id, "tendency": tendency}

    # ------------------------------------------------------------------
    # Restaurant-wide anomaly search
    # ------------------------------------------------------------------

    async def search_anomaly_patterns(self, restaurant_id: str, description: str) -> list[dict]:
        """Search for similar past anomalies to inform current detection."""
        try:
            results = await self.client.search.memories(
                q=description,
                container_tag=f"restaurant-{restaurant_id}",
                search_mode="hybrid",
                limit=5,
            )
            return [
                {"content": r.memory or r.chunk or "", "similarity": r.similarity}
                for r in results.results
            ]
        except Exception:
            return []

    async def close(self) -> None:
        await self.client.close()
