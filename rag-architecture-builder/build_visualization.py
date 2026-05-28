"""Build the architecture visualization for regulatory-rag and deploy to knowledge_pages.

Reads source code from the regulatory-rag repo, generates a static HTML
visualization (V7 graph + module panels), and optionally publishes it to
GitHub Pages via the knowledge_pages repo.

Usage:
    python build_visualization.py                       # build to ./build/viz
    python build_visualization.py --deploy              # build + push to gh-pages
    python build_visualization.py --repo /path/to/rag   # custom repo location
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from viz.render import render_site  # noqa: E402

DEFAULT_REPO = Path.home() / "projects" / "ai" / "regulatory-rag"
KNOWLEDGE_PAGES_ROOT = Path.home() / "knowledge_pages"
DEPLOY_DIR = KNOWLEDGE_PAGES_ROOT / "rag-architecture"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo",
        type=Path,
        default=DEFAULT_REPO,
        help=f"Path to regulatory-rag repo (default: {DEFAULT_REPO})",
    )
    parser.add_argument(
        "--deploy",
        action="store_true",
        help="Build into ~/knowledge_pages/rag-architecture and git push",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=HERE / "build" / "viz",
        help="Output dir (ignored when --deploy)",
    )
    args = parser.parse_args()

    repo_root = args.repo.resolve()
    if not (repo_root / "src" / "v7" / "graph.py").exists():
        sys.exit(f"src/v7/graph.py not found under {repo_root}")

    out_dir = DEPLOY_DIR if args.deploy else args.out
    render_site(repo_root, out_dir)
    print(f"Built: {out_dir / 'index.html'}")

    if args.deploy:
        subprocess.run(
            ["git", "add", "rag-architecture"],
            cwd=KNOWLEDGE_PAGES_ROOT,
            check=True,
        )
        diff = subprocess.run(
            ["git", "diff", "--cached", "--quiet"],
            cwd=KNOWLEDGE_PAGES_ROOT,
            check=False,
        )
        if diff.returncode == 0:
            print("Nothing to commit — skipping push.")
            return
        subprocess.run(
            ["git", "commit", "-m", "docs: rebuild rag-architecture viz"],
            cwd=KNOWLEDGE_PAGES_ROOT,
            check=True,
        )
        subprocess.run(["git", "push"], cwd=KNOWLEDGE_PAGES_ROOT, check=True)
        print("Deployed: https://spqr-86.github.io/knowledge_pages/rag-architecture/")


if __name__ == "__main__":
    main()
