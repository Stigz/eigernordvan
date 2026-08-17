import { useMemo, useState } from "react";
import { formatSwissDate } from "../dateFormatting";

const formatChf = (value) => `CHF ${Number(value || 0).toFixed(2)}`;
const formatSignedChf = (value) => {
  const amount = Number(value || 0);
  return amount < 0 ? `CHF -${Math.abs(amount).toFixed(2)}` : formatChf(amount);
};

const svgWidth = 1600;
const svgHeight = 820;
const nodeWidth = 22;
const minLinkWidth = 8;
const maxLinkWidth = 64;
const columnTop = 82;
const columnBottom = svgHeight - 72;

const sankeyColumns = [
  {
    id: "sources",
    title: "Personen + Einnahmen",
    x: 70,
    nodes: ["person:Nic", "person:Luki", "person:Kayla", "person:Jeanne", "source:income"],
  },
  {
    id: "charges",
    title: "Beiträge",
    x: 420,
    nodes: ["charge:monthly", "charge:usage", "charge:private-paid", "charge:work"],
  },
  {
    id: "usage-split",
    title: "",
    x: 610,
    nodes: ["charge:km", "charge:nights"],
  },
  {
    id: "pots",
    title: "Töpfe",
    x: 850,
    nodes: ["pot:shared", "pot:vehicle", "pot:living", "pot:history"],
  },
  {
    id: "outputs",
    title: "Kosten + Reserve",
    x: 1160,
    nodes: ["out:reserve", "out:balance", "out:reimbursements", "out:vehicle-costs", "out:living-costs", "out:history"],
  },
];

const categoryOrder = [
  "income",
  "monthly",
  "expense_paid",
  "usage",
  "km",
  "night",
  "night_vehicle",
  "night_living",
  "work_credit",
  "shared",
  "vehicle_cost",
  "living_cost",
  "reserve",
  "balance",
  "reimbursement",
  "historical_paused",
];

const clamp = (min, value, max) => Math.max(min, Math.min(max, value));
const isHistorical = (item = {}) => item.tone === "history" || item.tone === "historical" || item.kind === "history" || item.kind === "historical";
const orderedIndex = (value) => {
  const index = categoryOrder.indexOf(value);
  return index === -1 ? 999 : index;
};

const linkSort = (left, right) => orderedIndex(left.category) - orderedIndex(right.category) || left.label.localeCompare(right.label);

const splitLabel = (label = "", maxLineLength = 22) => {
  const words = String(label).split(" ");
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLineLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) lines.push(current);
  return lines.slice(0, 3);
};

const nodeFlowValue = (node, links) => {
  const incoming = links.filter((link) => link.to === node.id).reduce((sum, link) => sum + Number(link.amount || 0), 0);
  const outgoing = links.filter((link) => link.from === node.id).reduce((sum, link) => sum + Number(link.amount || 0), 0);
  return Math.max(Number(node.amount || 0), incoming, outgoing);
};

const nodeHeight = (node, maxNodeAmount) => {
  if (isHistorical(node)) return 110;
  const flowValue = Number(node.flowValue || node.amount || 0);
  if (flowValue <= 0) return 72;
  return clamp(72, Math.sqrt(flowValue / maxNodeAmount) * 220, 220);
};

const linkWidth = (link, maxAmount) => {
  if (isHistorical(link) || link.muted) return 5;
  const amount = Number(link.amount || 0);
  if (amount <= 0) return 0;
  return clamp(minLinkWidth, Math.sqrt(amount / maxAmount) * maxLinkWidth, maxLinkWidth);
};

const layoutColumn = (nodes, maxNodeValue) => {
  if (!nodes.length) return [];
  const available = columnBottom - columnTop;
  const baseGap = nodes.length > 5 ? 30 : 40;
  const prepared = nodes.map((node) => ({ ...node, h: nodeHeight(node, maxNodeValue), w: nodeWidth }));
  const gapTotal = Math.max(0, prepared.length - 1) * baseGap;
  const rawHeight = prepared.reduce((sum, node) => sum + node.h, 0);
  const scale = rawHeight + gapTotal > available ? Math.max(0.55, (available - gapTotal) / rawHeight) : 1;
  const scaled = prepared.map((node) => ({ ...node, h: isHistorical(node) ? Math.min(110, node.h * scale) : Math.max(54, node.h * scale) }));
  const totalHeight = scaled.reduce((sum, node) => sum + node.h, 0) + gapTotal;
  let y = columnTop + Math.max(0, (available - totalHeight) / 2);
  return scaled.map((node) => {
    const positioned = { ...node, y };
    y += node.h + baseGap;
    return positioned;
  });
};

const buildLayout = (model) => {
  const rawNodes = model.nodes || [];
  const nodeMap = new Map(rawNodes.map((node) => [node.id, node]));
  const links = (model.links || [])
    .filter((link) => Number(link.amount || 0) > 0 && nodeMap.has(link.from) && nodeMap.has(link.to))
    .sort(linkSort);
  const visibleScalingLinks = links.filter((link) => !isHistorical(link));
  const maxLinkAmount = Math.max(1, ...visibleScalingLinks.map((link) => Number(link.amount || 0)));
  const maxNodeValue = Math.max(1, ...rawNodes.filter((node) => !isHistorical(node)).map((node) => nodeFlowValue(node, visibleScalingLinks)));
  const usedNodeIds = new Set();
  const positionedNodes = [];

  sankeyColumns.forEach((column) => {
    const nodes = column.nodes
      .map((id) => nodeMap.get(id))
      .filter(Boolean)
      .map((node) => ({ ...node, x: column.x, flowValue: nodeFlowValue(node, links), columnId: column.id }));
    const visibleNodes = nodes.filter((node) => node.flowValue > 0 || node.kind === "pot" || isHistorical(node));
    visibleNodes.forEach((node) => usedNodeIds.add(node.id));
    positionedNodes.push(...layoutColumn(visibleNodes, maxNodeValue));
  });

  const fallbackNodes = rawNodes
    .filter((node) => !usedNodeIds.has(node.id))
    .map((node) => ({ ...node, x: sankeyColumns[clamp(0, Number(node.column ?? 0), sankeyColumns.length - 1)].x, flowValue: nodeFlowValue(node, links) }))
    .filter((node) => node.flowValue > 0 || node.kind === "pot" || isHistorical(node));
  positionedNodes.push(...layoutColumn(fallbackNodes, maxNodeValue));

  const positionedMap = new Map(positionedNodes.map((node) => [node.id, node]));
  const linkWidths = Object.fromEntries(links.map((link) => [link.id, linkWidth(link, maxLinkAmount)]));
  const outgoing = {};
  const incoming = {};
  links.forEach((link) => {
    outgoing[link.from] = outgoing[link.from] || [];
    incoming[link.to] = incoming[link.to] || [];
    outgoing[link.from].push(link);
    incoming[link.to].push(link);
  });
  Object.values(outgoing).forEach((items) => items.sort(linkSort));
  Object.values(incoming).forEach((items) => items.sort(linkSort));

  const startY = {};
  const endY = {};
  Object.entries(outgoing).forEach(([nodeId, items]) => {
    const node = positionedMap.get(nodeId);
    if (!node) return;
    const total = items.reduce((sum, link) => sum + linkWidths[link.id] + 5, -5);
    let cursor = node.y + node.h / 2 - total / 2;
    items.forEach((link) => {
      const stroke = linkWidths[link.id];
      startY[link.id] = cursor + stroke / 2;
      cursor += stroke + 5;
    });
  });
  Object.entries(incoming).forEach(([nodeId, items]) => {
    const node = positionedMap.get(nodeId);
    if (!node) return;
    const total = items.reduce((sum, link) => sum + linkWidths[link.id] + 5, -5);
    let cursor = node.y + node.h / 2 - total / 2;
    items.forEach((link) => {
      const stroke = linkWidths[link.id];
      endY[link.id] = cursor + stroke / 2;
      cursor += stroke + 5;
    });
  });

  const positionedLinks = links
    .map((link) => {
      const from = positionedMap.get(link.from);
      const to = positionedMap.get(link.to);
      if (!from || !to) return null;
      const x1 = from.x + from.w;
      const x2 = to.x;
      const y1 = startY[link.id] ?? from.y + from.h / 2;
      const y2 = endY[link.id] ?? to.y + to.h / 2;
      const curve = Math.max(120, (x2 - x1) * 0.55);
      return {
        ...link,
        strokeWidth: linkWidths[link.id],
        path: `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`,
      };
    })
    .filter(Boolean);

  return { nodes: positionedNodes, links: positionedLinks };
};

const activeSets = (activeId, layout) => {
  const nodeIds = new Set();
  const linkIds = new Set();
  if (!activeId) return { nodeIds, linkIds };
  const activeLink = layout.links.find((link) => link.id === activeId);
  if (activeLink) {
    linkIds.add(activeLink.id);
    nodeIds.add(activeLink.from);
    nodeIds.add(activeLink.to);
    return { nodeIds, linkIds };
  }
  const activeNode = layout.nodes.find((node) => node.id === activeId);
  if (!activeNode) return { nodeIds, linkIds };
  nodeIds.add(activeNode.id);
  layout.links.forEach((link) => {
    if (link.from === activeNode.id || link.to === activeNode.id) {
      linkIds.add(link.id);
      nodeIds.add(link.from);
      nodeIds.add(link.to);
    }
  });
  return { nodeIds, linkIds };
};

function SankeyNodeLabel({ node }) {
  const titleLines = splitLabel(node.label, 24);
  const x = node.x + node.w + 12;
  const y = node.y + Math.min(22, Math.max(17, node.h * 0.2));
  const showDetail = node.h >= 66 && node.detail;
  return (
    <text className="sankey-node-label" x={x} y={y}>
      {titleLines.map((line, index) => (
        <tspan className="sankey-node-label-title" key={`${node.id}-${line}-${index}`} x={x} dy={index === 0 ? 0 : 17}>
          {line}
        </tspan>
      ))}
      <tspan className="sankey-node-label-value" x={x} dy="20">
        {formatChf(node.amount)}
      </tspan>
      {showDetail && (
        <tspan className="sankey-node-label-detail" x={x} dy="17">
          {node.detail}
        </tspan>
      )}
    </text>
  );
}

export function SankeyDetailPanel({ detail }) {
  if (!detail) return null;
  return (
    <aside className="sankey-detail-panel">
      <div>
        <p className="eyebrow">Selected calculation</p>
        <h2>{detail.title}</h2>
        <p className="subtitle">{detail.subtitle}</p>
      </div>
      <strong className="sankey-detail-amount">{formatSignedChf(detail.amount)}</strong>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Source</th>
              <th>Person</th>
              <th>Description</th>
              <th>Accounting effect</th>
              <th>Formula</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {(detail.rows || []).length === 0 ? (
              <tr>
                <td colSpan="7" className="empty-cell">
                  No source rows for this selection.
                </td>
              </tr>
            ) : (
              detail.rows.map((row, index) => (
                <tr key={`${detail.id}-${row.label}-${index}`}>
                  <td>{row.date ? formatSwissDate(row.date, row.date) : "-"}</td>
                  <td>{row.source || "-"}</td>
                  <td>{row.person || "-"}</td>
                  <td className="notes-cell">{row.description || "-"}</td>
                  <td>{row.label || "-"}</td>
                  <td className="notes-cell">{row.formula || row.detail || "-"}</td>
                  <td>{formatSignedChf(row.amount)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </aside>
  );
}

export default function AccountingSankey({ model, selectedId, onSelect }) {
  const [hoveredId, setHoveredId] = useState("");
  const layout = useMemo(() => buildLayout(model), [model]);
  const activeId = selectedId || hoveredId;
  const { nodeIds: activeNodeIds, linkIds: activeLinkIds } = useMemo(() => activeSets(activeId, layout), [activeId, layout]);

  const select = (id) => {
    if (id) onSelect(id);
  };

  return (
    <section className="card full-span sankey-card">
      <header className="sankey-card-header">
        <div>
          <p className="eyebrow">B. Sankey</p>
          <h2>Wohin das Geld fliesst</h2>
          <p className="subtitle">Breite Bänder sind aktuelle Nutzung oder Geldfluss. Gestrichelt ist interner Arbeits-Credit. Grau ist historisch pausiert.</p>
        </div>
        <div className="sankey-legend">
          <span className="legend-dot monthly" /> Monatsbeitrag
          <span className="legend-dot vehicle" /> Fahrzeug
          <span className="legend-dot living" /> Nächte
          <span className="legend-dot work" /> Arbeit
          <span className="legend-dot history" /> Historisch
        </div>
      </header>
      <div className={`sankey-shell ${activeId ? "has-selection" : ""}`}>
        <svg className="sankey-svg" viewBox={`0 0 ${svgWidth} ${svgHeight}`} role="img" aria-label="Accounting Sankey flow">
          <g className="sankey-column-labels">
            {sankeyColumns
              .filter((column) => column.title)
              .map((column) => (
                <text key={column.id} className="sankey-column-title" x={column.x} y="38">
                  {column.title}
                </text>
              ))}
          </g>
          <g className="sankey-links">
            {layout.links.map((link) => {
              const selected = activeId === link.id;
              const connected = selected || activeLinkIds.has(link.id);
              return (
                <g
                  key={link.id}
                  className={`sankey-link-group ${selected ? "selected" : ""} ${connected ? "connected" : ""}`}
                  onMouseEnter={() => setHoveredId(link.id)}
                  onMouseLeave={() => setHoveredId("")}
                >
                  <path
                    className="sankey-link-hit"
                    d={link.path}
                    strokeWidth={Math.max(20, link.strokeWidth + 16)}
                    data-link-id={link.id}
                    onClick={() => select(link.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") select(link.id);
                    }}
                    tabIndex="0"
                  />
                  <path
                    className={`sankey-link ${link.tone || "shared"} ${link.dashed ? "work-credit" : ""} ${link.muted ? "muted" : ""} ${
                      selected ? "selected" : ""
                    } ${connected ? "connected" : ""}`}
                    d={link.path}
                    strokeWidth={link.strokeWidth}
                  />
                  <title>{`${link.label}: ${formatChf(link.amount)}. ${link.explanation || ""}`}</title>
                </g>
              );
            })}
          </g>
          <g className="sankey-nodes">
            {layout.nodes.map((node) => {
              const selected = activeId === node.id;
              const connected = selected || activeNodeIds.has(node.id);
              return (
                <g
                  key={node.id}
                  className={`sankey-node ${node.kind || ""} ${node.tone || ""} ${selected ? "selected" : ""} ${connected ? "connected" : ""}`}
                  role="button"
                  tabIndex="0"
                  data-node-id={node.id}
                  onClick={() => select(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") select(node.id);
                  }}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId("")}
                >
                  <rect className="sankey-node-hitbox" x={node.x - 8} y={node.y - 8} width="250" height={Math.max(78, node.h + 16)} rx="0" />
                  <rect className="sankey-node-bar" x={node.x} y={node.y} width={node.w} height={node.h} rx="0" />
                  <SankeyNodeLabel node={node} />
                  <title>{`${node.label}: ${formatChf(node.amount)}. ${node.detail || ""}`}</title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </section>
  );
}
