"""Combine parsed graph + module metadata into a single data blob and write site."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from viz.graph_parser import parse_graph
from viz.module_walker import (
    INDEXING_STEPS,
    MODULES,
    NODE_KIND_COLORS,
    NODE_METADATA,
    NODE_TO_EXTRA_MODULES,
    walk_module,
)


def build_node_details(repo_root: Path) -> dict[str, Any]:
    """For each V7 node, attach its own .py file + extra supporting modules."""
    details: dict[str, Any] = {}
    nodes_dir = repo_root / "src/v7/nodes"
    for py in nodes_dir.glob("*.py"):
        if py.name in ("__init__.py", "utils.py"):
            continue
        node_id = py.stem
        files = walk_module(py, repo_root)
        for extra in NODE_TO_EXTRA_MODULES.get(node_id, []):
            extra_path = repo_root / extra
            if extra_path.exists():
                files.extend(walk_module(extra_path, repo_root))
        details[node_id] = {"description": "", "files": files}
    return details


def build_module_panels(repo_root: Path) -> dict[str, Any]:
    """Standalone module panels accessible from a sidebar list."""
    out: dict[str, Any] = {}
    for m in MODULES:
        path = repo_root / m["path"]
        if path.exists():
            out[m["label"]] = {"path": m["path"], "files": walk_module(path, repo_root)}
    return out


def render_site(repo_root: Path, out_dir: Path) -> None:
    graph = parse_graph(repo_root / "src/v7/graph.py")
    node_details = build_node_details(repo_root)
    modules = build_module_panels(repo_root)

    # Enrich graph nodes with kind/color from NODE_METADATA
    for n in graph["nodes"]:
        meta = NODE_METADATA.get(n["id"], {})
        n["kind"] = meta.get("kind", "utility")
        n["color"] = NODE_KIND_COLORS.get(n["kind"], "#1e3a5f")

    # Merge NODE_METADATA into nodeDetails
    for node_id, meta in NODE_METADATA.items():
        if node_id not in node_details:
            node_details[node_id] = {"files": []}
        node_details[node_id]["description"] = meta.get("description", "")
        node_details[node_id]["inputs"] = meta.get("inputs", [])
        node_details[node_id]["outputs"] = meta.get("outputs", [])
        node_details[node_id]["routing"] = meta.get("routing", {})
        for extra_key in ("output_values", "logic_steps", "triage_viz"):
            if extra_key in meta:
                node_details[node_id][extra_key] = meta[extra_key]

    data = {
        "graph": graph,
        "nodeDetails": node_details,
        "modules": modules,
        "indexingSteps": INDEXING_STEPS,
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    tmpl_dir = Path(__file__).parent / "templates"
    html = (tmpl_dir / "index.html").read_text(encoding="utf-8")
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    html = html.replace("/*{{DATA_JSON}}*/null", payload)
    (out_dir / "index.html").write_text(html, encoding="utf-8")
    shutil.copy(tmpl_dir / "app.js", out_dir / "app.js")
    shutil.copy(tmpl_dir / "styles.css", out_dir / "styles.css")
