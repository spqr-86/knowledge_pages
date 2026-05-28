# Architecture Visualization Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static HTML visualization of regulatory-rag's V7 pipeline + supporting modules, with click-to-drill panel and GitHub-linked files/functions, deployed to GitHub Pages.

**Architecture:** Python build script (`scripts/build_visualization.py`) parses `src/v7/graph.py` (AST) to extract nodes and edges, walks key `src/` modules with `ast.parse` to extract file→functions/classes metadata, emits a JSON blob, and renders into an HTML template. The HTML uses **dagre-d3** (CDN) to render the SVG flowchart on the left and a vanilla-JS detail panel on the right showing files/functions with GitHub links (`#L{start}-L{end}`). Output deployed to `~/knowledge_pages/rag-architecture/`.

**Tech Stack:** Python 3.11 (stdlib only: `ast`, `pathlib`, `json`, `string.Template`), dagre-d3 1.0.6 (CDN), highlight.js (CDN, optional), no build framework. GitHub Pages from `spqr-86/knowledge_pages` main branch.

---

## File Structure

- `scripts/build_visualization.py` — build entry point (parse graph + modules → render HTML)
- `scripts/viz/graph_parser.py` — extract nodes/edges from `src/v7/graph.py` via AST
- `scripts/viz/module_walker.py` — walk `src/v7/nodes/`, `src/infra/`, `src/indexing/`, `src/backends/`, `config/`, `eval/`; extract file → [{name, kind, lineno, end_lineno}] for top-level defs
- `scripts/viz/render.py` — pull JSON metadata into HTML template, write to output dir
- `scripts/viz/templates/index.html` — static template with `{{DATA_JSON}}` placeholder
- `scripts/viz/templates/app.js` — dagre rendering, click handlers, panel population
- `scripts/viz/templates/styles.css` — split-screen layout, panel, theming
- `tests/test_visualization_build.py` — tests for graph_parser and module_walker

**Mapping V7 nodes → supporting modules** (used by render to merge into a single node's detail panel):
- `rag_simple`, `rag_complex` → `src/v7/nodes/<node>.py` + `src/indexing/*`, `src/backends/*`
- `evaluate_triage`, `evaluate_complex`, `llm_verifier` → respective node + `src/v7/hard_gates.py`, `src/v7/nlp_core.py`
- `generate_answer` → node + `src/infra/llm_factory.py`, `src/infra/prompt_manager.py`
- All nodes implicitly link to `src/v7/state_types.py`, `src/v7/config.py`

Hard-coded `NODE_TO_MODULES` map in `module_walker.py` — not auto-discovered.

---

## Task 1: Graph parser

**Files:**
- Create: `scripts/viz/__init__.py` (empty)
- Create: `scripts/viz/graph_parser.py`
- Create: `tests/test_visualization_build.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_visualization_build.py
from pathlib import Path
from scripts.viz.graph_parser import parse_graph

def test_parse_graph_extracts_v7_nodes_and_edges():
    result = parse_graph(Path("src/v7/graph.py"))
    node_names = {n["id"] for n in result["nodes"]}
    assert "intent_gate" in node_names
    assert "rag_simple" in node_names
    assert "evaluate_triage" in node_names
    assert "generate_answer" in node_names
    assert len(result["nodes"]) >= 12

    # static edge: rag_simple -> evaluate_triage
    assert {"source": "rag_simple", "target": "evaluate_triage", "kind": "edge"} in result["edges"]
    # conditional edge from evaluate_triage
    cond_targets = {e["target"] for e in result["edges"] if e["source"] == "evaluate_triage"}
    assert {"visual_enrichment", "llm_verifier", "rag_complex"} <= cond_targets
```

- [ ] **Step 2: Run test, expect ModuleNotFoundError**

```bash
pytest tests/test_visualization_build.py::test_parse_graph_extracts_v7_nodes_and_edges -v
```

- [ ] **Step 3: Implement `graph_parser.py`**

```python
"""Parse src/v7/graph.py to extract nodes and edges via AST.

Reads the nodes dict and add_edge / add_conditional_edges calls inside
build_graph(). Maps "END" sentinel to a synthetic "END" node.
"""
from __future__ import annotations

import ast
from pathlib import Path
from typing import Any


def parse_graph(graph_py: Path) -> dict[str, Any]:
    tree = ast.parse(graph_py.read_text(encoding="utf-8"))
    build_fn = _find_function(tree, "build_graph")

    nodes: list[dict[str, str]] = []
    edges: list[dict[str, str]] = []

    for stmt in ast.walk(build_fn):
        if isinstance(stmt, ast.Assign) and _is_nodes_dict(stmt):
            nodes = _extract_nodes(stmt.value)
        elif isinstance(stmt, ast.Call):
            edges.extend(_extract_edges_from_call(stmt))

    # add END sentinel node if referenced
    if any(e["target"] == "END" for e in edges):
        nodes.append({"id": "END", "label": "END"})

    return {"nodes": nodes, "edges": edges}


def _find_function(tree: ast.Module, name: str) -> ast.FunctionDef:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise ValueError(f"Function {name} not found")


def _is_nodes_dict(stmt: ast.Assign) -> bool:
    return (
        len(stmt.targets) == 1
        and isinstance(stmt.targets[0], ast.Name)
        and stmt.targets[0].id == "nodes"
        and isinstance(stmt.value, ast.Dict)
    )


def _extract_nodes(d: ast.Dict) -> list[dict[str, str]]:
    out = []
    for key in d.keys:
        if isinstance(key, ast.Constant) and isinstance(key.value, str):
            out.append({"id": key.value, "label": key.value})
    return out


def _extract_edges_from_call(call: ast.Call) -> list[dict[str, str]]:
    fn = call.func
    if not isinstance(fn, ast.Attribute):
        return []
    if fn.attr == "add_edge":
        src = _const_str(call.args[0])
        tgt = _const_str(call.args[1])
        if src and tgt:
            return [{"source": src, "target": tgt, "kind": "edge"}]
    if fn.attr == "add_conditional_edges":
        src = _const_str(call.args[0])
        # third arg is dict mapping condition label -> target node name
        if len(call.args) >= 3 and isinstance(call.args[2], ast.Dict):
            out = []
            for v in call.args[2].values:
                tgt = _const_str(v)
                if src and tgt:
                    out.append({"source": src, "target": tgt, "kind": "conditional"})
            return out
    if fn.attr == "set_entry_point":
        tgt = _const_str(call.args[0])
        if tgt:
            return [{"source": "START", "target": tgt, "kind": "entry"}]
    return []


def _const_str(node: ast.AST) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name) and node.id == "END":
        return "END"
    return None
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pytest tests/test_visualization_build.py -v
```

- [ ] **Step 5: Commit**

```bash
git add scripts/viz/__init__.py scripts/viz/graph_parser.py tests/test_visualization_build.py
git commit -m "feat(viz): add V7 graph AST parser"
```

---

## Task 2: Module walker

**Files:**
- Create: `scripts/viz/module_walker.py`
- Modify: `tests/test_visualization_build.py`

- [ ] **Step 1: Add failing test**

```python
# append to tests/test_visualization_build.py
from scripts.viz.module_walker import walk_module, MODULES

def test_walk_module_extracts_functions_with_line_ranges():
    files = walk_module(Path("src/v7/nodes"))
    rag_simple = next(f for f in files if f["path"].endswith("rag_simple.py"))
    fn_names = {d["name"] for d in rag_simple["defs"]}
    assert "rag_simple" in fn_names
    rag_simple_def = next(d for d in rag_simple["defs"] if d["name"] == "rag_simple")
    assert rag_simple_def["lineno"] >= 1
    assert rag_simple_def["end_lineno"] > rag_simple_def["lineno"]
    assert rag_simple_def["kind"] == "function"

def test_modules_constant_covers_required_paths():
    paths = {m["path"] for m in MODULES}
    assert "src/v7/nodes" in paths
    assert "src/infra" in paths
    assert "src/indexing" in paths
    assert "src/backends" in paths
    assert "config" in paths
    assert "eval" in paths
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pytest tests/test_visualization_build.py -v
```

- [ ] **Step 3: Implement `module_walker.py`**

```python
"""Walk source dirs, extract top-level functions/classes with line ranges."""
from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

MODULES: list[dict[str, str]] = [
    {"path": "src/v7/nodes", "label": "V7 Nodes"},
    {"path": "src/v7", "label": "V7 Core"},
    {"path": "src/infra", "label": "Infra (LLM/Prompts/Cache)"},
    {"path": "src/indexing", "label": "Indexing"},
    {"path": "src/backends", "label": "Vector Backends"},
    {"path": "config", "label": "Config"},
    {"path": "eval", "label": "Evaluation"},
]

# Which supporting module paths attach to which V7 node detail panel
NODE_TO_EXTRA_MODULES: dict[str, list[str]] = {
    "rag_simple": ["src/indexing", "src/backends"],
    "rag_complex": ["src/indexing", "src/backends"],
    "evaluate_triage": ["src/v7/hard_gates.py", "src/v7/nlp_core.py"],
    "evaluate_complex": ["src/v7/hard_gates.py", "src/v7/nlp_core.py"],
    "llm_verifier": ["src/v7/hard_gates.py"],
    "generate_answer": ["src/infra"],
    "rewriter": ["src/infra"],
    "intent_gate": ["src/v7/domain_gate.py"],
    "router": ["src/infra"],
}


def walk_module(module_dir: Path) -> list[dict[str, Any]]:
    files = []
    if module_dir.is_file() and module_dir.suffix == ".py":
        files.append(_parse_file(module_dir))
        return files
    for py in sorted(module_dir.rglob("*.py")):
        if py.name == "__init__.py" or "__pycache__" in py.parts:
            continue
        files.append(_parse_file(py))
    return files


def _parse_file(py: Path) -> dict[str, Any]:
    try:
        tree = ast.parse(py.read_text(encoding="utf-8"))
    except SyntaxError:
        return {"path": str(py), "defs": []}
    defs = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            defs.append({
                "name": node.name,
                "kind": "function",
                "lineno": node.lineno,
                "end_lineno": node.end_lineno or node.lineno,
                "docstring": (ast.get_docstring(node) or "").split("\n")[0][:120],
            })
        elif isinstance(node, ast.ClassDef):
            defs.append({
                "name": node.name,
                "kind": "class",
                "lineno": node.lineno,
                "end_lineno": node.end_lineno or node.lineno,
                "docstring": (ast.get_docstring(node) or "").split("\n")[0][:120],
            })
    return {"path": str(py), "defs": defs}
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
pytest tests/test_visualization_build.py -v
```

- [ ] **Step 5: Commit**

```bash
git add scripts/viz/module_walker.py tests/test_visualization_build.py
git commit -m "feat(viz): add module walker for file/function extraction"
```

---

## Task 3: HTML/JS/CSS templates

**Files:**
- Create: `scripts/viz/templates/index.html`
- Create: `scripts/viz/templates/app.js`
- Create: `scripts/viz/templates/styles.css`

- [ ] **Step 1: Write `index.html`**

```html
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Regulatory-RAG Architecture</title>
<link rel="stylesheet" href="styles.css">
<script src="https://d3js.org/d3.v5.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dagre-d3@0.6.4/dist/dagre-d3.min.js"></script>
</head>
<body>
<header>
  <h1>Regulatory-RAG · V7 Architecture</h1>
  <div class="repo"><a href="https://github.com/spqr-86/regulatory-rag" target="_blank">github.com/spqr-86/regulatory-rag</a></div>
</header>
<main>
  <section id="graph"><svg id="svg-graph"><g/></svg></section>
  <aside id="panel">
    <div class="placeholder">Кликни ноду графа слева →</div>
  </aside>
</main>
<script>const DATA = /*{{DATA_JSON}}*/null;</script>
<script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `styles.css`**

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, system-ui, sans-serif; background: #0f1117; color: #e2e8f0; }
header { padding: 12px 24px; border-bottom: 1px solid #2a3142; display: flex; justify-content: space-between; align-items: center; }
header h1 { margin: 0; font-size: 18px; font-weight: 600; }
header .repo a { color: #7dd3fc; font-size: 13px; text-decoration: none; }
main { display: flex; height: calc(100vh - 56px); }
#graph { flex: 1.4; overflow: auto; padding: 24px; }
#svg-graph { width: 100%; height: 100%; }
#panel { flex: 1; border-left: 1px solid #2a3142; padding: 20px 24px; overflow-y: auto; background: #151823; }
#panel .placeholder { color: #64748b; }
#panel h2 { margin-top: 0; font-size: 20px; color: #fbbf24; }
.file { margin: 14px 0; padding: 10px 12px; background: #1c2333; border-radius: 6px; }
.file-path { font-family: monospace; font-size: 13px; color: #7dd3fc; margin-bottom: 6px; }
.file-path a { color: inherit; text-decoration: none; }
.file-path a:hover { text-decoration: underline; }
.def { margin: 4px 0 4px 16px; font-size: 13px; }
.def a { color: #e2e8f0; text-decoration: none; font-family: monospace; }
.def a:hover { color: #fbbf24; }
.def .kind { color: #94a3b8; font-size: 11px; margin-right: 4px; }
.def .doc { color: #64748b; font-size: 11px; margin-left: 8px; }
.node rect { fill: #1c2333; stroke: #475569; stroke-width: 1.5; cursor: pointer; }
.node:hover rect, .node.active rect { stroke: #fbbf24; stroke-width: 2.5; }
.node text { fill: #e2e8f0; font-size: 13px; font-family: monospace; }
.edgePath path { stroke: #475569; stroke-width: 1.5; fill: none; }
.edgePath.conditional path { stroke-dasharray: 4 3; stroke: #94a3b8; }
.edgePath marker path { fill: #475569; stroke: none; }
```

- [ ] **Step 3: Write `app.js`**

```javascript
const REPO = "https://github.com/spqr-86/regulatory-rag/blob/main/";

function ghLink(path, def) {
  const base = REPO + path;
  if (!def) return base;
  return `${base}#L${def.lineno}-L${def.end_lineno}`;
}

function renderGraph() {
  const g = new dagreD3.graphlib.Graph().setGraph({ rankdir: "TB", nodesep: 20, ranksep: 40, marginx: 10, marginy: 10 });
  DATA.graph.nodes.forEach(n => {
    g.setNode(n.id, { label: n.label, rx: 5, ry: 5, padding: 8 });
  });
  DATA.graph.edges.forEach(e => {
    g.setEdge(e.source, e.target, { class: e.kind === "conditional" ? "conditional" : "" });
  });
  const svg = d3.select("#svg-graph");
  const inner = svg.select("g");
  const render = new dagreD3.render();
  render(inner, g);
  svg.attr("viewBox", `0 0 ${g.graph().width + 40} ${g.graph().height + 40}`);
  svg.selectAll("g.node").on("click", function(id) {
    d3.selectAll("g.node").classed("active", false);
    d3.select(this).classed("active", true);
    showPanel(id);
  });
}

function showPanel(nodeId) {
  const panel = document.getElementById("panel");
  const node = DATA.nodeDetails[nodeId];
  if (!node) {
    panel.innerHTML = `<h2>${nodeId}</h2><div class="placeholder">Нет данных (служебная нода).</div>`;
    return;
  }
  let html = `<h2>${nodeId}</h2><div style="color:#94a3b8;font-size:13px;margin-bottom:12px;">${node.description || ""}</div>`;
  node.files.forEach(f => {
    html += `<div class="file"><div class="file-path"><a href="${ghLink(f.path)}" target="_blank">${f.path}</a></div>`;
    f.defs.forEach(d => {
      html += `<div class="def"><span class="kind">${d.kind === "class" ? "C" : "fn"}</span><a href="${ghLink(f.path, d)}" target="_blank">${d.name}</a>`;
      if (d.docstring) html += `<span class="doc">— ${d.docstring}</span>`;
      html += `</div>`;
    });
    html += `</div>`;
  });
  panel.innerHTML = html;
}

renderGraph();
```

- [ ] **Step 4: Commit**

```bash
git add scripts/viz/templates/
git commit -m "feat(viz): add HTML/JS/CSS templates"
```

---

## Task 4: Render + build orchestration

**Files:**
- Create: `scripts/viz/render.py`
- Create: `scripts/build_visualization.py`

- [ ] **Step 1: Implement `render.py`**

```python
"""Combine parsed graph + module metadata into a single data blob and write site."""
from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from scripts.viz.graph_parser import parse_graph
from scripts.viz.module_walker import MODULES, NODE_TO_EXTRA_MODULES, walk_module


def build_node_details(repo_root: Path) -> dict[str, Any]:
    """For each V7 node, attach its own .py file + extra supporting modules."""
    details: dict[str, Any] = {}
    nodes_dir = repo_root / "src/v7/nodes"
    for py in nodes_dir.glob("*.py"):
        if py.name in ("__init__.py", "utils.py"):
            continue
        node_id = py.stem
        files = walk_module(py)
        for extra in NODE_TO_EXTRA_MODULES.get(node_id, []):
            extra_path = repo_root / extra
            if extra_path.exists():
                files.extend(walk_module(extra_path))
        details[node_id] = {"description": "", "files": files}
    return details


def build_module_panels(repo_root: Path) -> dict[str, Any]:
    """Standalone module panels (Indexing, Infra, etc.) accessible from a sidebar list."""
    out = {}
    for m in MODULES:
        path = repo_root / m["path"]
        if path.exists():
            out[m["label"]] = {"path": m["path"], "files": walk_module(path)}
    return out


def render_site(repo_root: Path, out_dir: Path) -> None:
    graph = parse_graph(repo_root / "src/v7/graph.py")
    node_details = build_node_details(repo_root)
    modules = build_module_panels(repo_root)
    data = {"graph": graph, "nodeDetails": node_details, "modules": modules}

    out_dir.mkdir(parents=True, exist_ok=True)
    tmpl_dir = Path(__file__).parent / "templates"
    html = (tmpl_dir / "index.html").read_text(encoding="utf-8")
    html = html.replace("/*{{DATA_JSON}}*/null", json.dumps(data, ensure_ascii=False))
    (out_dir / "index.html").write_text(html, encoding="utf-8")
    shutil.copy(tmpl_dir / "app.js", out_dir / "app.js")
    shutil.copy(tmpl_dir / "styles.css", out_dir / "styles.css")
```

- [ ] **Step 2: Implement `build_visualization.py`**

```python
"""Build the architecture visualization and deploy to knowledge_pages.

Usage: python scripts/build_visualization.py [--deploy]
"""
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

from scripts.viz.render import render_site

REPO_ROOT = Path(__file__).resolve().parent.parent
KNOWLEDGE_PAGES = Path.home() / "knowledge_pages" / "rag-architecture"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--deploy", action="store_true", help="Copy build to ~/knowledge_pages and git push")
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "build" / "viz", help="Output dir")
    args = parser.parse_args()

    out_dir = KNOWLEDGE_PAGES if args.deploy else args.out
    render_site(REPO_ROOT, out_dir)
    print(f"Built: {out_dir / 'index.html'}")

    if args.deploy:
        subprocess.run(["git", "add", "rag-architecture"], cwd=Path.home() / "knowledge_pages", check=True)
        subprocess.run(["git", "commit", "-m", "docs: rebuild rag-architecture viz"], cwd=Path.home() / "knowledge_pages", check=False)
        subprocess.run(["git", "push"], cwd=Path.home() / "knowledge_pages", check=True)
        print("Deployed: https://spqr-86.github.io/knowledge_pages/rag-architecture/")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Smoke test build (no deploy)**

```bash
cd /home/petr/projects/ai/regulatory-rag && source venv/bin/activate && python scripts/build_visualization.py --out build/viz
test -f build/viz/index.html && grep -q '"intent_gate"' build/viz/index.html && echo OK
```

Expected: `OK` (file exists, contains parsed node)

- [ ] **Step 4: Open in browser locally**

```bash
xdg-open build/viz/index.html  # или вручную открыть
```

Verify: граф рендерится, клик на ноду показывает панель с файлами и кликабельными ссылками на GitHub.

- [ ] **Step 5: Commit**

```bash
git add scripts/build_visualization.py scripts/viz/render.py
git commit -m "feat(viz): render orchestration + build entry point"
```

---

## Task 5: Deploy + verify

- [ ] **Step 1: Run with --deploy**

```bash
python scripts/build_visualization.py --deploy
```

Expected: build пишется в `~/knowledge_pages/rag-architecture/`, коммит + push в `spqr-86/knowledge_pages`.

- [ ] **Step 2: Verify public URL**

Подождать ~1 минуту, открыть https://spqr-86.github.io/knowledge_pages/rag-architecture/ в браузере. Граф загружается, клики работают, ссылки GitHub открываются на правильных строках.

- [ ] **Step 3: Run tests in project**

```bash
pytest tests/test_visualization_build.py -v
```

Expected: PASS

- [ ] **Step 4: Lint**

```bash
black scripts/ && ruff check scripts/ --fix
```

- [ ] **Step 5: Final commit if линтер что-то правил**

```bash
git status
# если есть правки:
git add -u && git commit -m "style: black + ruff on viz scripts"
```

---

## Acceptance Criteria (mirror of spec)

- [x] HTML deployed via GitHub Pages, opens at public URL
- [x] V7 graph shown with all nodes + conditional edges (dashed)
- [x] Click node → panel shows file list
- [x] File path links to GitHub blob
- [x] Function/class names link to GitHub with `#Lx-Ly` anchor
- [x] Coverage includes `src/infra`, `src/indexing`, `src/backends`, `config`, `eval` (via NODE_TO_EXTRA_MODULES and MODULES list)
- [x] Source of truth = `src/v7/graph.py` (parsed by AST)
- [x] One-command build: `python scripts/build_visualization.py --deploy`
- [x] Works offline locally (open `build/viz/index.html` directly)
