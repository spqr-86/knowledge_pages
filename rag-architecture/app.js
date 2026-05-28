const REPO = "https://github.com/spqr-86/regulatory-rag/blob/main/";

// Each step: { node, snapshot } where snapshot is shown in the panel during simulation.
// snapshot fields: title (что происходит), fields (key-value пары состояния), verdict (итог шага)
const SCENARIOS = {
  simple: {
    label: "Нормативный вопрос (simple path)",
    query: "Как часто проводится повторный инструктаж?",
    steps: [
      { node: "START",            snapshot: { title: "Запрос получен", fields: { query: "«Как часто проводится повторный инструктаж?»" } } },
      { node: "intent_gate",      snapshot: { title: "Проверка намерения", fields: { cosine_sim_to_corpus: "0.71", threshold: "0.25" }, verdict: "✅ domain match → продолжаем" } },
      { node: "router",           snapshot: { title: "Роутинг запроса", fields: { active_query: "«повторный инструктаж периодичность»", glossary_hits: "инструктаж → инструктаж по охране труда" }, verdict: "→ rag_simple" } },
      { node: "rag_simple",       snapshot: { title: "Гибридный retrieval", fields: { semantic_hits: "8", bm25_hits: "3 (guarantee)", total_passages: "12", top_score: "0.82 (vector)" }, verdict: "→ evaluate_triage" } },
      { node: "evaluate_triage",  snapshot: { title: "Оценка quality", fields: { top_score: "0.82", threshold_hard: "0.50", keyword_overlap_original: "0.67", crossref_hits: "1 (< 3)" }, verdict: "✅ sufficient → visual_enrichment" } },
      { node: "visual_enrichment",snapshot: { title: "Визуальное обогащение", fields: { visual_found: "нет (документ без таблиц на этот вопрос)" }, verdict: "→ generate_answer" } },
      { node: "generate_answer",  snapshot: { title: "Генерация ответа", fields: { model: "gemini-2.5-flash", passages_used: "12", thinking_budget: "нет (simple path)" }, verdict: "«Повторный инструктаж проводится не реже одного раза в 6 месяцев (п. 16 Приказа 2464)»" } },
      { node: "END",              snapshot: { title: "Готово", fields: { path: "simple", latency: "~4.9s", cost: "~$0.004" } } },
    ],
  },
  borderline: {
    label: "Borderline → LLM verifier",
    query: "Кто проводит первичный инструктаж на рабочем месте?",
    steps: [
      { node: "START",            snapshot: { title: "Запрос получен", fields: { query: "«Кто проводит первичный инструктаж на рабочем месте?»" } } },
      { node: "intent_gate",      snapshot: { title: "Проверка намерения", fields: { cosine_sim_to_corpus: "0.63" }, verdict: "✅ domain match" } },
      { node: "router",           snapshot: { title: "Роутинг", fields: { active_query: "«первичный инструктаж проводит»" }, verdict: "→ rag_simple" } },
      { node: "rag_simple",       snapshot: { title: "Hybrid retrieval", fields: { passages: "12", top_score: "0.43" }, verdict: "→ evaluate_triage" } },
      { node: "evaluate_triage",  snapshot: { title: "Оценка quality", fields: { top_score: "0.43", range: "0.38 – 0.50 = borderline", keyword_overlap_original: "0.50" }, verdict: "⚠️ borderline → llm_verifier" } },
      { node: "llm_verifier",     snapshot: { title: "LLM верификация", fields: { model: "gemini-2.5-flash", verdict_llm: "SUFFICIENT — прямой ответ найден в чанке" }, verdict: "✅ → visual_enrichment" } },
      { node: "visual_enrichment",snapshot: { title: "Визуальное обогащение", fields: { visual_found: "нет" }, verdict: "→ generate_answer" } },
      { node: "generate_answer",  snapshot: { title: "Генерация", fields: { model: "gemini-2.5-flash", passages_used: "12" }, verdict: "«Первичный инструктаж проводит непосредственный руководитель работ»" } },
      { node: "END",              snapshot: { title: "Готово", fields: { path: "simple+verifier", latency: "~8s", cost: "~$0.007" } } },
    ],
  },
  complex: {
    label: "Сложный путь (rag_complex)",
    query: "Какие категории работников освобождаются от первичного инструктажа?",
    steps: [
      { node: "START",            snapshot: { title: "Запрос получен", fields: { query: "«Какие категории работников освобождаются от первичного инструктажа?»" } } },
      { node: "intent_gate",      snapshot: { title: "Проверка намерения", fields: { cosine_sim_to_corpus: "0.68" }, verdict: "✅ domain match" } },
      { node: "router",           snapshot: { title: "Роутинг", fields: { active_query: "«освобождение первичный инструктаж категории»", enumeration_intent: "true (запрос «какие категории»)" }, verdict: "→ rag_simple" } },
      { node: "rag_simple",       snapshot: { title: "Hybrid retrieval", fields: { passages: "12", top_score: "0.74" }, verdict: "→ evaluate_triage" } },
      { node: "evaluate_triage",  snapshot: { title: "Оценка quality", fields: { top_score: "0.74 (≥0.50)", enumeration_intent: "true ⚡" }, verdict: "⚡ enumeration escalation → rag_complex" } },
      { node: "rag_complex",      snapshot: { title: "Расширенный retrieval", fields: { multi_query_variants: "3", cross_ref_expanded: "2 пункта", mmr_passages: "24", top_score: "0.81" }, verdict: "→ evaluate_complex" } },
      { node: "evaluate_complex", snapshot: { title: "Оценка complex", fields: { top_score: "0.81", threshold: "0.50" }, verdict: "✅ sufficient → visual_enrichment" } },
      { node: "visual_enrichment",snapshot: { title: "Визуальное обогащение", fields: { visual_found: "нет" }, verdict: "→ generate_answer" } },
      { node: "generate_answer",  snapshot: { title: "Генерация (complex)", fields: { model: "gemini-3-flash (thinking)", thinking_budget: "4096 токенов", passages_used: "24" }, verdict: "«От первичного инструктажа освобождаются работники, чья деятельность не связана с...»" } },
      { node: "END",              snapshot: { title: "Готово", fields: { path: "complex", latency: "~18s", cost: "~$0.015" } } },
    ],
  },
  rewriter: {
    label: "Rewriter loop (перефразировка)",
    query: "программа В обучение",
    steps: [
      { node: "START",            snapshot: { title: "Запрос получен", fields: { query: "«программа В обучение»" } } },
      { node: "intent_gate",      snapshot: { title: "Проверка намерения", fields: { cosine_sim_to_corpus: "0.55" }, verdict: "✅ domain match" } },
      { node: "router",           snapshot: { title: "Роутинг", fields: { active_query: "«программа В обучение охрана труда»", glossary_hit: "программа В → подпункт «в» п.46 Правил" }, verdict: "→ rag_simple" } },
      { node: "rag_simple",       snapshot: { title: "Retrieval #1", fields: { passages: "12", top_score: "0.35 (ниже 0.38)" }, verdict: "→ evaluate_triage" } },
      { node: "evaluate_triage",  snapshot: { title: "Оценка quality #1", fields: { top_score: "0.35 < 0.38" }, verdict: "⚠️ borderline → llm_verifier" } },
      { node: "llm_verifier",     snapshot: { title: "LLM верификация", fields: { verdict_llm: "INSUFFICIENT — нет прямого ответа по программе В" }, verdict: "→ rewriter (переформулировать)" } },
      { node: "rewriter",         snapshot: { title: "Перефразировка", fields: { original_query: "«программа В обучение»", rewritten_query: "«периодичность обучения по подпункту в пункта 46 Приказа 2464»" }, verdict: "→ rag_simple #2" } },
      { node: "rag_simple",       snapshot: { title: "Retrieval #2 (rewritten)", fields: { passages: "12", top_score: "0.79" }, verdict: "→ evaluate_triage #2" } },
      { node: "evaluate_triage",  snapshot: { title: "Оценка quality #2", fields: { top_score: "0.79 ≥ 0.50" }, verdict: "✅ sufficient → visual_enrichment" } },
      { node: "visual_enrichment",snapshot: { title: "Визуальное обогащение", fields: { visual_found: "нет" }, verdict: "→ generate_answer" } },
      { node: "generate_answer",  snapshot: { title: "Генерация", fields: { model: "gemini-2.5-flash" }, verdict: "«Обучение по программе В проводится не реже одного раза в год»" } },
      { node: "END",              snapshot: { title: "Готово", fields: { path: "simple→verifier→rewriter→simple", latency: "~22s", cost: "~$0.018" } } },
    ],
  },
  oos: {
    label: "Out of scope (domain gate)",
    query: "Как приготовить борщ?",
    steps: [
      { node: "START",            snapshot: { title: "Запрос получен", fields: { query: "«Как приготовить борщ?»" } } },
      { node: "intent_gate",      snapshot: { title: "Проверка намерения", fields: { cosine_sim_to_corpus: "0.08", threshold: "0.25" }, verdict: "🚫 OOS (0.08 < 0.25) → END" } },
      { node: "END",              snapshot: { title: "Завершено (OOS)", fields: { answer: "«Этот вопрос выходит за рамки системы нормативных документов»", latency: "~0.3s", cost: "~$0.000" } } },
    ],
  },
  abstain: {
    label: "Abstain (нет данных в корпусе)",
    query: "Какой штраф за нарушение требований по радиационной безопасности?",
    steps: [
      { node: "START",            snapshot: { title: "Запрос получен", fields: { query: "«Штраф за нарушение требований по радиационной безопасности?»" } } },
      { node: "intent_gate",      snapshot: { title: "Проверка намерения", fields: { cosine_sim_to_corpus: "0.41" }, verdict: "✅ domain match (тема похожа на ОТ)" } },
      { node: "router",           snapshot: { title: "Роутинг", fields: { active_query: "«штраф радиационная безопасность»" }, verdict: "→ rag_simple" } },
      { node: "rag_simple",       snapshot: { title: "Retrieval", fields: { passages: "12", top_score: "0.29" }, verdict: "→ evaluate_triage" } },
      { node: "evaluate_triage",  snapshot: { title: "Оценка quality", fields: { top_score: "0.29 < 0.38" }, verdict: "→ rag_complex (clearly_bad)" } },
      { node: "rag_complex",      snapshot: { title: "Расширенный retrieval", fields: { multi_query_variants: "3", top_score: "0.31" }, verdict: "→ evaluate_complex" } },
      { node: "evaluate_complex", snapshot: { title: "Оценка complex", fields: { top_score: "0.31 < 0.50 (hard gate)" }, verdict: "🚫 quality too low → abstain" } },
      { node: "abstain",          snapshot: { title: "Abstain", fields: { reason: "Документов по радиационной безопасности нет в корпусе" }, verdict: "«Недостаточно данных для ответа на этот вопрос»" } },
      { node: "END",              snapshot: { title: "Завершено (abstain)", fields: { latency: "~16s", cost: "~$0.010" } } },
    ],
  },
};

const STEP_MS = 500;

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ghLink(path, def) {
  const base = REPO + path;
  if (!def) return base;
  return `${base}#L${def.lineno}-L${def.end_lineno}`;
}

function renderGraph() {
  const g = new dagreD3.graphlib.Graph().setGraph({
    rankdir: "TB", nodesep: 24, ranksep: 48, marginx: 16, marginy: 16,
  });

  DATA.graph.nodes.forEach(n => {
    const color = n.color || "#1e3a5f";
    g.setNode(n.id, {
      label: n.label,
      rx: 6, ry: 6, padding: 10,
      style: `fill:${color};stroke:${color}`,
    });
  });

  DATA.graph.edges.forEach(e => {
    g.setEdge(e.source, e.target, {
      class: e.kind === "conditional" ? "conditional" : (e.kind === "entry" ? "entry-edge" : ""),
    });
  });

  const svg = d3.select("#svg-graph");
  const inner = svg.select("g");
  const render = new dagreD3.render();
  render(inner, g);

  DATA.graph.nodes.forEach(n => {
    const color = n.color || "#1e3a5f";
    svg.select(`g.node[id="${n.id}"] rect`)
      .style("fill", color)
      .style("stroke", color)
      .attr("data-base-color", color);
  });

  svg.attr("viewBox", `0 0 ${g.graph().width + 40} ${g.graph().height + 40}`);

  svg.selectAll("g.node").on("click", function(id) {
    clearSimulation();
    d3.selectAll("g.node").classed("active", false);
    d3.select(this).classed("active", true);
    showPanel(id);
  });
}

// --- Simulation ---

let simTimer = null;

function clearSimulation() {
  if (simTimer) { clearTimeout(simTimer); simTimer = null; }
  d3.selectAll("g.node")
    .classed("sim-active", false)
    .classed("sim-visited", false)
    .classed("active", false);
  document.querySelectorAll(".sim-btn").forEach(b => b.classList.remove("running"));
  const panel = document.getElementById("panel");
  // only clear sim-status if it was a simulation panel
  if (panel.querySelector(".sim-status")) {
    panel.innerHTML = `<div class="placeholder">Кликни ноду или запусти сценарий ↑</div>`;
  }
}

function runSimulation(scenarioKey) {
  clearSimulation();
  const scenario = SCENARIOS[scenarioKey];
  if (!scenario) return;

  document.querySelector(`.sim-btn[data-scenario="${scenarioKey}"]`).classList.add("running");

  const steps = scenario.steps;
  let step = 0;

  function showSimPanel(stepObj, stepIdx, total) {
    const { node: nodeId, snapshot } = stepObj;
    const nodeData = DATA.nodeDetails[nodeId];
    const panel = document.getElementById("panel");

    const pct = Math.round(((stepIdx + 1) / total) * 100);
    let html = `<div class="sim-status">`;
    html += `<span class="sim-scenario">${escapeHtml(scenario.label)}</span>`;
    html += `<div class="sim-query">💬 ${escapeHtml(scenario.query)}</div>`;
    html += `<div class="sim-bar-wrap"><div class="sim-bar-fill" style="width:${pct}%"></div></div>`;
    html += `<div class="sim-step-count">${stepIdx + 1} / ${total}</div>`;
    html += `</div>`;

    html += `<h2>${escapeHtml(nodeId)}</h2>`;

    // Snapshot block — what's happening NOW with real data
    if (snapshot) {
      html += `<div class="snapshot-block">`;
      html += `<div class="snapshot-title">${escapeHtml(snapshot.title)}</div>`;
      if (snapshot.fields) {
        html += `<div class="snapshot-fields">`;
        Object.entries(snapshot.fields).forEach(([k, v]) => {
          html += `<div class="snapshot-row"><span class="snapshot-key">${escapeHtml(k)}</span><span class="snapshot-val">${escapeHtml(v)}</span></div>`;
        });
        html += `</div>`;
      }
      if (snapshot.verdict) {
        html += `<div class="snapshot-verdict">${escapeHtml(snapshot.verdict)}</div>`;
      }
      html += `</div>`;
    }

    // Next node hint
    if (stepIdx + 1 < steps.length) {
      const nextNode = steps[stepIdx + 1].node;
      html += `<div class="sim-next">следующий шаг → <strong>${escapeHtml(nextNode)}</strong></div>`;
    }

    // Routing (highlight active route)
    if (nodeData && nodeData.routing) {
      const nextNode = stepIdx + 1 < steps.length ? steps[stepIdx + 1].node : null;
      const entries = Object.entries(nodeData.routing);
      if (entries.length) {
        html += `<div class="routing-block" style="margin-top:12px"><div class="routing-title">Routing</div>`;
        entries.forEach(([target, condition]) => {
          const isActive = target === nextNode || target === "END" && nextNode === "END";
          html += `<div class="route-row${isActive ? " route-active" : ""}"><span class="route-target">→ ${escapeHtml(target)}</span><span class="route-cond">${escapeHtml(condition)}</span></div>`;
        });
        html += `</div>`;
      }
    }

    panel.innerHTML = html;
  }

  function tick() {
    if (step >= steps.length) {
      document.querySelector(`.sim-btn[data-scenario="${scenarioKey}"]`).classList.remove("running");
      return;
    }
    const stepObj = steps[step];
    const nodeId = stepObj.node;

    d3.selectAll("g.node").classed("sim-active", false);
    steps.slice(0, step).forEach(s => {
      d3.select(`g.node[id="${s.node}"]`).classed("sim-visited", true);
    });
    d3.select(`g.node[id="${nodeId}"]`)
      .classed("sim-visited", false)
      .classed("sim-active", true);

    showSimPanel(stepObj, step, steps.length);
    step++;
    simTimer = setTimeout(tick, STEP_MS);
  }

  tick();
}

// --- Panel ---

function showPanel(nodeId) {
  const panel = document.getElementById("panel");
  const node = DATA.nodeDetails[nodeId];
  if (!node) {
    panel.innerHTML = `<h2>${escapeHtml(nodeId)}</h2><div class="placeholder">Нет данных.</div>`;
    return;
  }
  let html = `<h2>${escapeHtml(nodeId)}</h2>`;
  if (node.description) html += `<p class="node-desc">${escapeHtml(node.description)}</p>`;
  const inputs = node.inputs || [];
  const outputs = node.outputs || [];
  if (inputs.length || outputs.length) {
    html += `<div class="io-block">`;
    if (inputs.length) html += `<div class="io-row"><span class="io-label">←&nbsp;вход</span><span class="io-fields">${inputs.map(f => `<code>${escapeHtml(f)}</code>`).join(" ")}</span></div>`;
    if (outputs.length) {
      html += `<div class="io-row"><span class="io-label">→&nbsp;выход</span><span class="io-fields">${outputs.map(f => `<code>${escapeHtml(f)}</code>`).join(" ")}</span></div>`;
      // Show possible values for each output field if defined
      const ov = node.output_values || {};
      outputs.forEach(fieldName => {
        const vals = ov[fieldName];
        if (vals && vals.length) {
          html += `<div class="output-values">`;
          vals.forEach(v => {
            html += `<div class="output-val-row"><code class="oval-val">${escapeHtml(v.value)}</code><span class="oval-desc">${escapeHtml(v.desc)}</span></div>`;
          });
          html += `</div>`;
        }
      });
    }
    html += `</div>`;
  }
  // Logic steps
  if (node.logic_steps && node.logic_steps.length) {
    html += `<div class="logic-steps">`;
    node.logic_steps.forEach((s, i) => {
      html += `<div class="logic-step"><span class="logic-step-num">${i + 1}</span><div><div class="logic-step-title">${escapeHtml(s.step)}</div><div class="logic-step-detail">${escapeHtml(s.detail)}</div></div></div>`;
    });
    html += `</div>`;
  }
  const routing = node.routing || {};
  const routeEntries = Object.entries(routing);
  if (routeEntries.length) {
    html += `<div class="routing-block"><div class="routing-title">Routing</div>`;
    routeEntries.forEach(([target, condition]) => {
      html += `<div class="route-row"><span class="route-target">→ ${escapeHtml(target)}</span><span class="route-cond">${escapeHtml(condition)}</span></div>`;
    });
    html += `</div>`;
  }
  // Triage viz
  if (node.triage_viz) {
    const tv = node.triage_viz;
    html += `<div class="triage-viz">`;
    html += `<div class="triage-title">Как решает triage (по top_score)</div>`;
    html += `<div class="thr-bar-wrap">`;
    tv.zones.forEach(z => {
      const pct = (z.to - z.from) * 100;
      html += `<div class="thr-zone" style="width:${pct}%;background:${escapeHtml(z.color)}" title="${escapeHtml(z.label)}"></div>`;
    });
    html += `</div>`;
    html += `<div class="thr-labels-wrap">`;
    tv.thresholds.forEach(t => {
      html += `<div class="thr-label" style="left:${t.value * 100}%"><span class="thr-tick" style="color:${escapeHtml(t.color)}">${t.value}</span><br><span class="thr-name">${escapeHtml(t.label)}</span></div>`;
    });
    html += `</div>`;
    html += `<div class="thr-legend">`;
    tv.zones.forEach(z => {
      html += `<div class="thr-legend-row"><span class="thr-dot" style="background:${escapeHtml(z.color)}"></span><span>${escapeHtml(z.label)}</span></div>`;
    });
    html += `</div>`;
    html += `<div class="escalations-title">⚡ Принудительные эскалации → rag_complex</div>`;
    html += `<div class="escalations">`;
    tv.escalations.forEach(e => {
      html += `<div class="escalation-row"><span class="esc-name">${escapeHtml(e.name)}</span><span class="esc-cond">${escapeHtml(e.condition)}</span></div>`;
    });
    html += `</div></div>`;
  }

  if (node.files && node.files.length) {
    html += `<div class="files-title">Код</div>`;
    node.files.forEach(f => {
      html += `<div class="file"><div class="file-path"><a href="${escapeHtml(ghLink(f.path))}" target="_blank">${escapeHtml(f.path)}</a></div>`;
      (f.defs || []).forEach(d => {
        html += `<div class="def"><span class="kind">${d.kind === "class" ? "C" : "fn"}</span><a href="${escapeHtml(ghLink(f.path, d))}" target="_blank">${escapeHtml(d.name)}</a>`;
        if (d.docstring) html += `<span class="doc">— ${escapeHtml(d.docstring)}</span>`;
        html += `</div>`;
      });
      html += `</div>`;
    });
  }
  panel.innerHTML = html;
}

// --- Indexing tab ---

function renderIndexing() {
  const view = document.getElementById("indexing-view");
  if (!view) return;
  const steps = DATA.indexingSteps || [];
  let html = `<div class="idx-header"><h2>Indexing Pipeline</h2><p>Как документы попадают в индекс: от PDF до готового векторного + BM25 хранилища.</p></div>`;
  html += `<div class="idx-lane">`;
  steps.forEach((step, i) => {
    const isLast = i === steps.length - 1;
    html += `<div class="idx-step" data-id="${escapeHtml(step.id)}">`;
    html += `<div class="idx-icon">${escapeHtml(step.icon)}</div>`;
    html += `<div class="idx-body">`;
    html += `<div class="idx-label">${escapeHtml(step.label)}</div>`;
    html += `<div class="idx-desc">${escapeHtml(step.description)}</div>`;
    if (step.params && step.params.length) {
      html += `<div class="idx-params">${step.params.map(p => `<code>${escapeHtml(p)}</code>`).join("")}</div>`;
    }
    if (step.file) {
      const href = REPO + step.file;
      html += `<div class="idx-file"><a href="${escapeHtml(href)}" target="_blank">${escapeHtml(step.file)}</a></div>`;
    }
    html += `</div>`;
    if (!isLast) html += `<div class="idx-arrow">→</div>`;
    html += `</div>`;
  });
  html += `</div>`;
  view.innerHTML = html;
}

// --- Tabs ---

function initTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

// --- Init ---

renderGraph();
renderIndexing();
initTabs();

document.querySelectorAll(".sim-btn").forEach(btn => {
  btn.addEventListener("click", () => runSimulation(btn.dataset.scenario));
});
