import type { BuildingEdge, BuildingNode, PathResult } from "../lib/types";
import {
  buildingKey,
  connectionPoint,
  corridorOrientation,
  corridorSidePoint,
  isPathNode,
  layoutCampusMap,
  type CampusLayout,
  type Point,
} from "./campusLayout";

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

export function renderSignMap({ map, route, startId, goalId }: SignMapOptions): string {
  if (map.nodes.length === 0) {
    return `<div class="empty-map">No map data is available for ${escapeHtml(map.label)}.</div>`;
  }

  const layout = layoutCampusMap(map.nodes, map.level);
  const nodeById = new Map(map.nodes.map((node) => [node.id, node]));
  const routeNodeIds = new Set(route?.nodes.filter((node) => node.floor === map.level).map((node) => node.id) ?? []);
  const routeEdgeIds = new Set(route?.edges.filter((edge) => isEdgeOnFloor(edge, nodeById)).map((edge) => edge.id) ?? []);
  const canvasWidth = Math.max(1000, layout.buildings.size * 180);
  const proportionalHeight = canvasWidth * layout.bounds.height / layout.bounds.width;
  const canvasHeight = Math.max(520, Math.min(900, proportionalHeight));

  return `
    <svg
      class="sign-map"
      viewBox="${layout.bounds.x} ${layout.bounds.y} ${layout.bounds.width} ${layout.bounds.height}"
      preserveAspectRatio="xMinYMin meet"
      style="width:${canvasWidth}px;height:${Math.round(canvasHeight)}px"
      role="img"
      aria-label="${escapeHtml(map.label)} architectural navigation map"
    >
      <rect class="sign-map-background" x="${layout.bounds.x}" y="${layout.bounds.y}" width="${layout.bounds.width}" height="${layout.bounds.height}" />
      ${renderBuildingPlates(layout)}
      ${renderConnections(map.edges, nodeById, layout)}
      ${renderRoute(map.edges, nodeById, routeEdgeIds, layout)}
      ${renderRooms(map.nodes, routeNodeIds, startId, goalId, layout)}
      ${renderNavigationNodes(map.nodes, routeNodeIds, startId, goalId, layout)}
      ${renderCallouts(map.nodes, startId, goalId, layout)}
      <text class="floor-mark" x="${layout.bounds.x + layout.bounds.width - 8}" y="${layout.bounds.y + layout.bounds.height - 8}">${escapeHtml(map.label.replace("Level", "L"))}</text>
    </svg>
  `;
}

function renderBuildingPlates(layout: CampusLayout): string {
  return [...layout.buildings]
    .map(([building, bounds]) => `
      <g class="building-plate">
        <rect class="floor-plate" x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" />
        <text class="building-label" x="${bounds.x + 4}" y="${bounds.y + 7}">${escapeHtml(building)} Building</text>
      </g>
    `)
    .join("");
}

function renderConnections(edges: BuildingEdge[], nodeById: Map<string, BuildingNode>, layout: CampusLayout): string {
  return uniqueConnections(edges)
    .map((edge) => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) return "";

      const path = edgePath(edge, from, to, layout);
      if (buildingKey(from) !== buildingKey(to)) {
        return `<g class="building-connection"><path class="building-connector-wall" d="${path}" /><path class="building-connector-floor" d="${path}" /></g>`;
      }
      if (isPathNode(from) && isPathNode(to)) {
        return `<g class="corridor-connection"><path class="corridor-wall" d="${path}" /><path class="corridor-floor" d="${path}" /></g>`;
      }
      return `<path class="room-connector" d="${path}" />`;
    })
    .join("");
}

function renderRoute(
  edges: BuildingEdge[],
  nodeById: Map<string, BuildingNode>,
  routeEdgeIds: Set<string>,
  layout: CampusLayout,
): string {
  return uniqueConnections(edges)
    .filter((edge) => routeEdgeIds.has(edge.id))
    .map((edge) => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      return from && to ? `<path class="route-line" d="${edgePath(edge, from, to, layout)}" />` : "";
    })
    .join("");
}

function renderRooms(
  nodes: BuildingNode[],
  routeNodeIds: Set<string>,
  startId: string | undefined,
  goalId: string | undefined,
  layout: CampusLayout,
): string {
  return nodes
    .filter((node) => node.kind === "room")
    .map((node) => {
      const nodeLayout = layout.nodes.get(node.id);
      if (!nodeLayout) return "";
      const stateClass = node.id === startId ? " room-start" : node.id === goalId ? " room-goal" : routeNodeIds.has(node.id) ? " room-route" : "";
      const label = fitLabel(node.label, nodeLayout.width);
      return `
        <g class="room-cell${stateClass}">
          <rect x="${nodeLayout.x - nodeLayout.width / 2}" y="${nodeLayout.y - nodeLayout.height / 2}" width="${nodeLayout.width}" height="${nodeLayout.height}" rx=".35" />
          <text x="${nodeLayout.x}" y="${nodeLayout.y}" textLength="${Math.max(2, nodeLayout.width - 2.4)}" lengthAdjust="spacingAndGlyphs">${escapeHtml(label)}</text>
        </g>
      `;
    })
    .join("");
}

function renderNavigationNodes(
  nodes: BuildingNode[],
  routeNodeIds: Set<string>,
  startId: string | undefined,
  goalId: string | undefined,
  layout: CampusLayout,
): string {
  return nodes
    .filter((node) => node.kind !== "room")
    .map((node) => {
      const nodeLayout = layout.nodes.get(node.id);
      if (!nodeLayout) return "";
      const orientation = node.kind === "corridor" ? corridorOrientation(node) : "horizontal";
      const stateClass = node.id === startId ? " start-node" : node.id === goalId ? " goal-node" : routeNodeIds.has(node.id) ? " route-node" : "";
      const transform = orientation === "vertical" ? ` transform="rotate(90 ${nodeLayout.x} ${nodeLayout.y})"` : "";
      return `
        <g class="navigation-node ${node.kind}-node${stateClass}">
          <rect x="${nodeLayout.x - nodeLayout.width / 2}" y="${nodeLayout.y - nodeLayout.height / 2}" width="${nodeLayout.width}" height="${nodeLayout.height}" rx=".35" />
          <text x="${nodeLayout.x}" y="${nodeLayout.y}"${transform}>${escapeHtml(node.label)}</text>
        </g>
      `;
    })
    .join("");
}

function renderCallouts(nodes: BuildingNode[], startId: string | undefined, goalId: string | undefined, layout: CampusLayout): string {
  return nodes
    .filter((node) => node.id === startId || node.id === goalId)
    .map((node) => {
      const nodeLayout = layout.nodes.get(node.id);
      if (!nodeLayout) return "";
      const isStart = node.id === startId;
      const markerX = nodeLayout.x;
      const markerY = nodeLayout.y;
      const labelX = clamp(markerX + 8, layout.bounds.x + 3, layout.bounds.x + layout.bounds.width - 45);
      const labelY = clamp(markerY - 7, layout.bounds.y + 8, layout.bounds.y + layout.bounds.height - 5);
      const text = isStart ? "YOU ARE HERE" : `DESTINATION: ${displayName(node)}`;
      return `
        <g class="map-callout${isStart ? " here-callout" : " destination-callout"}">
          <circle cx="${markerX}" cy="${markerY}" r="2.4" />
          <path d="M ${markerX} ${markerY} L ${labelX - 2} ${labelY + 1}" />
          <text x="${labelX}" y="${labelY}">${escapeHtml(text)}</text>
        </g>
      `;
    })
    .join("");
}

function edgePath(edge: BuildingEdge, from: BuildingNode, to: BuildingNode, layout: CampusLayout): string {
  if (buildingKey(from) !== buildingKey(to)) {
    return buildingConnectionPath(
      connectionPoint(from, edge.fromEndpoint, layout),
      connectionPoint(to, edge.toEndpoint, layout),
      edge.bearing,
    );
  }

  if (isPathNode(from) && isPathNode(to)) {
    return linePath(connectionPoint(from, edge.fromEndpoint, layout), connectionPoint(to, edge.toEndpoint, layout));
  }

  const pathNode = isPathNode(from) ? from : to;
  const roomNode = isPathNode(from) ? to : from;
  const roomLayout = layout.nodes.get(roomNode.id);
  const pathLayout = layout.nodes.get(pathNode.id);
  if (!roomLayout || !pathLayout) return "";

  const roomPoint = { x: roomLayout.x, y: roomLayout.y };
  const pathPoint = pathNode.kind === "corridor"
    ? corridorSidePoint(pathNode, roomPoint, layout)
    : { x: pathLayout.x, y: pathLayout.y };
  const orientation = pathNode.kind === "corridor" ? corridorOrientation(pathNode) : "horizontal";
  return orthogonalPath(pathPoint, roomPoint, orientation);
}

function buildingConnectionPath(start: Point, end: Point, bearing: number): string {
  if (Math.abs(start.x - end.x) < 1 || Math.abs(start.y - end.y) < 1) return linePath(start, end);
  const direction = cardinalBearing(bearing);
  if (direction === 90 || direction === 270) {
    const middleX = round((start.x + end.x) / 2);
    return `M ${start.x} ${start.y} L ${middleX} ${start.y} L ${middleX} ${end.y} L ${end.x} ${end.y}`;
  }
  const middleY = round((start.y + end.y) / 2);
  return `M ${start.x} ${start.y} L ${start.x} ${middleY} L ${end.x} ${middleY} L ${end.x} ${end.y}`;
}

function orthogonalPath(pathPoint: Point, roomPoint: Point, orientation: "horizontal" | "vertical"): string {
  if (orientation === "vertical") {
    const elbowX = roomPoint.x > pathPoint.x ? roomPoint.x - 5 : roomPoint.x + 5;
    return `M ${pathPoint.x} ${pathPoint.y} L ${elbowX} ${pathPoint.y} L ${elbowX} ${roomPoint.y} L ${roomPoint.x} ${roomPoint.y}`;
  }
  const elbowY = roomPoint.y > pathPoint.y ? roomPoint.y - 4.2 : roomPoint.y + 4.2;
  return `M ${pathPoint.x} ${pathPoint.y} L ${pathPoint.x} ${elbowY} L ${roomPoint.x} ${elbowY} L ${roomPoint.x} ${roomPoint.y}`;
}

function linePath(start: Point, end: Point): string {
  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

function uniqueConnections(edges: BuildingEdge[]): BuildingEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = [edge.from, edge.to].sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isEdgeOnFloor(edge: BuildingEdge, nodeById: Map<string, BuildingNode>): boolean {
  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);
  return Boolean(from && to && from.floor === to.floor);
}

function displayName(node: BuildingNode): string {
  return node.aliases?.find((alias) => alias !== node.id && alias !== node.label) ?? node.label;
}

function fitLabel(value: string, width: number): string {
  const limit = Math.max(3, Math.floor(width / 0.9));
  return value.length <= limit ? value : `${value.slice(0, Math.max(1, limit - 3))}...`;
}

function cardinalBearing(bearing: number): number {
  const normalized = ((bearing % 360) + 360) % 360;
  return Math.round(normalized / 90) * 90 % 360;
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
