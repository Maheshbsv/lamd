import json
import logging
import re
from dataclasses import dataclass
from datetime import date as date_cls
from datetime import datetime, timezone
from pathlib import Path

import yaml

logger = logging.getLogger("lamd_server")


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


def write_session(
    root: Path,
    summary: str,
    next_steps: str,
    files_touched: list[str],
    author: str,
    branch: str,
    *,
    now: datetime | None = None,
) -> Path:
    now = now or datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%d")
    slug = _slugify(summary)
    path = root / ".lamd" / "sessions" / f"{date_str}-{slug}.md"
    frontmatter = {
        "date": date_str,
        "user": author,
        "branch": branch,
        "status": "complete",
        "files_touched": files_touched,
    }
    content = (
        "---\n"
        + yaml.safe_dump(frontmatter, sort_keys=False)
        + "---\n\n"
        + f"{summary}\n\n## Next Steps\n\n{next_steps}\n"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


@dataclass
class MemoryRecord:
    path: Path
    kind: str
    text: str
    date: date_cls


def _read_decision_record(path: Path) -> MemoryRecord:
    data = json.loads(path.read_text(encoding="utf-8"))
    text = f"{data['decision']} {data['reason']} {data['module']}"
    record_date = datetime.strptime(data["date"], "%Y-%m-%d").date()
    return MemoryRecord(path=path, kind="decision", text=text, date=record_date)


def _read_session_record(path: Path) -> MemoryRecord:
    raw = path.read_text(encoding="utf-8")
    _, frontmatter_raw, body = raw.split("---", 2)
    frontmatter = yaml.safe_load(frontmatter_raw)
    files_touched = frontmatter.get("files_touched") or []
    text = f"{body.strip()} {' '.join(files_touched)}"
    record_date = datetime.strptime(str(frontmatter["date"]), "%Y-%m-%d").date()
    return MemoryRecord(path=path, kind="session", text=text, date=record_date)


def read_memory_records(root: Path) -> list[MemoryRecord]:
    records: list[MemoryRecord] = []

    decisions_dir = root / ".lamd" / "decisions"
    if decisions_dir.is_dir():
        for path in sorted(decisions_dir.glob("*.json")):
            try:
                records.append(_read_decision_record(path))
            except Exception:
                logger.warning("Skipping unreadable decision file: %s", path, exc_info=True)

    sessions_dir = root / ".lamd" / "sessions"
    if sessions_dir.is_dir():
        for path in sorted(sessions_dir.glob("*.md")):
            try:
                records.append(_read_session_record(path))
            except Exception:
                logger.warning("Skipping unreadable session file: %s", path, exc_info=True)

    return records
