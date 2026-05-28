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
    panel.innerHTML = `<h2>${escapeHtml(nodeId)}</h2><div class="placeholder">Нет данных (служебная нода).</div>`;
    return;
  }
  let html = `<h2>${escapeHtml(nodeId)}</h2><div style="color:#94a3b8;font-size:13px;margin-bottom:12px;">${escapeHtml(node.description || "")}</div>`;
  node.files.forEach(f => {
    html += `<div class="file"><div class="file-path"><a href="${escapeHtml(ghLink(f.path))}" target="_blank">${escapeHtml(f.path)}</a></div>`;
    f.defs.forEach(d => {
      html += `<div class="def"><span class="kind">${d.kind === "class" ? "C" : "fn"}</span><a href="${escapeHtml(ghLink(f.path, d))}" target="_blank">${escapeHtml(d.name)}</a>`;
      if (d.docstring) html += `<span class="doc">— ${escapeHtml(d.docstring)}</span>`;
      html += `</div>`;
    });
    html += `</div>`;
  });
  panel.innerHTML = html;
}

renderGraph();
