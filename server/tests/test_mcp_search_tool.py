import os
from datetime import datetime, timezone

import pytest

from lamd_server.mcp_app import MISSING_LAMD_ERROR, get_rule, lamd_search_memory
from lamd_server.storage import write_decision


@pytest.fixture
def project(tmp_path, monkeypatch):
    (tmp_path / ".lamd" / "rules").mkdir(parents=True)
    (tmp_path / ".lamd" / "decisions").mkdir(parents=True)
    (tmp_path / ".lamd" / "sessions").mkdir(parents=True)
    (tmp_path / ".lamd" / "rules" / "01-framework.md").write_text(
        "# Use React", encoding="utf-8"
    )
    monkeypatch.chdir(tmp_path)
    return tmp_path


def test_get_rule_returns_file_contents(project):
    assert get_rule("01-framework.md") == "# Use React"


def test_lamd_search_memory_returns_no_match_message_when_empty(project):
    assert lamd_search_memory("anything") == "No matching memory found."


def test_lamd_search_memory_returns_formatted_results(project):
    write_decision(
        project,
        "Use React",
        "Team already knows it",
        "frontend",
        "Test User",
        "main",
        now=datetime.now(timezone.utc),
    )

    result = lamd_search_memory("react frontend")

    assert "decision" in result
    assert "Use React" in result


def test_lamd_search_memory_errors_when_no_lamd_dir(tmp_path, monkeypatch):
    empty_dir = tmp_path / "no_lamd"
    empty_dir.mkdir()
    (empty_dir / ".git").mkdir()
    monkeypatch.chdir(empty_dir)

    with pytest.raises(RuntimeError, match=MISSING_LAMD_ERROR):
        lamd_search_memory("anything")
