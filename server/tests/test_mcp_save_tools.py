import json
import subprocess

import pytest

from lamd_server.mcp_app import lamd_save_decision, lamd_save_session


@pytest.fixture
def project(tmp_path, monkeypatch):
    (tmp_path / ".lamd" / "rules").mkdir(parents=True)
    (tmp_path / ".lamd" / "decisions").mkdir(parents=True)
    (tmp_path / ".lamd" / "sessions").mkdir(parents=True)
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.name", "Test User"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=tmp_path, check=True)
    (tmp_path / ".gitkeep").write_text("", encoding="utf-8")
    subprocess.run(["git", "add", ".gitkeep"], cwd=tmp_path, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "initial"], cwd=tmp_path, check=True)
    monkeypatch.chdir(tmp_path)
    return tmp_path


def test_lamd_save_decision_writes_file(project):
    message = lamd_save_decision("Use React", "Team knows it", "frontend")

    assert "Saved decision" in message
    files = list((project / ".lamd" / "decisions").glob("*.json"))
    assert len(files) == 1
    data = json.loads(files[0].read_text(encoding="utf-8"))
    assert data["decision"] == "Use React"
    assert data["author"] == "Test User"


def test_lamd_save_session_writes_file(project):
    message = lamd_save_session("Did the thing", "Test it next", ["a.py"])

    assert "Saved session" in message
    files = list((project / ".lamd" / "sessions").glob("*.md"))
    assert len(files) == 1
    assert "Did the thing" in files[0].read_text(encoding="utf-8")


def test_lamd_save_decision_errors_with_helpful_message_when_git_unavailable(project):
    subprocess.run(["git", "config", "user.name", ""], cwd=project, check=True)

    with pytest.raises(RuntimeError, match="git config user.name"):
        lamd_save_decision("Use React", "Team knows it", "frontend")
