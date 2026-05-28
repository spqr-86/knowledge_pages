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


def walk_module(module_dir: Path, repo_root: Path) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    if module_dir.is_file() and module_dir.suffix == ".py":
        files.append(_parse_file(module_dir, repo_root))
        return files
    for py in sorted(module_dir.rglob("*.py")):
        if py.name == "__init__.py" or "__pycache__" in py.parts:
            continue
        files.append(_parse_file(py, repo_root))
    return files


def _parse_file(py: Path, repo_root: Path) -> dict[str, Any]:
    rel_path = str(py.resolve().relative_to(repo_root.resolve()))
    try:
        tree = ast.parse(py.read_text(encoding="utf-8"))
    except SyntaxError:
        return {"path": rel_path, "defs": []}
    defs = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            defs.append(
                {
                    "name": node.name,
                    "kind": "function",
                    "lineno": node.lineno,
                    "end_lineno": node.end_lineno or node.lineno,
                    "docstring": (ast.get_docstring(node) or "").split("\n")[0][:120],
                }
            )
        elif isinstance(node, ast.ClassDef):
            defs.append(
                {
                    "name": node.name,
                    "kind": "class",
                    "lineno": node.lineno,
                    "end_lineno": node.end_lineno or node.lineno,
                    "docstring": (ast.get_docstring(node) or "").split("\n")[0][:120],
                }
            )
    return {"path": rel_path, "defs": defs}
