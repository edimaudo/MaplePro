"""Minimal Supabase Data API helpers. Uses the existing project URL/API key."""
from __future__ import annotations

from functools import lru_cache
from typing import Any, Iterable
from urllib.parse import quote

import httpx

from .config import settings


class SupabaseAPIError(RuntimeError):
    """Raised when Supabase rejects a data request."""


@lru_cache(maxsize=1)
def _http_client() -> httpx.Client:
    return httpx.Client(timeout=httpx.Timeout(20.0, connect=8.0))


def _headers(*, prefer: str | None = None) -> dict[str, str]:
    if not settings.supabase_url or not settings.supabase_api_key:
        raise RuntimeError(
            "SUPABASE_URL and a Supabase API key are required. Use the existing Supabase project settings; DATABASE_URL is not used."
        )
    headers = {
        "apikey": settings.supabase_api_key,
        "Authorization": f"Bearer {settings.supabase_api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def _request(method: str, table: str, *, params: list[tuple[str, str]] | None = None, payload: Any = None, prefer: str | None = None) -> list[dict[str, Any]]:
    table_path = quote(table, safe="")
    url = f"{settings.supabase_url}/rest/v1/{table_path}"
    try:
        response = _http_client().request(method, url, headers=_headers(prefer=prefer), params=params, json=payload)
    except httpx.HTTPError as exc:
        raise SupabaseAPIError("Unable to reach the Supabase Data API. Check SUPABASE_URL and network access.") from exc
    if response.status_code >= 400:
        # Include the provider's short message to make schema/permission errors actionable,
        # but never echo request headers or secrets.
        try:
            detail = response.json().get("message") or response.json().get("hint") or response.text
        except ValueError:
            detail = response.text
        detail = str(detail).replace("\n", " ")[:240]
        if response.status_code in {401, 403}:
            raise SupabaseAPIError(
                f"Supabase denied access to table '{table}' (HTTP {response.status_code}). Check the configured API key and this table's RLS policies. {detail}"
            )
        raise SupabaseAPIError(f"Supabase request for '{table}' failed (HTTP {response.status_code}): {detail}")
    if not response.content:
        return []
    data = response.json()
    if isinstance(data, list):
        return data
    return [data] if isinstance(data, dict) else []


def _in_filter(values: Iterable[Any]) -> str:
    def quoted(value: Any) -> str:
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, (int, float)):
            return str(value)
        return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"') + '"'
    return "in.(" + ",".join(quoted(value) for value in values) + ")"


def rows(
    table: str,
    *,
    filters: Iterable[tuple[str, Any]] = (),
    in_filters: Iterable[tuple[str, Iterable[Any]]] = (),
    order: str | None = None,
    limit: int | None = None,
    columns: str = "*",
) -> list[dict[str, Any]]:
    """Select rows through PostgREST with simple equality/IN filters."""
    params: list[tuple[str, str]] = [("select", columns)]
    for column, value in filters:
        params.append((column, f"eq.{value}"))
    for column, values in in_filters:
        values = list(values)
        if not values:
            return []
        params.append((column, _in_filter(values)))
    if order:
        column, _, direction = order.partition(":")
        params.append(("order", f"{column}.{ 'desc' if direction.lower() == 'desc' else 'asc' }"))
    if limit is not None:
        params.append(("limit", str(limit)))
    return _request("GET", table, params=params)


def one(table: str, *, filters: Iterable[tuple[str, Any]], columns: str = "*") -> dict[str, Any] | None:
    found = rows(table, filters=filters, limit=1, columns=columns)
    return found[0] if found else None


def insert_one(table: str, values: dict[str, Any]) -> dict[str, Any]:
    response = _request("POST", table, payload=values, prefer="return=representation")
    return response[0] if response else values


def insert_many(table: str, values: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not values:
        return []
    return _request("POST", table, payload=values, prefer="return=representation") or values


def update_one(table: str, row_id: str, values: dict[str, Any]) -> dict[str, Any] | None:
    response = _request("PATCH", table, params=[("id", f"eq.{row_id}")], payload=values, prefer="return=representation")
    return response[0] if response else None


def check_schema() -> None:
    """Check table endpoints exist; schema is managed in the Supabase SQL Editor."""
    required_tables = (
        "firms", "profiles", "projects", "invoices", "milestones", "project_snapshots", "payment_events",
    )
    for table in required_tables:
        try:
            rows(table, columns="id", limit=1)
        except Exception as exc:
            raise RuntimeError(
                f"Cannot access Supabase table '{table}'. Apply supabase/schema.sql and verify the configured API key has access under the table's RLS policy."
            ) from exc
