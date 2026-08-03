from datetime import date

from lamd_server.search import search_memory
from lamd_server.storage import MemoryRecord


def _record(text, day_offset, kind="decision", path="rec.json"):
    return MemoryRecord(
        path=path if not isinstance(path, str) else __import__("pathlib").Path(path),
        kind=kind,
        text=text,
        date=date(2026, 8, 15 - day_offset) if day_offset < 15 else date(2026, 7, 15),
    )


def test_search_memory_returns_empty_list_for_no_records():
    assert search_memory([], "anything", today=date(2026, 8, 15)) == []


def test_search_memory_ranks_relevant_result_first():
    records = [
        _record("database schema uses postgres for storage", 0, path="a.json"),
        _record("frontend uses react and typescript", 0, path="b.json"),
    ]

    results = search_memory(records, "database schema", today=date(2026, 8, 15))

    assert results[0].path.name == "a.json"


def test_search_memory_applies_recency_decay_to_equally_relevant_records():
    records = [
        _record("auth flow uses jwt tokens", 0, path="recent.json"),
        _record("auth flow uses jwt tokens", 60, path="old.json"),
    ]

    results = search_memory(records, "auth flow jwt", today=date(2026, 8, 15))

    assert results[0].path.name == "recent.json"
    assert results[0].score > results[1].score


def test_search_memory_respects_top_k():
    records = [_record(f"topic number {i}", 0, path=f"{i}.json") for i in range(10)]

    results = search_memory(records, "topic", today=date(2026, 8, 15), top_k=3)

    assert len(results) == 3


def test_search_memory_snippet_is_truncated():
    long_text = "word " * 300
    records = [_record(long_text, 0, path="long.json")]

    results = search_memory(records, "word", today=date(2026, 8, 15))

    assert len(results[0].snippet) <= 500
