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

# Metadata for V7 nodes: inputs from RAGState, outputs to RAGState,
# routing logic (conditional edges). Used to populate the detail panel.
NODE_METADATA: dict[str, dict] = {
    "START": {
        "kind": "entry",
        "description": "Точка входа в граф.",
        "inputs": [],
        "outputs": ["query"],
        "routing": {},
    },
    "intent_gate": {
        "kind": "gate",
        "description": "Два шага: (1) regex noise check без LLM — приветствия, прощания, small talk; (2) domain gate — cosine similarity query embedding к corpus centroid, threshold=0.25. Возвращает intent в RAGState.",
        "inputs": ["query"],
        "outputs": ["intent"],
        "output_values": {
            "intent": [
                {
                    "value": '"noise"',
                    "desc": "шум (приветствие, small talk, OOS) → END. Без LLM-вызова.",
                },
                {"value": '"domain"', "desc": "нормальный запрос → router"},
            ]
        },
        "routing": {
            "END": "intent == 'noise' (regex совпал или cosine_sim < 0.25)",
            "router": "intent == 'domain'",
        },
        "logic_steps": [
            {
                "step": "1. Regex noise",
                "detail": "Если запрос — приветствие/прощание/meta-вопрос (≤6 слов) → noise. Без эмбеддингов, ~0мс.",
            },
            {
                "step": "2. Domain gate",
                "detail": "embed(query) → cosine_sim к corpus centroid. Если < DOMAIN_GATE_THRESHOLD (0.25) → noise. Активно только если threshold > 0.",
            },
        ],
    },
    "router": {
        "kind": "gate",
        "description": "Определяет тип запроса: требует уточнения или можно идти в retrieval. Применяет глоссарий и расширяет active_query.",
        "inputs": ["query", "intent"],
        "outputs": ["active_query", "router_decision"],
        "routing": {
            "clarify_respond": "запрос неоднозначен / нужно уточнение",
            "rag_simple": "запрос понятен → retrieval",
        },
    },
    "clarify_respond": {
        "kind": "utility",
        "description": "Генерирует уточняющий вопрос и завершает сессию.",
        "inputs": ["active_query"],
        "outputs": ["answer"],
        "routing": {"END": "всегда"},
    },
    "rag_simple": {
        "kind": "retrieval",
        "description": "Гибридный retrieval (BM25 + semantic, RRF fusion). FlashRank rerank. Возвращает top-K passages.",
        "inputs": ["active_query"],
        "outputs": ["passages", "top_score"],
        "routing": {},
    },
    "evaluate_triage": {
        "kind": "eval",
        "description": "3-way sufficiency gate. Измеряет top_score, keyword_overlap и crossref density. Результат: sufficient / borderline / insufficient.",
        "inputs": ["passages", "active_query", "top_score"],
        "outputs": ["sufficient", "sufficiency_details", "final_passages"],
        "routing": {
            "visual_enrichment": "sufficient == True (и нет enum/crossref эскалации)",
            "llm_verifier": "borderline: top_score 0.38–0.50, слабый overlap",
            "rag_complex": "insufficient: top_score < 0.38, или crossref >= 3, или zero keyword overlap, или enumeration query",
        },
        "triage_viz": {
            "thresholds": [
                {"value": 0.38, "label": "TRIAGE_SOFT", "color": "#f59e0b"},
                {"value": 0.50, "label": "HARD_GATE", "color": "#22c55e"},
            ],
            "zones": [
                {
                    "from": 0.0,
                    "to": 0.38,
                    "label": "insufficient → rag_complex",
                    "color": "#7f1d1d",
                },
                {
                    "from": 0.38,
                    "to": 0.50,
                    "label": "borderline → llm_verifier",
                    "color": "#78350f",
                },
                {
                    "from": 0.50,
                    "to": 1.0,
                    "label": "sufficient → visual_enrichment",
                    "color": "#14532d",
                },
            ],
            "escalations": [
                {
                    "name": "crossref >= 3",
                    "condition": "≥3 ссылок на другие пункты в топ-5 чанках",
                    "to": "rag_complex",
                },
                {
                    "name": "zero keyword overlap",
                    "condition": "ни одно ключевое слово оригинального запроса не встречается в passages",
                    "to": "rag_complex",
                },
                {
                    "name": "enumeration intent",
                    "condition": "запрос «кто проходит / какие категории / перечислите...»",
                    "to": "rag_complex",
                },
            ],
        },
    },
    "llm_verifier": {
        "kind": "eval",
        "description": "LLM-верификатор: проверяет достаточность passages через LLM. Может переписать запрос или эскалировать в complex path.",
        "inputs": ["passages", "active_query"],
        "outputs": ["verifier_verdict"],
        "routing": {
            "visual_enrichment": "passages достаточны",
            "rewriter": "нужна перефразировка запроса",
            "rag_complex": "passages явно недостаточны",
        },
    },
    "rewriter": {
        "kind": "utility",
        "description": "Перефразирует запрос (query expansion). После переписывания возвращается в rag_simple.",
        "inputs": ["active_query", "verifier_verdict"],
        "outputs": ["active_query"],
        "routing": {"rag_simple": "всегда"},
    },
    "rag_complex": {
        "kind": "retrieval",
        "description": "Расширенный retrieval: multi-query expansion + cross-reference expansion + MMR diversification.",
        "inputs": ["active_query"],
        "outputs": ["passages", "top_score"],
        "routing": {},
    },
    "evaluate_complex": {
        "kind": "eval",
        "description": "Оценивает результаты complex retrieval. Если passages слабые — abstain; иначе → generate.",
        "inputs": ["passages", "active_query", "top_score"],
        "outputs": ["eval_complex_result"],
        "routing": {
            "visual_enrichment": "passages достаточного качества",
            "abstain": "quality < hard_gate_threshold",
        },
    },
    "visual_enrichment": {
        "kind": "utility",
        "description": "Опционально прикрепляет визуальные доказательства (графики, таблицы из PDF) к passages.",
        "inputs": ["passages"],
        "outputs": ["passages"],
        "routing": {"generate_answer": "всегда"},
    },
    "generate_answer": {
        "kind": "generate",
        "description": "Генерирует финальный ответ через Gemini. Простой путь: Gemini 2.5 Flash. Сложный: Gemini 3 Flash + thinking_budget=4096.",
        "inputs": ["passages", "active_query"],
        "outputs": ["answer"],
        "routing": {"END": "всегда"},
    },
    "abstain": {
        "kind": "gate",
        "description": "Возвращает стандартный ответ 'недостаточно данных'. Срабатывает когда ни simple, ни complex path не дали качественный результат.",
        "inputs": ["eval_complex_result"],
        "outputs": ["answer"],
        "routing": {"END": "всегда"},
    },
    "END": {
        "kind": "entry",
        "description": "Конечная точка графа.",
        "inputs": ["answer"],
        "outputs": [],
        "routing": {},
    },
}

# Color per node kind (used in app.js)
NODE_KIND_COLORS: dict[str, str] = {
    "entry": "#334155",
    "gate": "#854d0e",
    "retrieval": "#1e3a5f",
    "eval": "#4a1d96",
    "generate": "#14532d",
    "utility": "#1e3a5f",
}

INDEXING_STEPS: list[dict] = [
    {
        "id": "source_docs",
        "label": "source_docs/",
        "icon": "📄",
        "description": "11 PDF-документов: Приказ 2464, ТК РФ, Приказы 29н/782н/817н/776н/223н, ПП 1479, 426-ФЗ, ФЗ «О пожарной безопасности», ст. 5.27.1 КоАП.",
        "file": None,
        "params": ["~12 MB", "11 файлов"],
    },
    {
        "id": "docling",
        "label": "Docling",
        "icon": "🔬",
        "description": "Парсит PDF с сохранением структуры: bbox координаты, заголовки разделов, таблицы, нумерация пунктов. Лучше pdfminer для нормативных документов — понимает структуру НПА.",
        "file": "src/indexing/file_handler.py",
        "params": ["HybridChunker", "max_tokens=400", "merge_peers=True"],
    },
    {
        "id": "chunker",
        "label": "HybridChunker v3.0",
        "icon": "✂️",
        "description": "Структурные чанки по заголовкам/пунктам НПА. Не режет по символам — следует логическим границам документа. Каждый чанк ≤400 токенов, содержит heading_path.",
        "file": "src/indexing/file_handler.py",
        "params": ["v3.0-hybrid", "heading_path", "~1069 чанков"],
    },
    {
        "id": "normalize",
        "label": "Normalize",
        "icon": "🧹",
        "description": "NFC unicode-нормализация кириллицы. Regex cleanup: удаляет watermarks (https://...), page markers (14/34), timestamps (25.01.2026). Убирает мусорные чанки (-93 чанка).",
        "file": "src/indexing/file_handler.py",
        "params": ["NFC unicode", "regex noise", "v2.3-noise-clean"],
    },
    {
        "id": "embeddings",
        "label": "OpenAI Embeddings",
        "icon": "🧮",
        "description": "text-embedding-ada-002 (или аналог). Каждый чанк → вектор 1536d. Хранится в ChromaDB с метаданными: source, heading_path, chunk_id.",
        "file": "src/indexing/chroma_helpers.py",
        "params": ["1536d vectors", "cosine similarity"],
    },
    {
        "id": "chromadb",
        "label": "ChromaDB",
        "icon": "🗄️",
        "description": "Персистентное векторное хранилище (chroma_db/). Поиск через cosine similarity, top-K. Используется как semantic retrieval в rag_simple и rag_complex.",
        "file": "src/backends/chroma_backend.py",
        "params": ["persistent", "chroma_db/", "~1069 чанков"],
    },
    {
        "id": "bm25",
        "label": "BM25 Cache",
        "icon": "🔤",
        "description": "rank_bm25 индекс по тексту всех чанков. Персистируется в .bm25_cache.pkl. Используется для keyword retrieval в гибридном поиске (BM25 + semantic → RRF fusion).",
        "file": "src/indexing/vector_store.py",
        "params": [".bm25_cache.pkl", "RRF fusion"],
    },
    {
        "id": "ready",
        "label": "Ready ✓",
        "icon": "🚀",
        "description": "Индекс готов. V7 pipeline использует ChromaDB (semantic) + BM25 (keyword) в гибридном retrieval. Переиндексация: python index.py (DESTRUCTIVE — удаляет старый индекс).",
        "file": "index.py",
        "params": ["port 8502", "tmux sia"],
    },
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
