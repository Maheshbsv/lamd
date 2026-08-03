import json
from datetime import datetime, timezone

from lamd_server.storage import list_rules, write_decision


def test_list_rules_returns_sorted_markdown_files(tmp_path):
    rules_dir = tmp_path / ".lamd" / "rules"
    rules_dir.mkdir(parents=True)
    (rules_dir / "02-testing.md").write_text("# Testing", encoding="utf-8")
    (rules_dir / "01-framework.md").write_text("# Framework", encoding="utf-8")
    (rules_dir / "notes.txt").write_text("ignore me", encoding="utf-8")

    result = list_rules(tmp_path)

    assert [p.name for p in result] == ["01-framework.md", "02-testing.md"]


def test_list_rules_returns_empty_list_when_dir_missing(tmp_path):
    assert list_rules(tmp_path) == []


def test_write_decision_creates_expected_file_and_content(tmp_path):
    fixed_now = datetime(2026, 8, 15, 13, 45, 30, tzinfo=timezone.utc)

    path = write_decision(
        tmp_path,
        decision="Use React for the frontend",
        reason="Team already knows it, avoids ramp-up time",
        module="frontend",
        author="Test User",
        branch="feature/lamd",
        now=fixed_now,
    )

    assert path == tmp_path / ".lamd" / "decisions" / "20260815-134530-use-react-for-the-frontend.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data == {
        "decision": "Use React for the frontend",
        "reason": "Team already knows it, avoids ramp-up time",
        "module": "frontend",
        "author": "Test User",
        "date": "2026-08-15",
        "branch": "feature/lamd",
    }


def test_write_decision_does_not_overwrite_on_slug_collision(tmp_path):
    fixed_now = datetime(2026, 8, 15, 13, 45, 30, tzinfo=timezone.utc)

    first = write_decision(
        tmp_path,
        decision="Use React",
        reason="Team already knows it",
        module="frontend",
        author="Test User",
        branch="feature/lamd",
        now=fixed_now,
    )
    second = write_decision(
        tmp_path,
        decision="Use React",
        reason="Team already knows it",
        module="frontend",
        author="Test User",
        branch="feature/lamd",
        now=fixed_now,
    )

    assert first != second
    assert first.exists()
    assert second.exists()
    assert second.name == "20260815-134530-use-react-2.json"
