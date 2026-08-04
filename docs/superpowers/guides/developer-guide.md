# LAMD Developer Guide — A Tutor's Walkthrough

> **Audience:** a developer who knows *some* programming but is still building
> real fluency in Python, hasn't shipped an MCP server before, and wants to
> understand not just *what* to type but *why* the LAMD codebase is shaped
> the way it is. Read this alongside
> `docs/superpowers/specs/2026-08-01-lamd-core-design.md` (the design) and
> `docs/superpowers/plans/2026-08-03-lamd-core-implementation.md` (the task
> list). This guide teaches the *concepts*; the plan gives you the exact
> file-by-file steps. Work through both side by side, typing every line
> yourself — muscle memory is the point.

---

## Table of Contents

1. [How to use this guide](#1-how-to-use-this-guide)
2. [Setting up your machine](#2-setting-up-your-machine)
3. [The mental model: what is LAMD, really?](#3-the-mental-model-what-is-lamd-really)
4. [Python refresher, taught through this codebase](#4-python-refresher-taught-through-this-codebase)
5. [Test-driven development, for real this time](#5-test-driven-development-for-real-this-time)
6. [Building the server, module by module](#6-building-the-server-module-by-module)
7. [Context engineering: the actual hard part](#7-context-engineering-the-actual-hard-part)
8. [MCP deep dive: resources, tools, and the MCP Server SDK](#8-mcp-deep-dive-resources-tools-and-the-mcp-server-sdk)
9. [Skills-file thinking: rules as prompts, prompts as code](#9-skills-file-thinking-rules-as-prompts-prompts-as-code)
10. [Building the installer: modern Node.js CLI development](#10-building-the-installer-modern-nodejs-cli-development)
11. [Git and commit conventions you'll actually use](#11-git-and-commit-conventions-youll-actually-use)
12. [Modern tooling notes (uv, pyproject.toml, ESM)](#12-modern-tooling-notes-uv-pyprojecttoml-esm)
13. [Debugging when things go sideways](#13-debugging-when-things-go-sideways)
14. [Your working checklist](#14-your-working-checklist)

---

## 1. How to use this guide

Don't copy-paste the code blocks from the implementation plan directly into
your editor. Type them by hand, from this guide's *explanations*, and let
yourself make small mistakes — a missing import, a wrong argument order, an
off-by-one in a slice. Fixing those is where the actual learning happens.
When your version diverges slightly from the plan's, that's fine, as long as
the tests you write pass and the interfaces (function names, parameter
names, return types) match what other tasks expect — those are listed
explicitly in each task's **Interfaces** section so teammates (human or
agent) building the next piece don't have to guess.

Work in this order:

1. Read the section here that explains the *concept*.
2. Open the matching task in the implementation plan.
3. Write the failing test first. Run it. Watch it fail for the *reason you expect*.
4. Write the smallest implementation that makes it pass.
5. Run the whole test suite, not just the one file — regressions hide in
   places you weren't looking.
6. Commit.

That loop — red, green, commit — is the rhythm of this entire project.

---

## 2. Setting up your machine

You need three toolchains: Python, Node.js, and Git. Modern LAMD development
leans on newer tooling than you may be used to, so don't reach for `pip` and
`virtualenv` out of habit — read this section fully first.

### 2.1 Python via `uv`

[`uv`](https://docs.astral.sh/uv/) is a single fast binary that replaces
`pip`, `venv`, `pip-tools`, and `pyenv` for most day-to-day work. LAMD's
design doc specifically calls for the server to be launched with `uvx` so
end users never `pip install` anything by hand — so you should get
comfortable with the same tool during development.

Install it (one-time, on your machine, not per-project):

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh   # macOS/Linux
# or on Windows PowerShell:
# powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Once installed, `uv` manages Python versions for you — you don't need a
system Python 3.11 already present:

```bash
uv python install 3.11
```

Inside `server/`, once `pyproject.toml` exists (Task 1 of the plan), you set
up your dev environment with:

```bash
cd server
uv venv                      # creates .venv/
uv pip install -e ".[dev]"   # installs the package in editable mode + pytest
```

`uv venv` and `uv pip install` are drop-in replacements for
`python -m venv` and `pip install` — same mental model, much faster, no
surprises. Activate the environment the normal way
(`source .venv/bin/activate` or `.venv\Scripts\activate` on Windows) or just
prefix commands with `uv run`, e.g. `uv run pytest`.

**Why editable install (`-e`)?** It symlinks your package into the
environment instead of copying it, so edits to `server/src/lamd_server/*.py`
are picked up immediately by the next test run — no reinstall step. This is
the standard way every real Python library development workflow works.

### 2.2 Node.js

You need Node 18+ (the installer's `package.json` will declare this in its
`engines` field — that's not decoration, it's a contract: anything relying
on `node:test` or top-level ESM needs 18+). Use whatever version manager
you're comfortable with (`nvm`, `fnm`, or your OS package manager). Check:

```bash
node --version   # v18.x or newer
```

No global npm packages are required. The installer's own tests run with
Node's *built-in* test runner (`node --test`) — deliberately, to keep the
installer's own dependency footprint at zero. That's not a shortcut, it's a
design decision: the installer is meant to be a "thin" piece of code (see
the spec's Global Constraints), and pulling in Jest or Mocha for a project
this small would contradict that.

### 2.3 Git

You already have this, but confirm your identity is set — LAMD's own
runtime behavior depends on it (`git config user.name` is how decisions and
sessions get attributed):

```bash
git config --global user.name
git config --global user.email
```

If either is empty, set them now. You'll understand exactly why once you
build `git_info.py` in section 6.

---

## 3. The mental model: what is LAMD, really?

Before writing a line of code, hold this picture in your head, because it
explains every design choice downstream:

> LAMD is *not* a database with an AI wrapper around it. It's a folder of
> plain text and JSON files (`.lamd/`) that gets **committed to git like any
> other source file**, plus a small Python process that reads and writes
> those files on Claude's behalf.

That one sentence explains:

- **Why no SQLite/Postgres.** A database file merges badly in git (binary
  diffs, lock contention across branches). Plain files with git's
  line-based merge algorithm just work, and two collaborators on different
  branches never even see each other's in-progress decisions until they
  merge — which is exactly the isolation you want.
- **Why the timestamp is in the filename**, not just a field inside the
  file (`20260815-134530-use-react.json`). Two people writing a decision at
  the same time write to *two different files*. There is no shared file to
  conflict over. This is "conflict avoidance by construction," and it's a
  pattern worth remembering for any multi-writer file-based system you
  build in the future.
- **Why there's no "branch isolation logic" in the server at all.** `git
  checkout` already scopes which files exist on disk. The server just reads
  whatever's in `.lamd/` right now — it doesn't need to know or care about
  branches to do that correctly. The `branch` field stored in each file is
  purely for a human (or Claude) glancing at a decision later to see where
  it came from.

Read the design doc's §2–§3 again now that you have this mental model — it
should click differently the second time.

---

## 4. Python refresher, taught through this codebase

This project uses a specific, modern slice of Python. If any of the
following feels unfamiliar, this is the section to slow down on — you'll
use every one of these repeatedly.

### 4.1 `pathlib.Path`, not string paths

You'll never see `os.path.join` or `"%s/%s" % (...)` in this codebase.
Everywhere a file or directory is referenced, it's a `Path` object:

```python
from pathlib import Path

root = Path("/some/project")
rules_dir = root / ".lamd" / "rules"          # / is overloaded to join paths
rules_dir.mkdir(parents=True, exist_ok=True)  # create it, and any missing parents
for md_file in sorted(rules_dir.glob("*.md")):
    print(md_file.name, md_file.read_text(encoding="utf-8"))
```

Learn these `Path` methods by heart, because you'll write them dozens of
times: `.is_dir()`, `.is_file()`, `.exists()`, `.glob(pattern)`,
`.read_text(encoding=...)`, `.write_text(content, encoding=...)`,
`.resolve()` (turns a relative/symlinked path into an absolute, canonical
one), `.parent`, `.parents` (an iterable of every ancestor directory —
that's how `find_project_root` walks upward), `.relative_to(other)`.

**Always pass `encoding="utf-8"` explicitly** on `read_text`/`write_text`.
Python's default encoding is platform-dependent; omitting it is a classic
bug that only shows up when someone runs your code on Windows with
non-ASCII content in a file.

### 4.2 Type hints are documentation, not decoration

Every function in this codebase has a type-hinted signature:

```python
def find_project_root(start: Path) -> Path:
    ...
```

This tells the *next reader* (a teammate, a subagent, future-you in six
months) exactly what goes in and what comes out, without them having to
read the function body. You don't need a type checker running in CI for
this to be worth doing — the hints are load-bearing documentation. Get in
the habit of writing the signature, including the return type, *before* you
write the body. It forces you to decide what the function actually returns
before you're deep in the logic.

Union types use the modern `|` syntax (Python 3.10+), not
`typing.Optional`:

```python
def write_decision(root: Path, ..., *, now: datetime | None = None) -> Path:
```

That `datetime | None = None` pattern — "accept an optional override,
default to computing it live" — is how you'll make code that calls
`datetime.now()` internally still testable: tests pass a fixed `now` in,
production code lets it default.

### 4.3 The `*,` in a function signature

You'll see this repeatedly:

```python
def search_memory(records, query, *, today, top_k=5):
```

Everything after the bare `*` must be passed **by keyword**, not
positionally. `search_memory(records, query, date(2026, 1, 1))` is a
`TypeError` — you must write `search_memory(records, query, today=date(2026, 1, 1))`.
This is deliberate: `today` and `top_k` are the kind of parameters that are
easy to accidentally swap or misplace if positional, and forcing the
keyword makes every call site self-documenting when you read it later. Use
this pattern yourself whenever a function takes more than one or two
parameters of the same type, or an optional parameter that would otherwise
read ambiguously at the call site.

### 4.4 Custom exceptions, one per failure mode

Instead of raising a bare `Exception` or returning `None`/error-codes, this
codebase defines small, specific exception classes:

```python
class ProjectRootNotFoundError(Exception):
    """Raised when no .lamd/ or .git directory is found walking up from start."""

class GitUnavailableError(Exception):
    """Raised when git is missing, fails, or user.name is not configured."""
```

Why not just `raise Exception("no project root found")`? Because a caller
further up the stack (in our case, the MCP tool functions in `mcp_app.py`)
needs to *catch specifically that failure* and turn it into a helpful
message for the user, without accidentally swallowing an unrelated bug:

```python
try:
    author = get_git_user(root)
except GitUnavailableError as exc:
    raise RuntimeError(f"Could not determine your Git identity ({exc})...") from exc
```

If you'd used a bare `Exception`, this `except` clause would catch
*everything* — including real programming bugs — and mask them as "git
unavailable" errors. Specific exception types are how you keep error
handling honest.

Note the `raise ... from exc` — this preserves the original traceback as
the "cause" of the new exception, so when something goes wrong you can see
the *whole* chain (git failed → we turned that into a friendlier
RuntimeError) instead of losing the original error. Always use `from exc`
when you re-raise inside an `except` block.

### 4.5 `dataclasses` for plain data

```python
from dataclasses import dataclass

@dataclass
class MemoryRecord:
    path: Path
    kind: str
    text: str
    date: date
```

A `@dataclass` auto-generates `__init__`, `__repr__`, and `__eq__` for you.
That last one matters more than it looks: in tests you can write
`assert record == MemoryRecord(path=..., kind=..., text=..., date=...)` and
it does a field-by-field comparison, instead of you writing four separate
assertions. Reach for `@dataclass` any time you catch yourself writing a
class whose only job is to hold a handful of named values together.

### 4.6 `subprocess.run`, safely

`git_info.py` shells out to the real `git` binary rather than reimplementing
git config parsing:

```python
result = subprocess.run(
    ["git", *args],
    cwd=cwd,
    capture_output=True,
    text=True,
    timeout=5,
)
```

Four things to internalize here, because getting any one wrong is a real
security or reliability bug:

- **Pass a list, never a string.** `subprocess.run(["git", "config", "user.name"])`
  is safe. `subprocess.run("git config user.name")` with `shell=True` is how
  you accidentally build a shell-injection vulnerability the moment any part
  of that string comes from user input. Never use `shell=True` in this
  codebase.
- **`capture_output=True, text=True`** gives you `result.stdout` and
  `result.stderr` as decoded strings (not raw bytes) instead of printing to
  the terminal.
- **`timeout=5`** — always bound how long you'll wait for an external
  process. A hung `git` call (e.g. waiting on a credential prompt) should
  fail loudly, not hang your MCP server forever.
- **Check `result.returncode` yourself.** `subprocess.run` does *not* raise
  on a non-zero exit code unless you pass `check=True`. Here we deliberately
  don't, because we want to turn a failure into our own `GitUnavailableError`
  with a good message, not `subprocess`'s generic
  `CalledProcessError`.

### 4.7 `logging`, not `print`

```python
import logging
logger = logging.getLogger("lamd_server")
...
logger.warning("Skipping unreadable decision file: %s", path, exc_info=True)
```

Never use `print()` for anything except a CLI's actual user-facing output
(that's what the Node installer does, deliberately, in section 10). Inside
library/server code, use `logging` so the *caller* decides where messages
go and at what verbosity — a test can assert on log output with `caplog`
(you'll see this in Task 4's corrupted-file test) without that output
polluting normal test runs. Note the `%s` placeholder style, not an f-string
— logging only formats the message if something is actually listening at
that level, which matters for hot paths, though it won't matter much at
LAMD's scale. Still, it's the convention; follow it.

---

## 5. Test-driven development, for real this time

Every task in the implementation plan follows red-green-commit. Here's what
each phase actually trains you to do well.

### 5.1 Red: write a test that fails for the right reason

A good failing test fails with `ModuleNotFoundError` or `AssertionError` —
*not* a typo in the test itself. Before you write any implementation code,
run the test and read the failure message. If it says
`ModuleNotFoundError: No module named 'lamd_server.project_root'`, good —
that's exactly the missing piece you're about to build. If it says
`SyntaxError`, you have a bug in the *test file* to fix first.

### 5.2 `tmp_path`: pytest's built-in sandbox

```python
def test_write_decision_creates_expected_file_and_content(tmp_path):
    path = write_decision(tmp_path, "Use React", ...)
```

`tmp_path` is a pytest fixture — pytest sees the parameter name, recognizes
it, and hands your test function a fresh, empty, real directory on disk that
gets deleted automatically after the test. **Never write a test that
touches your actual project's `.lamd/` folder.** This is a hard project
constraint (see the spec's §7 and the plan's Global Constraints), and
`tmp_path` is how every single test in `server/tests/` honors it. If you
ever find yourself hardcoding a path like `Path(".lamd/decisions")` in a
test, stop — that's a bug, not a shortcut.

### 5.3 Fixtures: shared setup, DRY tests

```python
@pytest.fixture
def git_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "Test User"], cwd=repo, check=True)
    return repo

def test_get_git_user_returns_configured_name(git_repo):
    assert get_git_user(git_repo) == "Test User"
```

A `@pytest.fixture` is a function that *sets up state and hands it to any
test that asks for it by parameter name*. Notice `git_repo` itself takes
`tmp_path` as a parameter — fixtures can depend on other fixtures. This is
how you avoid every test in `test_git_info.py` re-typing the same five
lines of git-init boilerplate. When you notice repeated setup across three
or more tests in one file, that's your signal to extract a fixture.

### 5.4 `monkeypatch`: safely faking global state

```python
@pytest.fixture
def project(tmp_path, monkeypatch):
    ...
    monkeypatch.chdir(tmp_path)
    return tmp_path
```

`find_project_root` is called with `Path.cwd()` inside `mcp_app.py` — it
reads the *real* current working directory. To test that without actually
`os.chdir()`-ing your test runner's process (which would be fragile and
leak between tests), you use `monkeypatch.chdir(...)`, and pytest
automatically reverts it after the test, even if the test fails partway
through. This is the general pattern for testing anything that reads global
process state (env vars, cwd, `sys.path`): `monkeypatch.setenv(...)`,
`monkeypatch.chdir(...)`, `monkeypatch.setattr(...)` — never mutate global
state directly in a test.

### 5.5 `caplog`: asserting on log output

```python
def test_read_memory_records_skips_corrupted_files_and_logs_warning(tmp_path, caplog):
    ...
    with caplog.at_level(logging.WARNING, logger="lamd_server"):
        records = read_memory_records(tmp_path)
    assert any("broken.json" in message for message in caplog.messages)
```

This is how you verify the "skip and log a warning" error-handling
requirement (spec §6) is actually implemented, not just assumed. Note the
scoping: `caplog.at_level(..., logger="lamd_server")` only captures logs
from *our* logger, matching the `logging.getLogger("lamd_server")` call in
`storage.py` — this avoids your test accidentally passing (or failing) due
to log noise from some unrelated library.

### 5.6 Green: the smallest change that passes

Resist the urge to write more than the test demands. If the test only
checks that `list_rules` returns `.md` files sorted by name, don't also add
speculative support for `.markdown` files "just in case" — that's scope
creep the test suite doesn't justify, and it's exactly what the project's
YAGNI principle (see the design doc's tone throughout) asks you to avoid.
Add it later, with its own test, if it's actually needed.

### 5.7 Commit: small, and only when green

Run the *whole* test file's suite (not just the one new test) before you
commit — `pytest tests/test_storage_decisions.py -v` — and then, before
moving to the next task, run the *entire* suite: `pytest -v` from
`server/`. Catching a regression in `test_project_root.py` while you're
heads-down on `search.py` is exactly what that full run is for.

---

## 6. Building the server, module by module

Follow the plan's tasks 1–7 for exact code. This section explains the
*reasoning* behind each module's shape, so when you sit down to type it,
you understand every line instead of transcribing it.

### 6.1 `project_root.py` — "where am I?"

Claude Code launches the MCP server as a background process with its
working directory set to the project root — but you shouldn't *trust* that
blindly, because a user's setup could differ, and a robust tool verifies
its own assumptions. `find_project_root` walks upward from the current
directory (`current`, then every entry in `current.parents`, which
`pathlib` gives you as an ordered list from immediate parent up to
filesystem root) looking first for `.lamd/`, then falling back to `.git/`.

Why two markers, checked in two separate passes rather than one combined
loop? Read the plan's test
`test_prefers_lamd_over_git_at_same_level` again: if both exist at the same
directory, `.lamd/` must win, because that's the actually-initialized LAMD
project. Doing it as two separate `for candidate in candidates` loops (find
`.lamd` anywhere above me; only if that fails, find `.git` anywhere above
me) gets that priority right for free, and it's more obviously correct at a
glance than one loop with an if/elif that tracks "found either yet."

### 6.2 `git_info.py` — "who am I, and where's my work?"

This is the thinnest possible wrapper around three `git` subcommands:
`git rev-parse --is-inside-work-tree`, `git config user.name`, and
`git rev-parse --abbrev-ref HEAD`. Resist any temptation to parse
`.git/config` or `.git/HEAD` by hand — those are implementation details of
git's internal storage that can change, whereas the `git` CLI's output
format is a stable public contract. **Always shell out to the real binary
for anything git-related.** This is a rule worth carrying into every future
project: never hand-roll a parser for another tool's internal file formats
when that tool ships a CLI that already exposes the same information
safely.

**A real bug that shipped and was caught in review, worth internalizing:**
an early version of `get_git_user` ran `git config --local user.name`
instead of plain `git config user.name`. That looked reasonable — `--local`
makes `get_git_user` fail deterministically outside a real git repo, which
is exactly what one test wanted. But `--local` *only* reads that repo's own
`.git/config`, ignoring `~/.gitconfig` entirely — and almost every real
developer sets `user.name` **globally**, once, and never again per-repo.
Shipped as `--local`, the save tools would have failed with "could not
determine your git identity" for nearly every real user, while still
passing every test on the author's own machine (which happened to have a
local override in the test fixtures, not in real usage). The fix needed
*two* checks instead of one: first confirm you're actually inside a git
working tree at all (`git rev-parse --is-inside-work-tree`, which fails
outside any repo regardless of global config), *then* read
`git config user.name` with no scope flag, which correctly resolves
local-overrides-global exactly the way a human running `git commit` would
expect. The lesson: when a flag makes one specific test pass, ask what
population of *real users* that flag silently breaks — a test that passes
for the wrong reason is worse than a test that fails honestly. And when you
add a test fixture, ask whether it accidentally makes the "normal" case
(global config only) untestable, since that's exactly what hid this bug
until a later review caught it.

### 6.3 `storage.py` — the only code that touches disk for memory files

Every read or write of a decision, session, or rule file goes through this
one module. That's a deliberate boundary: if you ever need to change the
file format (say, switching decisions from JSON to TOML), this is the only
file that changes — `search.py` and `mcp_app.py` only ever see the
already-parsed `MemoryRecord` dataclass, never raw file bytes. This is the
"can you change the internals without breaking consumers?" test from the
design skill's checklist, applied concretely.

Notice the slugify helper:

```python
def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "untitled"
```

The leading underscore on `_slugify` is a Python convention, not an
enforced access control — it signals "this is a private helper, internal to
this module, don't import it elsewhere." Read it as a note to your future
self and to teammates. The regex collapses any run of non-alphanumeric
characters into a single hyphen, then strips leading/trailing hyphens —
walk through `"Use React!"` → lowercase `"use react!"` → regex replace
`"use-react-"` → strip → `"use-react"` by hand once, on paper, so the
transformation isn't a black box to you.

The `or "untitled"` at the end matters more than it looks: if `decision`
were an empty string, `_slugify` would otherwise return `""`, and your
filename would become `20260815-134530-.json` — a valid but confusing
filename. Always think through the empty-input case for any string
transformation you write.

### 6.4 `search.py` — BM25 plus a hand-rolled recency multiplier

BM25 (via the `rank_bm25` library's `BM25Okapi`) is a *keyword relevance*
algorithm — it scores how well a query's words match a document's words,
accounting for term frequency and document length, the same family of
algorithm search engines used before neural embeddings became cheap. It
does **not** know or care about time. That's why there's a second,
deliberately simple step layered on top:

```python
age_days = max((today - record.date).days, 0)
decay = 0.5 ** (age_days / RECENCY_HALF_LIFE_DAYS)
```

This is exponential decay with a 30-day half-life: a record from today
gets `decay = 1.0` (no penalty), a record 30 days old gets `decay = 0.5`
(half weight), a record 60 days old gets `0.25`, and so on. Multiplying the
raw BM25 score by this decay factor means "equally relevant, but older"
records rank lower — which matches how you'd actually want project memory
to behave: yesterday's architectural decision should usually outrank one
from six months ago that covers the same keywords, because codebases
evolve and the older one may no longer be current. The `max(..., 0)`
guards against a record whose `date` is somehow in the future (clock skew,
bad test data) producing a negative exponent that would *boost* the score
instead of decaying it — always think about what happens at your
function's edges, not just its happy path.

Why is this two separate steps (BM25, then decay) instead of a fancier
single model? Because it's the simplest thing that satisfies the actual
requirement, it's trivial to unit test each half independently, and a
human reading `search_memory` six months from now can understand the whole
ranking algorithm in about thirty seconds. That's YAGNI in practice: don't
reach for a more sophisticated ranking model until you have evidence the
simple one is actually insufficient.

**A real bug worth studying: `raw_score * decay` isn't always safe.**
BM25's IDF term (`log((N - df + 0.5) / (df + 0.5))`) goes *negative* when a
query term appears in more than half the corpus — which happens easily on
a small, early-stage `.lamd/decisions/` folder with only a handful of
records and some overlapping vocabulary. A first implementation multiplied
`raw_score * decay` directly, and on a corpus with negative scores this
**inverts** the intended ranking: multiplying a negative number by a
`decay` factor less than 1 makes it *less* negative — i.e. numerically
larger — so an *older* record could end up ranked above a more recent,
equally-relevant one. A tempting "fix" is `abs(raw_score * decay)`, which
does make the specific failing test pass — but it's wrong in a more
consequential way: it collapses all negative scores into positive territory,
so a barely-relevant record that happens to share one very common word with
the query (and therefore gets a strongly negative BM25 score) can end up
with a *larger* absolute value than a genuinely relevant record's small
positive score, outranking it. The actual fix has to be sign-aware:
recency decay should shrink a positive (relevant-signal) score toward zero
with age, exactly as before, but push a negative (weak-signal) score
*further* negative with age, never letting it cross into positive
territory:

```python
signed_score = raw_score * decay if raw_score >= 0 else raw_score / decay
```

This guarantees a positive-signal score can never lose to a negative-signal
one, no matter how old the positive one is. The broader lesson: **when a
"fix" makes a specific test pass, ask what it does on inputs the test
doesn't cover.** `abs()` is a classic shape of self-serving patch — locally
plausible, globally wrong — and the only way to catch it is to reason about
(or empirically construct) a case the original test didn't exercise, not to
trust that green tests mean correct code.

### 6.5 `mcp_app.py` — where everything gets wired together

This file is intentionally the *last* thing you build, and it's
intentionally thin. Every function in it does three things and nothing
more: (1) figure out the project root and validate `.lamd/` exists, (2)
call into `storage.py`/`search.py`/`git_info.py` to do the actual work, (3)
format a string response. If you ever find yourself writing file I/O or
BM25 logic directly inside a function decorated with `@mcp.tool()`, stop —
that logic belongs in `storage.py` or `search.py`, testable on its own,
without needing to spin up an MCP server to exercise it. Section 8 goes
deep on what `@mcp.tool()` and `@mcp.resource()` actually do.

**A real security bug worth studying: MCP resource template parameters are
untrusted input.** `get_rule`'s URI template is `lamd://rules/{name}` —
FastMCP fills `name` from whatever URI the *model* asks to fetch. An early
version did `path = root / ".lamd" / "rules" / name; return
path.read_text(...)` with no validation at all. That looks harmless — this
is "our own" server talking to "our own" files — until you remember that
`name` isn't typed by a human at a terminal; it's supplied by a language
model that could be influenced by adversarial content sitting inside a
retrieved document, a comment in someone else's code, or just an honest
mistake in what the model decides to request. A `name` of
`"..\\..\\..\\secrets.json"` or an absolute path like
`"C:\\Users\\me\\.ssh\\id_rsa"` sails straight past FastMCP's own
`[^/]+` template-matching regex (it only blocks literal forward slashes,
not backslashes or drive letters), and `pathlib.Path` happily resolves the
join outside the intended directory, or discards the base path entirely
for an absolute right-hand side. The result: an MCP tool that was supposed
to read one rules folder becomes an arbitrary-file-read primitive. The fix
is the standard "confinement" pattern for any code that turns caller input
into a filesystem path — resolve both sides and check containment, not
just presence of `..`:

```python
rules_dir = (root / ".lamd" / "rules").resolve()
candidate = (rules_dir / name).resolve()
if not candidate.is_relative_to(rules_dir):
    raise RuntimeError("Invalid rule name")
```

The general principle: **any function where caller-supplied input becomes
part of a filesystem path, URL, or shell command is an external-input
boundary**, even when the "caller" is a component you wrote yourself,
because the *data flowing through* that caller may not be something you
control end to end. Treat "the model decided what to ask for" the same way
you'd treat "the HTTP request body decided" — validate at the boundary,
don't trust that the call site looks internal.

---

## 7. Context engineering: the actual hard part

Writing `write_decision` is a normal software engineering task. Deciding
*what belongs in `.lamd/rules/` versus `.lamd/decisions/`*, and *how much
of each gets shown to Claude and when*, is **context engineering** — and
it's the actual design problem this whole project exists to solve. Here's
the reasoning to internalize, not just the code to type.

### 7.1 The core tension: context is a scarce, expensive resource

Every token you inject into Claude's context window costs money, costs
latency, and — past a certain point — actively *hurts* the model's ability
to find and use the relevant information, because it has to sift through
more noise. Context engineering is the discipline of deciding, for every
piece of information a system *could* show the model, whether it should be
shown **always**, shown **on demand**, or **not shown at all**. LAMD makes
that decision explicit through its three-tier memory model:

| Tier | Injected how | Why |
| :--- | :--- | :--- |
| **Rules** | Always, in full, every session | Small in volume, universally relevant, and violating one is a *hard* failure — you never want Claude one search-miss away from breaking a guardrail. |
| **Decisions & Sessions** | On demand, via `lamd_search_memory` | Grows unboundedly over a project's life. Injecting all of it, always, would eventually blow the context budget for no benefit — most decisions aren't relevant to what Claude is doing *right now*. |
| **Everything else** (not in `.lamd/`) | Not injected at all | If it's not been explicitly captured as a rule, decision, or session, LAMD has no opinion on it. |

This is why `lamd_search_memory` explicitly **never searches `rules/`**
(see the MCP Tools table in the spec) — those are already fully present in
every session via the resource mechanism, so searching them too would be
redundant work that also risks surfacing a truncated, search-ranked
fragment of a rule instead of the rule's full, authoritative text.

### 7.2 Resources vs. tools is a context-engineering decision, not just an API choice

MCP gives you two different mechanisms — resources and tools — and picking
the right one for each kind of data *is* the design work:

- **Resources** are things the *client* (Claude Code) decides to fetch and
  inject, typically once, up front. Good for content that's small, stable
  within a session, and should be present by default without Claude having
  to "think to ask." Rules fit this perfectly.
- **Tools** are things the *model* decides to call, based on what it's
  currently trying to do. Good for content that's large, that changes
  based on the current query, or that would be wasteful to inject
  unconditionally. Search fits this perfectly — Claude only pays the token
  cost of decision/session content when it actually needs to look
  something up.

If you ever catch yourself building a new memory type for LAMD, ask this
question first: *does every session need this, unconditionally, in full —
or does the model need to be able to ask for it, sometimes, in part?* The
answer tells you whether it's a resource or a tool before you write a
single line of code.

### 7.3 Truncation and "top-K" are context budgeting, made explicit

`search_memory`'s `top_k=5` default and its `SNIPPET_MAX_CHARS = 500`
truncation aren't arbitrary. They're an explicit, tunable answer to "how
much of my context budget is this single tool call allowed to spend?" A
system that returns *all* matching results, untruncated, will work fine in
a demo and then silently degrade (slower responses, worse instruction
following, higher cost) as a real project's `.lamd/decisions/` folder grows
to hundreds of files. Bake budgets like this into any retrieval system you
build — as named constants, near the top of the file, exactly like
`RECENCY_HALF_LIFE_DAYS` and `SNIPPET_MAX_CHARS` in `search.py` — so a
future maintainer can find and tune them in one place instead of hunting
through the function body.

### 7.4 Prompt injection isn't a vulnerability here — it's the mechanism

In security contexts, "prompt injection" is an attack. In LAMD, the
*directives* described in the spec's §5 ("Read `.lamd/rules/` resources
before acting, and refuse...") are **legitimately injected instructions**,
delivered as part of the MCP server's own system prompt contribution — the
same mechanism an attacker would abuse, deliberately used for its intended
purpose: steering model behavior with natural-language instructions instead
of code. This is why enforcement is explicitly "prompt-engineering only"
for this MVP (spec §5) — there's no code path that can *force* Claude to
comply, only an instruction that a well-behaved, instruction-following
model will follow. Understanding that distinction — code enforces via
control flow; prompts "enforce" via persuasion the model is trained to
respect — is the single most important context-engineering insight in this
whole project, and it's why the spec is honest that this isn't a hard
guarantee.

---

## 8. MCP deep dive: resources, tools, and the MCP Server SDK

**MCP (Model Context Protocol)** is an open protocol for connecting an AI
client (here, Claude Code) to external tools and data sources over a
standard interface — think of it as the plumbing that lets Claude call
`lamd_save_decision` the same structured way regardless of what language or
process implements it on the other end. You're using the *official* `mcp`
Python SDK's `MCPServer` class (formerly `FastMCP` in SDK v1.x), which gives
you a decorator-based API on top of the raw protocol — conceptually the
same relationship Flask has to raw WSGI, or FastAPI has to raw ASGI: you
write plain functions, decorate them, and the framework handles protocol
serialization, request routing, and schema generation for you.

### 8.1 The three primitives

- **Resources** (`@mcp.resource("lamd://rules/{name}")`) — addressable,
  read-only content the client can fetch by URI. The `{name}` in the URI is
  a *template variable*: `MCPServer` inspects your function's signature
  (`def get_rule(name: str) -> str`) and matches it to the template, so
  when the client resolves `lamd://rules/01-framework.md`, `MCPServer` calls
  `get_rule(name="01-framework.md")` for you. You never parse the URI by
  hand.
- **Tools** (`@mcp.tool()`) — functions the model can *invoke*, with
  arguments, mid-conversation, when it decides it needs to. `MCPServer`
  generates the tool's JSON-schema description straight from your Python
  type hints — this is another reason type hints in this codebase aren't
  optional decoration: `def lamd_save_decision(decision: str, reason: str,
  module: str) -> str` becomes the exact schema the model sees when
  deciding what arguments to pass. Get the hints right, or the model gets a
  wrong or missing schema.
- **Prompts** (not used in LAMD's MVP, but worth knowing) — reusable
  prompt templates the client can surface to the user, e.g. as slash
  commands. LAMD doesn't define any custom ones for this MVP; the
  "proactive curation" instructions instead ride along as part of the
  server's injected directives (§7.4 above).

### 8.2 How the server actually starts

```python
mcp = MCPServer("lamd")

@mcp.tool()
def lamd_search_memory(query: str) -> str:
    ...

def main() -> None:
    mcp.run()
```

`mcp.run()` starts the server's event loop and blocks — it's the last thing
your process does. `main()` exists as a separate, tiny function (rather
than putting `mcp.run()` at module import time) specifically so it can be
wired up as a **console-script entry point** in `pyproject.toml`:

```toml
[project.scripts]
lamd-mcp-server = "lamd_server.mcp_app:main"
```

That's what lets `uvx --from git+https://github.com/Maheshbsv/lamd.git#subdirectory=server lamd-mcp-server`
work as a command at all — `uvx` installs the package into a throwaway
environment and then runs whatever binary the `[project.scripts]` table
told it to create, named `lamd-mcp-server`, which just calls your `main()`.
This is standard Python packaging, not MCP-specific — the same
`[project.scripts]` mechanism is how tools like `black` or `ruff` become
runnable commands after `pip install`.

### 8.3 Why `mcp.run()` never appears in a test

You'll notice none of the tests in Task 6 or 7 call `main()` or `mcp.run()`
— they call the underlying functions (`get_rule(...)`,
`lamd_search_memory(...)`) directly, as plain Python. The `@mcp.tool()` and
`@mcp.resource()` decorators register the function with the `MCPServer` app
*and* still leave it callable as an ordinary function underneath. That's a
deliberate `MCPServer` design choice, and it's exactly why this codebase can
have thorough test coverage on the actual MCP-exposed behavior without ever
needing to spin up a real MCP client/server connection in the test suite —
another example of the "design for isolation" principle from the brainstorming
skill's checklist paying off concretely.

One intentional exception: `server/tests/test_mcp_registration.py` does call
`mcp.list_tools()`, `mcp.list_resources()`, and `mcp.list_resource_templates()`
directly on the live `MCPServer` instance. This is deliberate — it exercises
SDK *registration* behavior on the server instance itself (never the
transport/network layer that `mcp.run()` starts), which is exactly what
would catch an SDK rename or a registration break that calling the
decorated functions directly wouldn't catch.

---

## 9. Skills-file thinking: rules as prompts, prompts as code

You're building LAMD *while working inside* Claude Code's own Skills
system (notice the `docs/superpowers/` folder structure this guide lives
in) — which makes this project a good, close-up example of a pattern
that's becoming common across modern AI tooling: **markdown files with
just enough structure to be both human-readable documentation and
machine-actionable instructions.**

Compare the shape of a Claude Code Skill file:

```markdown
---
name: my-skill
description: One-line summary used to decide relevance
metadata:
  type: feedback
---

The actual instruction content, in plain prose.
```

...to the shape of a LAMD rule file, `.lamd/rules/01-framework.md`:

```markdown
# Framework Rules

- Use React
- Always use async/await
```

Both are markdown. Both are meant to be read in full and followed, not
searched and fuzzily matched. Both are version-controlled alongside the
code they govern, so they evolve with the project instead of drifting out
of date in some separate wiki. The lesson worth carrying forward: when you
need to give an AI system a standing instruction that should *always*
apply, plain, well-organized markdown, committed to git, next to the code
it governs, is usually the right format — not a database row, not a config
flag buried in JSON, not a comment in code that nobody re-reads. This is
also why LAMD's `.lamd/decisions/*.json` files are structured (JSON) rather
than prose — decisions need queryable *fields* (`module`, `author`,
`date`) for ranking and filtering, whereas rules are pure "read the whole
thing" content with no fields to query.

If you go on to write your own Claude Code Skill for some other tool
(you'll find `.claude/plugins/cache/.../skills/` full of real examples on
this machine — `brainstorming` and `writing-plans`, which you've been using
this whole session, are two of them), you're applying exactly this same
judgment call: what's a standing rule the agent should always read (goes in
the skill's main markdown body, always loaded), and what's reference
material it should only pull in on demand (goes in a separate file under
`references/`, loaded only when relevant — the direct skills-authoring
equivalent of LAMD's resources-vs-tools split in §7.2).

---

## 10. Building the installer: modern Node.js CLI development

The installer is deliberately the simplest code in this repository — that
simplicity is itself worth studying as a design choice.

### 10.1 ESM, not CommonJS

```json
{ "type": "module" }
```

That one line in `package.json` means every `.js` file in `installer/` is
an ES module: `import`/`export`, not `require`/`module.exports`. This is
the modern default for new Node projects — CommonJS (`require`) is legacy
compatibility mode at this point. If you're used to older Node tutorials
that use `require`, deliberately unlearn that here; write `import { readFileSync }
from "node:fs"` and `export function scaffold(...)`.

Note the `node:` prefix on built-in module imports (`node:fs`, `node:path`,
`node:os`, `node:test`) — that's the modern, explicit way to import Node's
standard library, distinguishing it unambiguously from an npm package of
the same name. Use the prefix; don't write bare `"fs"`.

### 10.2 Node's built-in test runner

```js
import { test } from "node:test";
import assert from "node:assert/strict";

test("scaffold creates the three .lamd subdirectories", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));
  scaffold(projectRoot);
  assert.ok(existsSync(join(projectRoot, ".lamd", "rules")));
});
```

`node --test` discovers and runs every file under `test/` (or matching
`*.test.js`) with zero configuration and zero dependencies — no Jest, no
Mocha, nothing in `package.json`'s `devDependencies` at all. `assert/strict`
gives you `assert.equal`, `assert.deepEqual`, `assert.ok`, `assert.throws`
— the same shapes you'd recognize from any assertion library, just built
in. This mirrors the Python side's philosophy of "test in isolation" —
`mkdtempSync(join(tmpdir(), "lamd-test-"))` is Node's equivalent of
pytest's `tmp_path` fixture: a fresh, real, throwaway directory per test,
so no test ever touches your actual project files.

### 10.3 Idempotency: re-running `init` shouldn't destroy work

```js
if (!existsSync(starterRulePath)) {
  writeFileSync(starterRulePath, STARTER_RULE, "utf8");
}
```

This `if` is the entire reason Task 8 has a dedicated test
(`scaffold does not overwrite an existing starter rule file`). A user might
run `lamd init` once, hand-edit `01-framework.md` with their team's actual
rules, and then run `lamd init` again later (maybe a teammate suggests it,
or a future version adds a new directory to scaffold) — and that second run
must not silently wipe out their edits. Any CLI command a user might
plausibly run more than once should be **idempotent**: running it twice
should be safe and should not destroy state the first run (or the user)
created. Apply this test whenever you write installer/setup code in any
future project: "what happens if this runs again, on top of itself?"

### 10.4 Merging into `.mcp.json`, not overwriting it

```js
const config = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, "utf8"))
  : {};
config.mcpServers = config.mcpServers || {};
config.mcpServers[SERVER_NAME] = SERVER_ENTRY;
writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
```

Same principle as above, at the level of a single config file instead of a
directory: a project might already have other MCP servers registered in
`.mcp.json` before LAMD is ever installed. Read-modify-write, touching only
the one key you own (`config.mcpServers.lamd`), is how you avoid clobbering
a teammate's unrelated MCP server registration. This read-modify-write
pattern — never blindly overwrite a shared config file — is worth
remembering any time your tool needs to coexist with other tools writing to
the same file.

### 10.5 The shebang and `bin` field

```js
#!/usr/bin/env node
```

That first line of `bin/lamd.js` is a **shebang** — on Unix-like systems
(Linux, macOS), it tells the shell "run this file using whatever `node`
resolves to on the current `PATH`," which is what lets the file be executed
directly (`./bin/lamd.js`) instead of always needing `node bin/lamd.js`.
Combined with a `package.json`'s:

```json
"bin": { "lamd": "./installer/bin/lamd.js" }
```

...this is what makes `npx github:Maheshbsv/lamd init` work at all: `npx`
resolves the package's `bin` entry and executes it as the `lamd` command,
with `init` passed through as `process.argv[2]`. On Windows, npm generates
a small `.cmd`/`.ps1` shim automatically at install time that achieves the
same effect — you don't need to do anything platform-specific yourself, but
it's worth knowing *why* the shebang line, though functionally inert on
Windows, is still there and still correct to include.

**A real packaging bug worth studying: `bin` only counts at the repo
root.** The first cut of this project put `package.json` (with its `bin`
field) inside `installer/`, alongside `installer/bin/lamd.js` — which reads
as perfectly reasonable, since that's where all the installer's code lives.
It even passed every test, because the tests invoke `bin/lamd.js` directly
with `node bin/lamd.js` / `execFileSync`, never through npm's own `bin`
resolution. But the *documented, user-facing* install command is
`npx github:Maheshbsv/lamd init` — and npm's `github:owner/repo` install
spec fetches the repository and reads `package.json` **at the repository
root only**. There is no subdirectory mechanism for it (that's a `uv`/`pip`
feature — which is exactly why the *Python* side's `uvx --from
git+https://...#subdirectory=server` legitimately works, and why it's easy
to assume, wrongly, that the Node side has the same escape hatch). With
`package.json` sitting one level down in `installer/`, the documented
one-line install command would fail outright with something like "does not
contain a package.json file" — a total, silent failure of the only
user-facing entrypoint, invisible to every test in the suite because none
of them actually exercised installation *the way a real user would run it*
(`npx github:...`, not a direct `node` invocation). The fix: a `package.json`
at the true repository root, with `"bin": {"lamd":
"./installer/bin/lamd.js"}` pointing back down into the subdirectory where
the actual file still lives — `bin`'s path is just a relative path from
wherever the manifest sits, so the code doesn't need to move, only the
manifest that advertises it. The broader lesson, worth carrying into any
future CLI packaging work: **a test suite that only calls your code
directly can give 100% green while the actual, documented, user-facing
install path is completely broken.** When a project's real entry point is
"a stranger runs one command from your README," write at least one test —
or do at least one manual dry run — that goes through that literal command
or its closest local equivalent (`npm pack` + `npm install` from the
tarball, in this case), not just the internals it eventually calls.

---

## 11. Git and commit conventions you'll actually use

Every task in the implementation plan ends with a commit like:

```
feat(server): add project scaffolding and project-root detection
```

This is **Conventional Commits** style: `<type>(<scope>): <summary>`.

- `feat` — a new capability. `fix` — a bug fix. `test` — test-only changes.
  `docs` — documentation only. `refactor` — internal restructuring with no
  behavior change. You'll use `feat` almost exclusively while building
  LAMD's MVP, since nearly every task adds new capability.
- `(server)` / `(installer)` — the scope, i.e., which part of the repo this
  commit touches. Skim `git log --oneline` in a mature project using this
  convention and you can tell at a glance which subsystem changed without
  opening the diff.
- The summary is imperative mood ("add," not "added" or "adds") and doesn't
  end in a period — read it as completing the sentence "if applied, this
  commit will ___."

**Commit at the end of every task, not less often, and rarely more.** A
commit that bundles "add search.py" with "also add mcp_app.py" makes it
harder for a reviewer (or a future `git bisect`) to isolate which change
introduced a regression. A commit for every single tiny step (one for the
test file, a separate one for the implementation) is noise in the other
direction. The plan's task boundaries were chosen specifically to line up
with "one coherent, independently-reviewable, test-covered unit of work" —
that's your commit granularity.

Before every commit, get in the habit of running `git status` and `git diff
--staged` and actually reading what you're about to commit — not as
ceremony, but because it's the single cheapest moment to catch a stray
debug `print()` statement, an accidentally-included `.venv/` file, or a
change you didn't mean to stage.

---

## 12. Modern tooling notes (uv, pyproject.toml, ESM)

A few "why this and not the older thing" notes, since you'll see references
to older Python tooling elsewhere and might wonder why this project doesn't
use it:

- **`pyproject.toml`, not `setup.py`.** `pyproject.toml` is the current
  standard (PEP 517/518) for declaring a Python package's metadata,
  dependencies, and build system, all in one static, tool-agnostic file. A
  `setup.py` is an *executable Python script* that produces that same
  metadata as a side effect of running it — which is both slower and a
  latent security concern (installing a package could execute arbitrary
  code). New projects should always prefer `pyproject.toml`.
- **`hatchling` as the build backend.** The `[build-system]` table in
  `pyproject.toml` says *which tool* turns your source tree into an
  installable package. `hatchling` is a modern, minimal, fast choice —
  functionally comparable to `setuptools`, but with less legacy baggage and
  sane defaults for a `src/`-layout package (exactly the layout
  `server/src/lamd_server/` uses).
- **`src/` layout.** Notice the package code lives at
  `server/src/lamd_server/`, not `server/lamd_server/`. This is a
  deliberate, common convention: it prevents Python from accidentally being
  able to import your package directly out of the working directory
  without it actually being installed — which would let a bug where the
  package isn't properly *installed* hide, since imports would "work
  anyway" purely by accident of your current directory. The `src/` layout
  forces `uv pip install -e .` (or a real install) to actually succeed
  before `import lamd_server` works anywhere, which is exactly the
  guarantee you want your tests to be checking.
- **`uvx` for zero-install execution.** `uvx some-tool` downloads `some-tool`
  into an ephemeral, cached virtual environment and runs it, without ever
  touching your global Python or leaving a permanent install behind. It's
  the direct Python-ecosystem analogue of `npx` — which is exactly why the
  spec pairs "`npx github:...` for the installer" with "`uvx` for the
  server": both mechanisms exist to let a user run a tool without a
  separate, manual "go install the language's package manager, then
  install the tool" step first.

---

## 13. Debugging when things go sideways

A few LAMD-specific debugging habits, beyond general Python/Node debugging:

- **A test fails with `GitUnavailableError` you didn't expect?** Check
  whether your test's fixture actually ran `git init` in that `tmp_path` —
  `get_git_user`/`get_current_branch` genuinely need a real git repository
  underneath the directory you pass them; they don't work on a plain empty
  folder. This is intentional (see `test_get_git_user_raises_outside_a_repo`
  in Task 2) — but it's easy to forget when writing a *new* test elsewhere
  that also happens to call these functions.
- **`lamd_search_memory` returns "No matching memory found" when you
  expected results?** Walk the failure backward through the pipeline in
  order: did `read_memory_records` actually find the files (check
  `.lamd/decisions/`/`.lamd/sessions/` exist and aren't empty)? Did it skip
  them as "corrupted" (check for a logged warning — malformed JSON or a
  frontmatter parse failure will silently skip a file, by design, rather
  than crash)? Only once you've confirmed records reached `search_memory`
  is it worth suspecting the BM25/decay math itself.
- **The installer's CLI test hangs or times out?** `execFileSync` will
  throw if the child process exits non-zero, but if `bin/lamd.js` is
  waiting on something (a stray `readline` prompt, for instance), it'll
  hang instead. Keep the installer's `init` command fully non-interactive —
  no prompts, no confirmations — which is also just good CLI design for
  something meant to run unattended via `npx`.
- **Something about MCP itself misbehaving once you wire it into actual
  Claude Code (post-plan, manual verification)?** Check Claude Code's MCP
  server logs — the `mcp` SDK logs protocol-level errors there, separate
  from your own `logging.getLogger("lamd_server")` output, and it's the
  first place to look if the server registers in `.mcp.json` correctly but
  Claude Code reports it as failing to start.

---

## 14. Your working checklist

Work through the implementation plan's nine tasks in order — they're
sequenced so each one's dependencies already exist by the time you need
them. For each task:

- [ ] Re-read this guide's matching section for the *why* before you start.
- [ ] Write the test from the plan (or your own equivalent, if you
      understand the concept well enough to write it from scratch — even
      better).
- [ ] Run it, confirm it fails for the expected reason.
- [ ] Implement, run again, confirm green.
- [ ] Run the *whole* test suite for that language (`pytest -v` in
      `server/`, or `node --test` in `installer/`).
- [ ] Commit with a Conventional Commits message.
- [ ] Before moving on, ask yourself: could I explain what this module does,
      and why it's shaped this way, to someone who's never seen it? If not,
      slow down and re-read the relevant section above before continuing.

By the end of Task 9, you'll have hand-built a working MCP server and its
installer — and, more importantly, you'll understand every design decision
behind it well enough to make the *next* one yourself.
