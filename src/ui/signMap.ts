import type { BuildingEdge, BuildingNode, PathResult } from "../lib/types";

export interface SignMapData {
  level: number;
  label: string;
  title?: string;
  nodes: BuildingNode[];
  edges: BuildingEdge[];
}

interface SignMapOptions {
  map: SignMapData;
  route?: PathResult;
  startId?: string;
  goalId?: string;
}

interface Bounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

const canvasWidth = 1000;
const canvasHeight = 700;
const mapPadding = 92;

export function renderSignMap({ map, route, startId, goalId }: SignMapOptions): string {
  const nodes = map.nodes;

  if (nodes.length === 0) {
    return `<div class="empty-map">No map data is available for ${escapeHtml(map.label)}.</div>`;
  }

  const bounds = getBounds(nodes);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const routeNodeIds = new Set(route?.nodes.filter((node) => node.floor === map.level).map((node) => node.id) ?? []);
  const routeEdgeIds = new Set(route?.edges.filter((edge) => isEdgeOnFloor(edge, nodeById)).map((edge) => edge.id) ?? []);

  return `
    <svg class="sign-map" viewBox="0 0 ${canvasWidth} ${canvasHeight}" role="img" aria-label="${escapeHtml(map.label)} simplified navigation map">
      <rect class="sign-map-background" x="0" y="0" width="${canvasWidth}" height="${canvasHeight}" />
      ${renderFloorPlate(nodes, bounds)}
      ${renderCorridors(map.edges, nodeById, bounds)}
      ${renderRooms(nodes, routeNodeIds, startId, goalId, bounds)}
      ${renderSpecialAreas(nodes, bounds)}
      ${renderRoute(map.edges, nodeById, routeEdgeIds, bounds)}
      ${renderNodes(nodes, routeNodeIds, startId, goalId, bounds)}
      ${renderCallouts(nodes, routeNodeIds, startId, goalId, bounds)}
      <text class="floor-mark" x="860" y="636">${escapeHtml(map.label.replace("Level", "L"))}</text>
    </svg>
  `;
}

function renderFloorPlate(nodes: BuildingNode[], bounds: Bounds): string {
  return buildingGroups(nodes)
    .map((group) => {
      const points = group.map((node) => project(node, bounds));
      const minX = Math.min(...points.map((point) => point.x)) - 72;
      const maxX = Math.max(...points.map((point) => point.x)) + 72;
      const minY = Math.min(...points.map((point) => point.y)) - 58;
      const maxY = Math.max(...points.map((point) => point.y)) + 58;
      const notch = Math.min(34, Math.max(12, (maxX - minX) * 0.08));
      const polygon = [
        `${minX + notch},${minY}`,
        `${maxX - notch},${minY}`,
        `${maxX},${minY + notch}`,
        `${maxX},${maxY - notch}`,
        `${maxX - notch},${maxY}`,
        `${minX + notch},${maxY}`,
        `${minX},${maxY - notch}`,
        `${minX},${minY + notch}`,
      ].join(" ");

      return `<polygon class="floor-plate" points="${polygon}" />`;
    })
    .join("");
}

function renderRooms(
  nodes: BuildingNode[],
  routeNodeIds: Set<string>,
  startId: string | undefined,
  goalId: string | undefined,
  bounds: Bounds,
): string {
  return nodes
    .filter((node) => node.kind === "room")
    .map((node) => {
      const point = project(node, bounds);
      const width = roomWidth(node);
      const height = 42;
      const className = node.id === startId ? " room-start" : node.id === goalId ? " room-goal" : routeNodeIds.has(node.id) ? " room-route" : "";

      return `
        <g class="room-cell${className}">
          <rect x="${point.x - width / 2}" y="${point.y - height / 2}" width="${width}" height="${height}" />
          <text x="${point.x}" y="${point.y + 5}">${escapeHtml(node.label)}</text>
        </g>
      `;
    })
    .join("");
}

function renderCorridors(edges: BuildingEdge[], nodeById: Map<string, BuildingNode>, bounds: Bounds): string {
  return edges
    .map((edge) => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) return "";

      const start = project(from, bounds);
      const end = project(to, bounds);
      return `<g class="corridor-segment"><line class="corridor-wall" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" /><line class="corridor-line" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" /></g>`;
    })
    .join("");
}

function renderSpecialAreas(nodes: BuildingNode[], bounds: Bounds): string {
  return nodes
    .filter((node) => node.kind === "stairs" || node.kind === "elevator")
    .map((node) => {
      const point = project(node, bounds);
      const className = node.kind === "stairs" ? "special-area stairs-area" : "special-area elevator-area";
      const label = node.kind === "stairs" ? "Stairs" : "Elevator";

      return `
        <g class="${className}">
          <rect x="${point.x - 28}" y="${point.y - 18}" width="56" height="36" rx="3" />
          <text x="${point.x}" y="${point.y + 5}">${label}</text>
        </g>
      `;
    })
    .join("");
}

function renderRoute(
  edges: BuildingEdge[],
  nodeById: Map<string, BuildingNode>,
  routeEdgeIds: Set<string>,
  bounds: Bounds,
): string {
  return edges
    .filter((edge) => routeEdgeIds.has(edge.id))
    .map((edge) => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) return "";

      const start = project(from, bounds);
      const end = project(to, bounds);
      return `<line class="route-line" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" />`;
    })
    .join("");
}

function renderNodes(
  nodes: BuildingNode[],
  routeNodeIds: Set<string>,
  startId: string | undefined,
  goalId: string | undefined,
  bounds: Bounds,
): string {
  return nodes
    .map((node) => {
      const point = project(node, bounds);
      const stateClass = node.id === startId ? " start-node" : node.id === goalId ? " goal-node" : "";
      const routeClass = routeNodeIds.has(node.id) ? " route-node" : "";

      return `
        <g class="map-node ${node.kind}-node${routeClass}${stateClass}">
          <circle cx="${point.x}" cy="${point.y}" r="${nodeRadius(node)}" />
          ${importantNode(node, routeNodeIds, startId, goalId) ? `<text x="${point.x + 10}" y="${point.y - 10}">${escapeHtml(shortLabel(node))}</text>` : ""}
        </g>
      `;
    })
    .join("");
}

function renderCallouts(
  nodes: BuildingNode[],
  routeNodeIds: Set<string>,
  startId: string | undefined,
  goalId: string | undefined,
  bounds: Bounds,
): string {
  const calloutNodes = nodes.filter((node) => importantNode(node, routeNodeIds, startId, goalId)).slice(0, 10);

  return calloutNodes
    .map((node, index) => {
      const point = project(node, bounds);
      const side = index % 2 === 0 ? -1 : 1;
      const labelX = side < 0 ? Math.max(24, point.x - 270) : Math.min(canvasWidth - 250, point.x + 110);
      const labelY = clamp(point.y + (index % 3) * 24 - 34, 52, canvasHeight - 76);
      const elbowX = side < 0 ? labelX + 210 : labelX - 16;
      const text = node.id === startId ? "YOU ARE HERE" : node.id === goalId ? `DESTINATION: ${displayName(node)}` : displayName(node);

      return `
        <g class="map-callout${node.id === startId ? " here-callout" : ""}">
          <circle cx="${point.x}" cy="${point.y}" r="4" />
          <path d="M ${point.x} ${point.y} L ${elbowX} ${labelY} L ${labelX} ${labelY}" />
          <text x="${labelX}" y="${labelY - 8}">${escapeHtml(text)}</text>
        </g>
      `;
    })
    .join("");
}

function buildingGroups(nodes: BuildingNode[]): BuildingNode[][] {
  const groups = new Map<string, BuildingNode[]>();

  for (const node of nodes.filter((candidate) => candidate.kind !== "stairs" && candidate.kind !== "elevator")) {
    const key = node.id.match(/^[A-Z]/)?.[0] ?? "core";
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }

  return [...groups.values()].filter((group) => group.length > 1);
}

function importantNode(
  node: BuildingNode,
  routeNodeIds: Set<string>,
  startId: string | undefined,
  goalId: string | undefined,
): boolean {
  return node.id === startId || node.id === goalId || routeNodeIds.has(node.id) || node.kind === "stairs" || node.kind === "elevator";
}

function isEdgeOnFloor(edge: BuildingEdge, nodeById: Map<string, BuildingNode>): boolean {
  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);

  return Boolean(from && to && from.floor === to.floor);
}

function getBounds(nodes: BuildingNode[]): Bounds {
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  return { minX, minY, width, height };
}

function project(node: BuildingNode, bounds: Bounds): Point {
  const x = mapPadding + ((node.x - bounds.minX) / bounds.width) * (canvasWidth - mapPadding * 2);
  const y = mapPadding + ((node.y - bounds.minY) / bounds.height) * (canvasHeight - mapPadding * 2);

  return { x: round(x), y: round(y) };
}

function displayName(node: BuildingNode): string {
  return node.aliases?.find((alias) => alias !== node.id && alias !== node.label) ?? node.label;
}

function shortLabel(node: BuildingNode): string {
  if (node.kind === "stairs") return "S";
  if (node.kind === "elevator") return "E";
  return node.label;
}

function nodeRadius(node: BuildingNode): number {
  if (node.kind === "stairs" || node.kind === "elevator") return 6;
  if (node.kind === "room") return 3;
  return 4;
}

function roomWidth(node: BuildingNode): number {
  return Math.max(62, Math.min(118, node.label.length * 9 + 28));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character];
  });
}
