const REPO = "https://github.com/spqr-86/regulatory-rag/blob/main/";

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

// Kind labels shown as badge on node
const KIND_LABEL = {
  gate: "gate",
  retrieval: "retrieval",
  eval: "eval",
  generate: "generate",
  utility: "util",
  entry: "",
};

function renderGraph() {
  const g = new dagreD3.graphlib.Graph().setGraph({
    rankdir: "TB", nodesep: 24, ranksep: 48, marginx: 16, marginy: 16,
  });

  DATA.graph.nodes.forEach(n => {
    const color = n.color || "#1e3a5f";
    const kindLabel = KIND_LABEL[n.kind] || "";
    const badge = kindLabel
      ? `<tspan class="node-kind">${kindLabel}</tspan>\n`
      : "";
    g.setNode(n.id, {
      label: n.label,
      labelType: "string",
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

  // Apply per-node fill from data (dagre-d3 may override style on rect)
  DATA.graph.nodes.forEach(n => {
    const color = n.color || "#1e3a5f";
    svg.select(`g.node[id="${n.id}"] rect`)
      .style("fill", color)
      .style("stroke", color);
  });

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
    panel.innerHTML = `<h2>${escapeHtml(nodeId)}</h2><div class="placeholder">Нет данных.</div>`;
    return;
  }

  let html = `<h2>${escapeHtml(nodeId)}</h2>`;

  if (node.description) {
    html += `<p class="node-desc">${escapeHtml(node.description)}</p>`;
  }

  // Inputs / Outputs
  const inputs = node.inputs || [];
  const outputs = node.outputs || [];
  if (inputs.length || outputs.length) {
    html += `<div class="io-block">`;
    if (inputs.length) {
      html += `<div class="io-row"><span class="io-label">←&nbsp;вход</span><span class="io-fields">${inputs.map(f => `<code>${escapeHtml(f)}</code>`).join(" ")}</span></div>`;
    }
    if (outputs.length) {
      html += `<div class="io-row"><span class="io-label">→&nbsp;выход</span><span class="io-fields">${outputs.map(f => `<code>${escapeHtml(f)}</code>`).join(" ")}</span></div>`;
    }
    html += `</div>`;
  }

  // Routing logic
  const routing = node.routing || {};
  const routeEntries = Object.entries(routing);
  if (routeEntries.length) {
    html += `<div class="routing-block"><div class="routing-title">Routing</div>`;
    routeEntries.forEach(([target, condition]) => {
      html += `<div class="route-row"><span class="route-target">→ ${escapeHtml(target)}</span><span class="route-cond">${escapeHtml(condition)}</span></div>`;
    });
    html += `</div>`;
  }

  // Files
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

renderGraph();
