const REPO = "https://github.com/spqr-86/regulatory-rag/blob/main/";

const SCENARIOS = {
  simple: {
    label: "Нормативный вопрос (simple path)",
    path: ["START", "intent_gate", "router", "rag_simple", "evaluate_triage", "visual_enrichment", "generate_answer", "END"],
  },
  borderline: {
    label: "Borderline → LLM verifier",
    path: ["START", "intent_gate", "router", "rag_simple", "evaluate_triage", "llm_verifier", "visual_enrichment", "generate_answer", "END"],
  },
  complex: {
    label: "Сложный путь (rag_complex)",
    path: ["START", "intent_gate", "router", "rag_simple", "evaluate_triage", "rag_complex", "evaluate_complex", "visual_enrichment", "generate_answer", "END"],
  },
  rewriter: {
    label: "Rewriter loop (перефразировка)",
    path: ["START", "intent_gate", "router", "rag_simple", "evaluate_triage", "llm_verifier", "rewriter", "rag_simple", "evaluate_triage", "visual_enrichment", "generate_answer", "END"],
  },
  oos: {
    label: "Out of scope (domain gate)",
    path: ["START", "intent_gate", "END"],
  },
  abstain: {
    label: "Abstain (нет данных)",
    path: ["START", "intent_gate", "router", "rag_simple", "evaluate_triage", "rag_complex", "evaluate_complex", "abstain", "END"],
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

  const path = scenario.path;
  let step = 0;

  function showSimPanel(nodeId, stepIdx, total) {
    const node = DATA.nodeDetails[nodeId];
    const panel = document.getElementById("panel");
    const progress = "●".repeat(stepIdx + 1) + "○".repeat(total - stepIdx - 1);
    let html = `<div class="sim-status"><span class="sim-scenario">${escapeHtml(scenario.label)}</span><div class="sim-progress">${escapeHtml(progress)}</div></div>`;
    html += `<h2>${escapeHtml(nodeId)}</h2>`;
    if (node) {
      if (node.description) html += `<p class="node-desc">${escapeHtml(node.description)}</p>`;
      const inputs = node.inputs || [];
      const outputs = node.outputs || [];
      if (inputs.length || outputs.length) {
        html += `<div class="io-block">`;
        if (inputs.length) html += `<div class="io-row"><span class="io-label">←&nbsp;вход</span><span class="io-fields">${inputs.map(f => `<code>${escapeHtml(f)}</code>`).join(" ")}</span></div>`;
        if (outputs.length) html += `<div class="io-row"><span class="io-label">→&nbsp;выход</span><span class="io-fields">${outputs.map(f => `<code>${escapeHtml(f)}</code>`).join(" ")}</span></div>`;
        html += `</div>`;
      }
      const routing = node.routing || {};
      const routeEntries = Object.entries(routing);
      if (routeEntries.length) {
        html += `<div class="routing-block"><div class="routing-title">Routing</div>`;
        routeEntries.forEach(([target, condition]) => {
          const isActive = stepIdx + 1 < path.length && path[stepIdx + 1] === target;
          html += `<div class="route-row${isActive ? " route-active" : ""}"><span class="route-target">→ ${escapeHtml(target)}</span><span class="route-cond">${escapeHtml(condition)}</span></div>`;
        });
        html += `</div>`;
      }
    }
    panel.innerHTML = html;
  }

  function tick() {
    if (step >= path.length) {
      document.querySelector(`.sim-btn[data-scenario="${scenarioKey}"]`).classList.remove("running");
      return;
    }
    const nodeId = path[step];
    // dim all, mark visited, mark current
    d3.selectAll("g.node").classed("sim-active", false);
    if (step > 0) {
      path.slice(0, step).forEach(id => {
        d3.select(`g.node[id="${id}"]`).classed("sim-visited", true);
      });
    }
    d3.select(`g.node[id="${nodeId}"]`)
      .classed("sim-visited", false)
      .classed("sim-active", true);

    showSimPanel(nodeId, step, path.length);
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
    if (outputs.length) html += `<div class="io-row"><span class="io-label">→&nbsp;выход</span><span class="io-fields">${outputs.map(f => `<code>${escapeHtml(f)}</code>`).join(" ")}</span></div>`;
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

// --- Init ---

renderGraph();

document.querySelectorAll(".sim-btn").forEach(btn => {
  btn.addEventListener("click", () => runSimulation(btn.dataset.scenario));
});
