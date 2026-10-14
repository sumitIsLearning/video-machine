#!/usr/bin/env python3
"""Cut one task out of a phase plan into a small brief file for a builder or reviewer.

Usage:
    python3 .claude/tools/brief.py <plan.md> <task-id> [--out <file>]

The brief holds the plan's Global Constraints, the rulings the task names (R1, R7, ...) and the task section,
then empty "Do not touch" and "Context pack" sections that the orchestrator fills before dispatch.
Default output: .superpowers/sdd/<plan stem>/briefs/task-<id>.md (git-ignored). Prints the path and size.
"""

import re
import sys
from pathlib import Path


def sections(lines: list[str]) -> list[tuple[str, int, int]]:
    """Return (heading, start, end) for every ## / ### heading outside code fences."""
    heads, fenced = [], False
    for i, line in enumerate(lines):
        if line.startswith("```"):
            fenced = not fenced
        elif not fenced and re.match(r"#{2,3} ", line):
            heads.append((line.strip(), i))
    return [(h, s, heads[n + 1][1] if n + 1 < len(heads) else len(lines)) for n, (h, s) in enumerate(heads)]


def block(lines: list[str], secs: list[tuple[str, int, int]], pattern: str) -> str:
    """Text of the first section whose heading matches pattern, trailing '---' trimmed."""
    for head, s, e in secs:
        if re.match(pattern, head):
            return "\n".join(lines[s:e]).rstrip().removesuffix("---").rstrip()
    return ""


def rulings(rules_text: str, ids: list[str]) -> str:
    """The bullet (with its indented continuation) of each ruling id named by the task."""
    out, keep = [], False
    for line in rules_text.splitlines():
        m = re.match(r"- \*\*(R\d+)\b", line)
        if m:
            keep = m.group(1) in ids
        elif not line.startswith("  "):
            keep = False
        if keep:
            out.append(line)
    return "\n".join(out)


def main() -> int:
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    plan, task = Path(args[0]), args[1]
    lines = plan.read_text(encoding="utf-8").splitlines()
    secs = sections(lines)
    body = block(lines, secs, rf"### Task {re.escape(task)}:")
    if not body:
        print(f"no '### Task {task}:' section in {plan}", file=sys.stderr)
        return 1
    ids = sorted(set(re.findall(r"\bR\d+\b", body)), key=lambda r: int(r[1:]))
    rules = rulings(block(lines, secs, r"## Rulings"), ids)
    parts = [
        f"# Brief: {plan.stem}, Task {task}",
        f"Source: `{plan}` (do not open it; everything you need is here).",
        block(lines, secs, r"## Global Constraints"),
        f"## Rulings this task names\n\n{rules}" if rules else "",
        body,
        "## Do not touch\n\n- (orchestrator: files and behaviour that must stay as they are, and why)",
        "## Context pack (read only these; use Read with offset/limit)\n\n- (orchestrator: `path:start-end` + what to look for)",
        "## Report (10 lines max)\n\nFiles changed; `check.sh` result line; each difference from this brief with its reason.",
    ]
    out = (
        Path(args[args.index("--out") + 1])
        if "--out" in args
        else Path(".superpowers/sdd", plan.stem, "briefs", f"task-{task}.md")
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n\n".join(p for p in parts if p) + "\n", encoding="utf-8")
    print(f"{out} ({out.stat().st_size} bytes, plan is {plan.stat().st_size})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
