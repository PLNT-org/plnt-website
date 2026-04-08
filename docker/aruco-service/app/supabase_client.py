"""Lightweight Supabase REST API client for writing detection results."""

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class SupabaseClient:
    """Minimal client for Supabase PostgREST API."""

    def __init__(self, url: str, service_key: str):
        self.base_url = f"{url}/rest/v1"
        self.headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }

    async def update_job(self, job_id: str, data: dict):
        """Update a detection job record."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.patch(
                f"{self.base_url}/detection_jobs?id=eq.{job_id}",
                headers=self.headers,
                json=data,
            )
            if res.status_code >= 400:
                logger.error(f"Failed to update job {job_id}: {res.status_code} {res.text[:200]}")

    async def delete_ai_labels(self, orthomosaic_id: str):
        """Delete existing AI labels for an orthomosaic."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.delete(
                f"{self.base_url}/plant_labels?orthomosaic_id=eq.{orthomosaic_id}&source=eq.ai",
                headers=self.headers,
            )
            if res.status_code >= 400:
                logger.error(f"Failed to delete labels: {res.status_code} {res.text[:200]}")

    async def insert_labels(self, labels: list[dict]) -> int:
        """Batch insert plant labels. Returns count of successfully inserted labels."""
        inserted = 0
        chunk_size = 250

        async with httpx.AsyncClient(timeout=60.0) as client:
            for i in range(0, len(labels), chunk_size):
                chunk = labels[i:i + chunk_size]
                for attempt in range(3):
                    res = await client.post(
                        f"{self.base_url}/plant_labels",
                        headers=self.headers,
                        json=chunk,
                    )
                    if res.status_code < 400:
                        inserted += len(chunk)
                        break
                    else:
                        logger.error(
                            f"Label insert failed (attempt {attempt+1}): "
                            f"{res.status_code} {res.text[:200]}"
                        )
                        if attempt < 2:
                            import asyncio
                            await asyncio.sleep(2 ** attempt)

        return inserted
