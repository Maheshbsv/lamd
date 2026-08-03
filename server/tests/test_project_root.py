import pytest

from lamd_server.project_root import ProjectRootNotFoundError, find_project_root


def test_finds_root_with_lamd_dir_at_start(tmp_path):
    (tmp_path / ".lamd").mkdir()
    assert find_project_root(tmp_path) == tmp_path


def test_finds_root_with_lamd_dir_from_nested_child(tmp_path):
    (tmp_path / ".lamd").mkdir()
    nested = tmp_path / "src" / "deep"
    nested.mkdir(parents=True)
    assert find_project_root(nested) == tmp_path


def test_falls_back_to_git_dir_when_no_lamd(tmp_path):
    (tmp_path / ".git").mkdir()
    nested = tmp_path / "src"
    nested.mkdir()
    assert find_project_root(nested) == tmp_path


def test_prefers_lamd_over_git_at_same_level(tmp_path):
    (tmp_path / ".lamd").mkdir()
    (tmp_path / ".git").mkdir()
    assert find_project_root(tmp_path) == tmp_path


def test_raises_when_neither_marker_found(tmp_path):
    isolated = tmp_path / "no_markers_here"
    isolated.mkdir()
    with pytest.raises(ProjectRootNotFoundError):
        find_project_root(isolated)
