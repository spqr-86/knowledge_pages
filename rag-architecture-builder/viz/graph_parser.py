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
        elif isinstance(stmt, ast.AnnAssign) and _is_nodes_ann_dict(stmt):
            nodes = _extract_nodes(stmt.value)
        elif isinstance(stmt, ast.Call):
            edges.extend(_extract_edges_from_call(stmt))

    if any(e["source"] == "START" for e in edges):
        nodes.insert(0, {"id": "START", "label": "START"})
    if any(e["target"] == "END" for e in edges):
        nodes.append({"id": "END", "label": "END"})

    return {"nodes": nodes, "edges": edges}


def _find_function(tree: ast.Module, name: str) -> ast.FunctionDef:
    for node in ast.walk(tree):
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


def _is_nodes_ann_dict(stmt: ast.AnnAssign) -> bool:
    return (
        isinstance(stmt.target, ast.Name)
        and stmt.target.id == "nodes"
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
    if fn.attr == "add_edge" and len(call.args) >= 2:
        src = _const_str(call.args[0])
        tgt = _const_str(call.args[1])
        if src and tgt:
            return [{"source": src, "target": tgt, "kind": "edge"}]
    if fn.attr == "add_conditional_edges" and len(call.args) >= 1:
        src = _const_str(call.args[0])
        if len(call.args) >= 3 and isinstance(call.args[2], ast.Dict):
            out = []
            for v in call.args[2].values:
                tgt = _const_str(v)
                if src and tgt:
                    out.append({"source": src, "target": tgt, "kind": "conditional"})
            return out
    if fn.attr == "set_entry_point" and len(call.args) >= 1:
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
