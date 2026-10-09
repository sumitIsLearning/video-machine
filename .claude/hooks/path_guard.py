"""PreToolUse hook: block Edit/Write/NotebookEdit outside the allowed repo paths.

Usage (in agent frontmatter):
    python .claude/hooks/path_guard.py src tests pyproject.toml

Each argument is a repo-relative folder or file the agent may write to.
Exit 0 allows the call; exit 2 blocks it and shows stderr to the agent.
"""

import json
import os
import sys
from pathlib import Path


def is_allowed(file_path: str, project_dir: Path, allowed: list[str]) -> bool:
    """Return True if file_path resolves inside one of the allowed repo paths."""
    target = (project_dir / file_path).resolve()
    try:
        rel = target.relative_to(project_dir.resolve()).as_posix()
    except ValueError:
        return False  # outside the repo
    if os.name == "nt":  # Windows paths are case-insensitive: New/x.tsx must match "new"
        rel, allowed = rel.casefold(), [a.casefold() for a in allowed]
    return any(rel == a or rel.startswith(a.rstrip("/") + "/") for a in allowed)


def main() -> int:
    allowed = sys.argv[1:]
    tool_input = json.load(sys.stdin).get("tool_input", {})
    file_path = tool_input.get("file_path") or tool_input.get("notebook_path")
    if not file_path:
        return 0
    project_dir = Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
    if is_allowed(file_path, project_dir, allowed):
        return 0
    print(f"Blocked: this agent may only write to {', '.join(allowed)}. Got: {file_path}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
