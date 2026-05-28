from pathlib import Path

from scripts.viz.graph_parser import parse_graph
from scripts.viz.module_walker import MODULES, walk_module


def test_parse_graph_extracts_v7_nodes_and_edges():
    result = parse_graph(Path("src/v7/graph.py"))
    node_names = {n["id"] for n in result["nodes"]}
    assert "intent_gate" in node_names
    assert "rag_simple" in node_names
    assert "evaluate_triage" in node_names
    assert "generate_answer" in node_names
    assert len(result["nodes"]) >= 12

    assert {
        "source": "rag_simple",
        "target": "evaluate_triage",
        "kind": "edge",
    } in result["edges"]
    cond_targets = {
        e["target"] for e in result["edges"] if e["source"] == "evaluate_triage"
    }
    assert {"visual_enrichment", "llm_verifier", "rag_complex"} <= cond_targets


def test_walk_module_extracts_functions_with_line_ranges():
    repo_root = Path(".").resolve()
    files = walk_module(Path("src/v7/nodes"), repo_root)
    rag_simple = next(f for f in files if f["path"].endswith("rag_simple.py"))
    assert not rag_simple["path"].startswith("/")
    assert rag_simple["path"].startswith("src/")
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
