import logging
from datetime import date, datetime, timezone

from lamd_server.storage import (
    read_memory_records,
    write_decision,
    write_session,
)


def test_write_session_creates_expected_file_and_content(tmp_path):
    fixed_now = datetime(2026, 8, 15, 9, 0, 0, tzinfo=timezone.utc)

    path = write_session(
        tmp_path,
        summary="Implemented the login form",
        next_steps="Wire up the API call",
        files_touched=["src/Login.tsx", "src/api.ts"],
        author="Test User",
        branch="feature/login",
        now=fixed_now,
    )

    assert path == tmp_path / ".lamd" / "sessions" / "2026-08-15-implemented-the-login-form.md"
    content = path.read_text(encoding="utf-8")
    assert "date: '2026-08-15'" in content or "date: 2026-08-15" in content
    assert "user: Test User" in content
    assert "branch: feature/login" in content
    assert "Implemented the login form" in content
    assert "Wire up the API call" in content


def test_read_memory_records_reads_decisions_and_sessions(tmp_path):
    now = datetime(2026, 8, 15, 9, 0, 0, tzinfo=timezone.utc)
    write_decision(
        tmp_path, "Use React", "Team knows it", "frontend", "A", "main", now=now
    )
    write_session(
        tmp_path, "Did some work", "Next: tests", ["a.py"], "A", "main", now=now
    )

    records = read_memory_records(tmp_path)

    kinds = sorted(r.kind for r in records)
    assert kinds == ["decision", "session"]
    assert all(r.date == date(2026, 8, 15) for r in records)
    decision_record = next(r for r in records if r.kind == "decision")
    assert "Use React" in decision_record.text
    session_record = next(r for r in records if r.kind == "session")
    assert "Did some work" in session_record.text


def test_read_memory_records_skips_corrupted_files_and_logs_warning(tmp_path, caplog):
    decisions_dir = tmp_path / ".lamd" / "decisions"
    decisions_dir.mkdir(parents=True)
    (decisions_dir / "20260815-000000-broken.json").write_text("not json", encoding="utf-8")

    with caplog.at_level(logging.WARNING, logger="lamd_server"):
        records = read_memory_records(tmp_path)

    assert records == []
    assert any("broken.json" in message for message in caplog.messages)


def test_read_memory_records_returns_empty_list_when_no_dirs(tmp_path):
    assert read_memory_records(tmp_path) == []
