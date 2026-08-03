import sys
from datetime import datetime, timezone

import pytest

from lamd_server.mcp_app import (
    MISSING_LAMD_ERROR,
    get_all_rules,
    get_rule,
    lamd_search_memory,
)
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


def test_get_rule_rejects_relative_traversal(project):
    secret = project / "secrets.txt"
    secret.write_text("top-secret", encoding="utf-8")

    with pytest.raises(RuntimeError, match="Invalid rule name"):
        get_rule("../../secrets.txt")


@pytest.mark.skipif(sys.platform != "win32", reason="backslash is only a path separator on Windows")
def test_get_rule_rejects_relative_traversal_backslash(project):
    secret = project / "secrets.txt"
    secret.write_text("top-secret", encoding="utf-8")

    with pytest.raises(RuntimeError, match="Invalid rule name"):
        get_rule("..\\..\\secrets.txt")


def test_get_rule_rejects_absolute_path(project, tmp_path):
    outside = tmp_path / "outside.txt"
    outside.write_text("top-secret", encoding="utf-8")

    with pytest.raises(RuntimeError, match="Invalid rule name"):
        get_rule(str(outside))


def test_get_rule_errors_when_no_lamd_dir(tmp_path, monkeypatch):
    empty_dir = tmp_path / "no_lamd"
    empty_dir.mkdir()
    (empty_dir / ".git").mkdir()
    monkeypatch.chdir(empty_dir)

    with pytest.raises(RuntimeError, match=MISSING_LAMD_ERROR):
        get_rule("01-framework.md")


def test_get_all_rules_returns_concatenated_contents(project):
    (project / ".lamd" / "rules" / "02-testing.md").write_text(
        "# Write tests", encoding="utf-8"
    )

    result = get_all_rules()

    assert "# Use React" in result
    assert "# Write tests" in result
    assert "01-framework.md" in result
    assert "02-testing.md" in result


def test_get_all_rules_returns_no_rules_message_when_empty(tmp_path, monkeypatch):
    (tmp_path / ".lamd" / "rules").mkdir(parents=True)
    monkeypatch.chdir(tmp_path)

    assert get_all_rules() == "No rules defined yet."


def test_get_all_rules_errors_when_no_lamd_dir(tmp_path, monkeypatch):
    empty_dir = tmp_path / "no_lamd"
    empty_dir.mkdir()
    (empty_dir / ".git").mkdir()
    monkeypatch.chdir(empty_dir)

    with pytest.raises(RuntimeError, match=MISSING_LAMD_ERROR):
        get_all_rules()


def test_missing_lamd_error_raised_when_no_lamd_and_no_git(tmp_path, monkeypatch):
    isolated = tmp_path / "isolated"
    isolated.mkdir()
    monkeypatch.chdir(isolated)
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))

    with pytest.raises(RuntimeError, match=MISSING_LAMD_ERROR):
        lamd_search_memory("anything")


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
