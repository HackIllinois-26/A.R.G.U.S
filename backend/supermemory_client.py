"""
Supermemory client wrapper for ARGUS table memory management.

Uses the official Supermemory Python SDK. Each table's memories are
isolated via containerTags (e.g. ["table-4", "argus"]).
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from supermemory import AsyncSupermemory


class TableMemory:
    """Async wrapper around the Supermemory SDK for per-table memory ops."""

    def __init__(self, api_key: str | None = None):
        self.client = AsyncSupermemory(
            api_key=api_key or os.environ.get("SUPERMEMORY_API_KEY", ""),
        )

    def _tags(self, table_id: str) -> list[str]:
        return [f"table-{table_id}", "argus"]

    async def add_memory(
        self,
        table_id: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict:
        """
        Store a new memory event for a table.

        Args:
            table_id: e.g. "4" or "patio-2".
            content:  Natural-language event description.
            metadata: Optional structured data (stress scores, etc.)
        """
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
        """
        Semantic search across a table's memories.

        Returns list of dicts with 'content' and 'similarity' keys.
        """
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

    async def close(self) -> None:
        await self.client.close()
