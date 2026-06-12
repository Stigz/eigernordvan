import { useMemo, useState } from "react";

const formatChf = (value) => `CHF ${Number(value || 0).toFixed(2)}`;
const formatSignedChf = (value) => {
  const amount = Number(value || 0);
  return amount < 0 ? `CHF -${Math.abs(amount).toFixed(2)}` : formatChf(amount);
};

const columnLabels = ["People + income", "Charges + credits", "Internal pots", "Costs + reserve", "Settlement now"];
const width = 1420;
const height = 740;
const nodeWidth = 184;
const columnX = [32, 318, 604, 890, 1176];
const minLinkWidth = 5;
const maxLinkWidth = 52;
const categoryOrder = [
  "monthly",
  "km",
  "night_vehicle",
  "night_living",
  "work_credit",
  "expense_paid",
  "income",
  "vehicle_cost",
  "living_cost",
  "reserve",
  "balance",
  "still_due",
  "reimbursement",
  "historical_paused",
];

const clamp = (min, value, max) => Math.max(min, Math.min(max, value));
const linkSort = (left, right) => {
  const leftIndex = categoryOrder.indexOf(left.category);
  const rightIndex = categoryOrder.indexOf(right.category);
  return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex) || left.label.localeCompare(right.label);
};

const splitLabel = (label = "", maxLineLength = 18) => {
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

const buildLayout = (model) => {
  const rawNodes = model.nodes || [];
  const nodeMap = new Map(rawNodes.map((node) => [node.id, node]));
  const links = (model.links || [])
    .filter((link) => Number(link.amount || 0) > 0 && nodeMap.has(link.from) && nodeMap.has(link.to))
    .sort(linkSort);
  const maxLinkAmount = Math.max(1, ...links.map((link) => Number(link.amount || 0)));
  const maxNodeValue = Math.max(1, ...rawNodes.map((node) => nodeFlowValue(node, links)));
  const nodesByColumn = Array.from({ length: 5 }, () => []);

  rawNodes.forEach((node) => {
    const column = clamp(0, Number(node.column ?? 0), 4);
    const flowValue = nodeFlowValue(node, links);
    if (flowValue <= 0 && node.kind !== "pot") return;
    nodesByColumn[column].push({
      ...node,
      flowValue,
      h: clamp(50, 46 + (flowValue / maxNodeValue) * 92, 138),
      w: nodeWidth,
      x: columnX[column],
    });
  });

  const positionedNodes = [];
  nodesByColumn.forEach((nodes) => {
    nodes.sort((left, right) => {
      const leftTone = categoryOrder.indexOf(left.tone);
      const rightTone = categoryOrder.indexOf(right.tone);
      return (leftTone === -1 ? 999 : leftTone) - (rightTone === -1 ? 999 : rightTone) || left.label.localeCompare(right.label);
    });
    const gap = nodes.length > 6 ? 16 : 22;
    const totalHeight = nodes.reduce((sum, node) => sum + node.h, 0) + Math.max(0, nodes.length - 1) * gap;
    let y = Math.max(62, (height - totalHeight) / 2);
    nodes.forEach((node) => {
      positionedNodes.push({ ...node, y });
      y += node.h + gap;
    });
  });

  const positionedMap = new Map(positionedNodes.map((node) => [node.id, node]));
  const linkWidths = Object.fromEntries(
    links.map((link) => [link.id, clamp(minLinkWidth, (Number(link.amount || 0) / maxLinkAmount) * maxLinkWidth, maxLinkWidth)]),
  );
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
    const total = items.reduce((sum, link) => sum + linkWidths[link.id] + 4, -4);
    let cursor = node.y + node.h / 2 - total / 2;
    items.forEach((link) => {
      const stroke = linkWidths[link.id];
      startY[link.id] = cursor + stroke / 2;
      cursor += stroke + 4;
    });
  });
  Object.entries(incoming).forEach(([nodeId, items]) => {
    const node = positionedMap.get(nodeId);
    if (!node) return;
    const total = items.reduce((sum, link) => sum + linkWidths[link.id] + 4, -4);
    let cursor = node.y + node.h / 2 - total / 2;
    items.forEach((link) => {
      const stroke = linkWidths[link.id];
      endY[link.id] = cursor + stroke / 2;
      cursor += stroke + 4;
    });
  });

  const positionedLinks = links.map((link) => {
    const from = positionedMap.get(link.from);
    const to = positionedMap.get(link.to);
    const x1 = from.x + from.w;
    const x2 = to.x;
    const y1 = startY[link.id] ?? from.y + from.h / 2;
    const y2 = endY[link.id] ?? to.y + to.h / 2;
    const curve = Math.max(90, (x2 - x1) * 0.52);
    return {
      ...link,
      strokeWidth: linkWidths[link.id],
      path: `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`,
      labelX: (x1 + x2) / 2,
      labelY: (y1 + y2) / 2 - Math.max(6, linkWidths[link.id] / 2),
    };
  });

  return { nodes: positionedNodes, links: positionedLinks };
};

const isConnected = (id, selectedId, links) => {
  if (!selectedId) return true;
  if (id === selectedId) return true;
  const selected = links.find((link) => link.id === selectedId);
  if (selected && (selected.from === id || selected.to === id)) return true;
  const node = links.some((link) => link.id === id && (link.from === selectedId || link.to === selectedId));
  return node || links.some((link) => (link.from === id || link.to === id) && (link.from === selectedId || link.to === selectedId));
};

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
                  <td>{row.date || "-"}</td>
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
  const activeId = hoveredId || selectedId;

  const select = (id) => {
    if (id) onSelect(id);
  };

  return (
    <section className="card full-span sankey-card">
      <header className="sankey-card-header">
        <div>
          <p className="eyebrow">B. Sankey</p>
          <h2>Why this is the result</h2>
          <p className="subtitle">Solid flows are cash or usage charges. Dashed flows are internal credits. Grey flows are paused history.</p>
        </div>
        <div className="sankey-legend">
          <span className="legend-dot monthly" /> Monthly
          <span className="legend-dot vehicle" /> Vehicle
          <span className="legend-dot living" /> Living
          <span className="legend-dot work" /> Work credit
          <span className="legend-dot settlement" /> Settlement
        </div>
      </header>
      <div className="sankey-shell">
        <svg className="sankey-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Accounting Sankey flow">
          <g className="sankey-column-labels">
            {columnLabels.map((label, index) => (
              <text key={label} x={columnX[index]} y="34">
                {label}
              </text>
            ))}
          </g>
          <g>
            {layout.links.map((link) => {
              const isActive = activeId === link.id;
              const dimmed = Boolean(activeId && !isActive && !isConnected(link.id, activeId, layout.links));
              return (
                <g
                  key={link.id}
                  className={`sankey-link-group ${isActive ? "selected" : ""} ${dimmed ? "dimmed" : ""}`}
                  onMouseEnter={() => setHoveredId(link.id)}
                  onMouseLeave={() => setHoveredId("")}
                >
                  <path
                    className="sankey-link-hit"
                    d={link.path}
                    strokeWidth={Math.max(18, link.strokeWidth + 12)}
                    onClick={() => select(link.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") select(link.id);
                    }}
                    tabIndex="0"
                  />
                  <path
                    className={`sankey-link ${link.tone || "shared"} ${link.dashed ? "work-credit" : ""} ${link.muted ? "muted" : ""}`}
                    d={link.path}
                    strokeWidth={link.strokeWidth}
                  />
                  {link.strokeWidth >= 12 && (
                    <text className="sankey-link-label" x={link.labelX} y={link.labelY}>
                      {link.label}: {formatChf(link.amount)}
                    </text>
                  )}
                  <title>{`${link.label}: ${formatChf(link.amount)}. ${link.explanation || ""}`}</title>
                </g>
              );
            })}
          </g>
          <g>
            {layout.nodes.map((node) => {
              const isActive = activeId === node.id;
              const dimmed = Boolean(activeId && !isActive && !isConnected(node.id, activeId, layout.links));
              const lines = splitLabel(node.label);
              return (
                <g
                  key={node.id}
                  className={`sankey-node ${node.kind || ""} ${node.tone || ""} ${isActive ? "selected" : ""} ${dimmed ? "dimmed" : ""}`}
                  role="button"
                  tabIndex="0"
                  onClick={() => select(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") select(node.id);
                  }}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId("")}
                >
                  <rect x={node.x} y={node.y} width={node.w} height={node.h} rx="14" />
                  <text className="sankey-node-title" x={node.x + 14} y={node.y + 22}>
                    {lines.map((line, index) => (
                      <tspan key={line} x={node.x + 14} dy={index === 0 ? 0 : 15}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                  <text className="sankey-node-value" x={node.x + 14} y={node.y + node.h - 24}>
                    {formatChf(node.amount)}
                  </text>
                  <text className="sankey-node-detail" x={node.x + 14} y={node.y + node.h - 9}>
                    {node.detail || ""}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </section>
  );
}
