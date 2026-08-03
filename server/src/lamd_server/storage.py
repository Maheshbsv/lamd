import json
import re
from datetime import datetime, timezone
from pathlib import Path


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "untitled"


def list_rules(root: Path) -> list[Path]:
    rules_dir = root / ".lamd" / "rules"
    if not rules_dir.is_dir():
        return []
    return sorted(rules_dir.glob("*.md"))


def write_decision(
    root: Path,
    decision: str,
    reason: str,
    module: str,
    author: str,
    branch: str,
    *,
    now: datetime | None = None,
) -> Path:
    now = now or datetime.now(timezone.utc)
    timestamp = now.strftime("%Y%m%d-%H%M%S")
    slug = _slugify(decision)
    path = root / ".lamd" / "decisions" / f"{timestamp}-{slug}.json"
    payload = {
        "decision": decision,
        "reason": reason,
        "module": module,
        "author": author,
        "date": now.strftime("%Y-%m-%d"),
        "branch": branch,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path
