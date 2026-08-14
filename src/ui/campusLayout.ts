import type { BuildingNode, CorridorEndpoint } from "../lib/types";

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export interface NodeLayout extends Rect {
  node: BuildingNode;
}

export interface CampusLayout {
  nodes: Map<string, NodeLayout>;
  buildings: Map<string, Rect>;
  bounds: Rect;
}

type Orientation = "horizontal" | "vertical";
type BuildingEntry = {
  building: string;
  nodes: BuildingNode[];
  bounds?: Rect;
};

export function layoutCampusMap(nodes: BuildingNode[], floor: number): CampusLayout {
  const groups = [...groupNodesByBuilding(nodes)];
  const layouts = new Map<string, NodeLayout>();
  const entries: BuildingEntry[] = groups.map(([building, buildingNodes]) => {
    const size = buildingSchematicSize(buildingNodes);
    layoutBuildingNodes(buildingNodes, 0, 0, size, layouts);
    return { building, nodes: buildingNodes };
  });

  const measuredBounds = buildingBounds(groups, layouts);
  for (const entry of entries) entry.bounds = measuredBounds.get(entry.building);

  const targets = floor === 1 ? floorOneTargets(entries) : floorTwoTargets(entries);
  for (const entry of entries) {
    const target = targets.get(entry.building);
    if (!entry.bounds || !target) continue;
    translateBuilding(entry.nodes, layouts, target.x - entry.bounds.x, target.y - entry.bounds.y);
  }

  const buildings = buildingBounds(groups, layouts);
  return { nodes: layouts, buildings, bounds: contentBounds(layouts, buildings) };
}

export function buildingKey(node: BuildingNode): string {
  return node.id.match(/[A-Za-z]/)?.[0].toUpperCase() ?? "Other";
}

export function isPathNode(node: BuildingNode): boolean {
  return ["corridor", "stairs", "elevator", "door"].includes(node.kind);
}

export function corridorOrientation(node: BuildingNode): Orientation {
  return node.kind === "corridor" && node.orientation === "vertical" ? "vertical" : "horizontal";
}

export function connectionPoint(node: BuildingNode, endpoint: CorridorEndpoint | undefined, layout: CampusLayout): Point {
  const nodeLayout = layout.nodes.get(node.id);
  if (!nodeLayout) return { x: node.x, y: node.y };
  if (node.kind !== "corridor" || !endpoint) return centerPoint(nodeLayout);

  const direction = endpoint === "start" ? -1 : 1;
  return corridorOrientation(node) === "vertical"
    ? { x: nodeLayout.x, y: nodeLayout.y + direction * nodeLayout.height / 2 }
    : { x: nodeLayout.x + direction * nodeLayout.width / 2, y: nodeLayout.y };
}

export function corridorSidePoint(corridor: BuildingNode, target: Point, layout: CampusLayout): Point {
  const nodeLayout = layout.nodes.get(corridor.id);
  if (!nodeLayout) return { x: corridor.x, y: corridor.y };

  if (corridorOrientation(corridor) === "vertical") {
    return {
      x: nodeLayout.x + (target.x < nodeLayout.x ? -nodeLayout.width / 2 : nodeLayout.width / 2),
      y: clamp(target.y, nodeLayout.y - nodeLayout.height / 2 + 2, nodeLayout.y + nodeLayout.height / 2 - 2),
    };
  }

  return {
    x: clamp(target.x, nodeLayout.x - nodeLayout.width / 2 + 2, nodeLayout.x + nodeLayout.width / 2 - 2),
    y: nodeLayout.y + (target.y < nodeLayout.y ? -nodeLayout.height / 2 : nodeLayout.height / 2),
  };
}

function floorOneTargets(entries: BuildingEntry[]): Map<string, Point> {
  const gap = 4;
  const byBuilding = new Map(entries.map((entry) => [entry.building, entry]));
  const targets = new Map<string, Point>();
  const lowerRow = ["B", "C", "D", "E"].filter((building) => byBuilding.has(building));
  let cursorX = 0;

  for (const building of lowerRow) {
    const entry = byBuilding.get(building);
    if (!entry?.bounds) continue;
    targets.set(building, { x: cursorX, y: 0 });
    cursorX += entry.bounds.width + gap;
  }

  const nEntry = byBuilding.get("N");
  if (nEntry?.bounds) {
    const spanStart = targets.get("C")?.x ?? 0;
    const dEntry = byBuilding.get("D");
    const dTarget = targets.get("D");
    const spanEnd = dEntry?.bounds && dTarget ? dTarget.x + dEntry.bounds.width : spanStart + nEntry.bounds.width;
    targets.set("N", { x: spanStart + (spanEnd - spanStart - nEntry.bounds.width) / 2, y: 0 });
  }

  const eTarget = targets.get("E");
  const nTarget = targets.get("N");
  if (eTarget && nEntry?.bounds && nTarget) {
    eTarget.x = Math.max(eTarget.x, nTarget.x + nEntry.bounds.width + gap);
  }

  const gEntry = byBuilding.get("G");
  if (gEntry?.bounds) targets.set("G", { x: eTarget?.x ?? cursorX, y: 0 });

  const upperBuildings = ["N", "G"].filter((building) => byBuilding.get(building)?.bounds);
  const upperHeight = Math.max(0, ...upperBuildings.map((building) => byBuilding.get(building)?.bounds?.height ?? 0));
  for (const building of lowerRow) {
    const target = targets.get(building);
    if (target) target.y = upperHeight + gap;
  }
  for (const building of upperBuildings) {
    const entry = byBuilding.get(building);
    const target = targets.get(building);
    if (entry?.bounds && target) target.y = (upperHeight - entry.bounds.height) / 2;
  }

  placeRemaining(entries, targets, rightEdge(entries, targets, cursorX), upperHeight + gap);
  return targets;
}

function floorTwoTargets(entries: BuildingEntry[]): Map<string, Point> {
  const gap = 4;
  const byBuilding = new Map(entries.map((entry) => [entry.building, entry]));
  const targets = new Map<string, Point>();
  const corridorChain = ["B", "C", "D", "E", "G", "N"].filter((building) => byBuilding.get(building)?.bounds);
  const chainHeight = Math.max(0, ...corridorChain.map((building) => byBuilding.get(building)?.bounds?.height ?? 0));
  let cursorX = 0;

  for (const building of corridorChain) {
    const entry = byBuilding.get(building);
    if (!entry?.bounds) continue;
    targets.set(building, { x: cursorX, y: (chainHeight - entry.bounds.height) / 2 });
    cursorX += entry.bounds.width + gap;
  }

  const aEntry = byBuilding.get("A");
  if (aEntry?.bounds) {
    const cEntry = byBuilding.get("C");
    const cTarget = targets.get("C") ?? { x: 0, y: 0 };
    targets.set("A", {
      x: cTarget.x + ((cEntry?.bounds?.width ?? 0) - aEntry.bounds.width) / 2,
      y: chainHeight + gap,
    });
  }

  placeRemaining(entries, targets, cursorX, chainHeight + gap);
  return targets;
}

function placeRemaining(entries: BuildingEntry[], targets: Map<string, Point>, startX: number, startY: number): void {
  const gap = 4;
  let cursorX = startX;
  for (const entry of entries) {
    if (targets.has(entry.building) || !entry.bounds) continue;
    targets.set(entry.building, { x: cursorX, y: startY });
    cursorX += entry.bounds.width + gap;
  }
}

function rightEdge(entries: BuildingEntry[], targets: Map<string, Point>, fallback: number): number {
  const byBuilding = new Map(entries.map((entry) => [entry.building, entry]));
  return Math.max(
    fallback,
    ...[...targets].map(([building, target]) => target.x + (byBuilding.get(building)?.bounds?.width ?? 0)),
  );
}

function translateBuilding(nodes: BuildingNode[], layouts: Map<string, NodeLayout>, offsetX: number, offsetY: number): void {
  for (const node of nodes) {
    const layout = layouts.get(node.id);
    if (!layout) continue;
    layout.x = round(layout.x + offsetX);
    layout.y = round(layout.y + offsetY);
  }
}

function layoutBuildingNodes(nodes: BuildingNode[], originX: number, originY: number, size: Rect, layouts: Map<string, NodeLayout>): void {
  const orientation = buildingOrientation(nodes);
  const pathNodes = sortedPathNodes(nodes, orientation);
  const roomNodes = sortedRoomNodes(nodes);
  if (!pathNodes.length) {
    layoutRoomGrid(roomNodes, originX, originY, size, layouts);
    return;
  }

  const corridorX = originX + size.width / 2;
  const corridorY = originY + size.height / 2;
  const axisStart = orientation === "vertical" ? originY + 15 : originX + 15;
  const axisEnd = orientation === "vertical" ? originY + size.height - 15 : originX + size.width - 15;
  const pathGap = pathNodes.length > 1 ? (axisEnd - axisStart) / (pathNodes.length - 1) : 0;

  pathNodes.forEach((node, index) => {
    const axis = pathNodes.length > 1 ? axisStart + index * pathGap : (axisStart + axisEnd) / 2;
    const point = orientation === "vertical" ? { x: corridorX, y: axis } : { x: axis, y: corridorY };
    const corridorLength = pathNodes.length > 1 ? Math.max(14, pathGap - 2) : Math.max(24, axisEnd - axisStart);
    const nodeDimensions = node.kind === "corridor" ? corridorSize(orientation, corridorLength) : nodeSize(node);
    layouts.set(node.id, { node, x: round(point.x), y: round(point.y), ...nodeDimensions });
  });

  const referencePath = averagePosition(pathNodes);
  const roomsBySide = splitRoomsBySide(roomNodes, referencePath, orientation);
  layoutRoomSide(roomsBySide.negative, -1, orientation, originX, originY, size, corridorX, corridorY, layouts);
  layoutRoomSide(roomsBySide.positive, 1, orientation, originX, originY, size, corridorX, corridorY, layouts);
}

function layoutRoomSide(
  rooms: BuildingNode[],
  side: number,
  orientation: Orientation,
  originX: number,
  originY: number,
  size: Rect,
  corridorX: number,
  corridorY: number,
  layouts: Map<string, NodeLayout>,
): void {
  const axisStart = orientation === "vertical" ? originY + 12 : originX + 12;
  const axisLength = orientation === "vertical" ? size.height - 24 : size.width - 24;
  rooms.forEach((room, index) => {
    const axis = axisStart + axisLength * (index + 1) / (rooms.length + 1);
    const point = orientation === "vertical"
      ? { x: corridorX + side * 17, y: axis }
      : { x: axis, y: corridorY + side * 13 };
    layouts.set(room.id, { node: room, x: round(point.x), y: round(point.y), ...nodeSize(room) });
  });
}

function layoutRoomGrid(nodes: BuildingNode[], originX: number, originY: number, size: Rect, layouts: Map<string, NodeLayout>): void {
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  nodes.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    layouts.set(node.id, {
      node,
      x: round(originX + 18 + column * 24),
      y: round(originY + 18 + row * 10),
      ...nodeSize(node),
    });
  });
}

function buildingSchematicSize(nodes: BuildingNode[]): Rect {
  const orientation = buildingOrientation(nodes);
  const pathNodes = sortedPathNodes(nodes, orientation);
  const roomNodes = sortedRoomNodes(nodes);
  if (!pathNodes.length) {
    const columns = Math.max(1, Math.ceil(Math.sqrt(roomNodes.length)));
    const rows = Math.max(1, Math.ceil(roomNodes.length / columns));
    return { x: 0, y: 0, width: Math.max(70, columns * 26 + 18), height: Math.max(42, rows * 11 + 24) };
  }

  const roomsBySide = splitRoomsBySide(roomNodes, averagePosition(pathNodes), orientation);
  const longestSide = Math.max(roomsBySide.negative.length, roomsBySide.positive.length, 1);
  return orientation === "vertical"
    ? { x: 0, y: 0, width: 76, height: Math.max(90, longestSide * 10 + 28, pathNodes.length * 20 + 28) }
    : { x: 0, y: 0, width: Math.max(90, longestSide * 22 + 28, pathNodes.length * 30 + 28), height: 58 };
}

function buildingOrientation(nodes: BuildingNode[]): Orientation {
  const explicit = nodes.filter((node) => node.kind === "corridor" && node.orientation).map((node) => node.orientation);
  if (explicit.length) {
    const verticalCount = explicit.filter((value) => value === "vertical").length;
    return verticalCount > explicit.length / 2 ? "vertical" : "horizontal";
  }

  const bearings = nodes
    .filter((node) => node.kind === "room" && Number.isFinite(node.exitBearing))
    .map((node) => cardinalBearing(node.exitBearing ?? 0));
  const verticalScore = bearings.filter((bearing) => bearing === 90 || bearing === 270).length;
  const horizontalScore = bearings.filter((bearing) => bearing === 0 || bearing === 180).length;
  return verticalScore > horizontalScore ? "vertical" : "horizontal";
}

function splitRoomsBySide(rooms: BuildingNode[], reference: Point, orientation: Orientation): { negative: BuildingNode[]; positive: BuildingNode[] } {
  const result: { negative: BuildingNode[]; positive: BuildingNode[] } = { negative: [], positive: [] };
  for (const room of rooms) result[roomSide(room, reference, orientation) < 0 ? "negative" : "positive"].push(room);
  const axis = orientation === "vertical" ? "y" : "x";
  result.negative.sort((left, right) => left[axis] - right[axis]);
  result.positive.sort((left, right) => left[axis] - right[axis]);
  return result;
}

function roomSide(room: BuildingNode, reference: Point, orientation: Orientation): number {
  const bearing = Number.isFinite(room.exitBearing) ? cardinalBearing(room.exitBearing ?? 0) : null;
  if (orientation === "vertical") {
    if (bearing === 90) return -1;
    if (bearing === 270) return 1;
    return room.x < reference.x ? -1 : 1;
  }
  if (bearing === 180) return -1;
  if (bearing === 0) return 1;
  return room.y < reference.y ? -1 : 1;
}

function groupNodesByBuilding(nodes: BuildingNode[]): Map<string, BuildingNode[]> {
  const groups = new Map<string, BuildingNode[]>();
  for (const node of nodes) {
    const building = buildingKey(node);
    groups.set(building, [...(groups.get(building) ?? []), node]);
  }
  return groups;
}

function sortedPathNodes(nodes: BuildingNode[], orientation: Orientation): BuildingNode[] {
  const primary = orientation === "vertical" ? "y" : "x";
  const secondary = orientation === "vertical" ? "x" : "y";
  return nodes
    .filter(isPathNode)
    .sort((left, right) => left[primary] - right[primary] || left[secondary] - right[secondary] || left.label.localeCompare(right.label));
}

function sortedRoomNodes(nodes: BuildingNode[]): BuildingNode[] {
  return nodes.filter((node) => !isPathNode(node)).sort((left, right) => left.x - right.x || left.y - right.y || left.label.localeCompare(right.label));
}

function buildingBounds(groups: [string, BuildingNode[]][], layouts: Map<string, NodeLayout>): Map<string, Rect> {
  const bounds = new Map<string, Rect>();
  for (const [building, nodes] of groups) {
    const groupLayouts = nodes.map((node) => layouts.get(node.id)).filter((layout): layout is NodeLayout => Boolean(layout));
    if (!groupLayouts.length) continue;
    const xs = groupLayouts.flatMap((layout) => [layout.x - layout.width / 2, layout.x + layout.width / 2]);
    const ys = groupLayouts.flatMap((layout) => [layout.y - layout.height / 2, layout.y + layout.height / 2]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    bounds.set(building, { x: minX - 10, y: minY - 10, width: maxX - minX + 20, height: maxY - minY + 20 });
  }
  return bounds;
}

function contentBounds(layouts: Map<string, NodeLayout>, buildings: Map<string, Rect>): Rect {
  const values = [...layouts.values()];
  const buildingValues = [...buildings.values()];
  const xs = values.flatMap((layout) => [layout.x - layout.width / 2, layout.x + layout.width / 2])
    .concat(buildingValues.flatMap((building) => [building.x, building.x + building.width]));
  const ys = values.flatMap((layout) => [layout.y - layout.height / 2, layout.y + layout.height / 2])
    .concat(buildingValues.flatMap((building) => [building.y, building.y + building.height]));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const padding = Math.max(width, height) * 0.08;
  return { x: minX - padding, y: minY - padding, width: width + padding * 2, height: height + padding * 2 };
}

function nodeSize(node: BuildingNode): { width: number; height: number } {
  if (node.kind === "stairs" || node.kind === "elevator") return { width: 7.2, height: 4.8 };
  if (node.kind === "room") return { width: Math.max(7.2, Math.min(18, node.label.length * 1.05 + 4)), height: 5.8 };
  return { width: Math.max(8, node.label.length * 0.95 + 3.8), height: 5.8 };
}

function corridorSize(orientation: Orientation, length: number): { width: number; height: number } {
  return orientation === "vertical" ? { width: 7, height: length } : { width: length, height: 7 };
}

function averagePosition(nodes: BuildingNode[]): Point {
  return {
    x: nodes.reduce((total, node) => total + node.x, 0) / nodes.length,
    y: nodes.reduce((total, node) => total + node.y, 0) / nodes.length,
  };
}

function centerPoint(rect: Rect): Point {
  return { x: rect.x, y: rect.y };
}

function cardinalBearing(bearing: number): number {
  return Math.round(normalizedBearing(bearing) / 90) * 90 % 360;
}

function normalizedBearing(bearing: number): number {
  return ((bearing % 360) + 360) % 360;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
