#!/usr/bin/env python3
"""Refresh the compact local catalog and enrich Git Gud cards from Riftcodex."""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://api.riftcodex.com/cards"


def get_page(page: int) -> dict:
    query = urllib.parse.urlencode({"size": 100, "page": page, "sort": "name"})
    request = urllib.request.Request(f"{BASE}?{query}", headers={"User-Agent": "RiftArchive/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def compact(card: dict) -> dict:
    return {
        "name": card.get("name", ""),
        "riftbound_id": card.get("riftbound_id") or card.get("id", ""),
        "collector_number": card.get("collector_number"),
        "classification": card.get("classification") or {},
        "set": card.get("set") or {},
        "attributes": card.get("attributes") or {"energy": None, "might": None, "power": None},
        "media": {"image_url": (card.get("media") or {}).get("image_url", "")},
        "tags": card.get("tags") or [],
        "text": card.get("text") or {},
        "metadata": card.get("metadata") or {},
        "orientation": card.get("orientation") or "portrait",
    }


def write_json(path: Path, payload: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    first = get_page(1)
    cards = list(first.get("items") or [])
    for page in range(2, max(1, int(first.get("pages") or 1)) + 1):
        cards.extend(get_page(page).get("items") or [])

    unique = {}
    for card in cards:
        card_id = card.get("riftbound_id") or card.get("id")
        if card_id and card_id not in unique:
            unique[card_id] = compact(card)

    catalog = {
        "updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "total": len(unique),
        "items": list(unique.values()),
    }
    write_json(ROOT / "catalog.json", catalog)

    gitgud_path = ROOT / "gitgud-cards.json"
    gitgud = json.loads(gitgud_path.read_text(encoding="utf-8"))
    for card in gitgud.get("cards", []):
        source = unique.get(card.get("riftbound_id"), {})
        classification = source.get("classification") or {}
        card["supertype"] = classification.get("supertype")
        card["tags"] = source.get("tags") or []
        card["collector_number"] = source.get("collector_number")
    gitgud["catalog_updated_at"] = catalog["updated_at"]
    write_json(gitgud_path, gitgud)
    print(f"Synced {len(unique)} catalog cards and enriched {len(gitgud.get('cards', []))} Git Gud cards.")


if __name__ == "__main__":
    main()
