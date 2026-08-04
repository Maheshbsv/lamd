"""Claude Code SessionStart hook: injects .lamd/rules/*.md into context."""
import json
import sys
from pathlib import Path


def load_rules(rules_dir: Path) -> str:
    sections = []
    for md_file in sorted(rules_dir.glob("*.md")):
        try:
            content = md_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            print(f"lamd_inject_rules: skipping {md_file.name}: {exc}", file=sys.stderr)
            continue
        sections.append(f"## {md_file.name}\n\n{content}")
    return "\n\n".join(sections)


def main() -> None:
    rules_dir = Path.cwd() / ".lamd" / "rules"

    if not rules_dir.is_dir():
        print(json.dumps({}))
        return

    combined = load_rules(rules_dir)

    if not combined:
        print(json.dumps({}))
        return

    output = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": combined,
        }
    }
    print(json.dumps(output))


if __name__ == "__main__":
    main()
