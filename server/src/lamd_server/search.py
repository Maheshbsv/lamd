from dataclasses import dataclass
from datetime import date as date_cls
from pathlib import Path

from rank_bm25 import BM25Okapi

from .storage import MemoryRecord

RECENCY_HALF_LIFE_DAYS = 30
SNIPPET_MAX_CHARS = 500


@dataclass
class SearchResult:
    path: Path
    kind: str
    score: float
    snippet: str


def _tokenize(text: str) -> list[str]:
    return text.lower().split()


def search_memory(
    records: list[MemoryRecord],
    query: str,
    *,
    today: date_cls,
    top_k: int = 5,
) -> list[SearchResult]:
    if not records:
        return []

    corpus = [_tokenize(record.text) for record in records]
    bm25 = BM25Okapi(corpus)
    raw_scores = bm25.get_scores(_tokenize(query))

    scored = []
    for record, raw_score in zip(records, raw_scores):
        age_days = max((today - record.date).days, 0)
        decay = 0.5 ** (age_days / RECENCY_HALF_LIFE_DAYS)
        scored.append((record, abs(raw_score * decay)))

    scored.sort(key=lambda pair: pair[1], reverse=True)

    return [
        SearchResult(
            path=record.path,
            kind=record.kind,
            score=score,
            snippet=record.text[:SNIPPET_MAX_CHARS],
        )
        for record, score in scored[:top_k]
    ]
