import { isRoomLikeNode } from "../lib/types";
import type { BuildingEdge, BuildingNode, CorridorEndpoint } from "../lib/types";

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

export function layoutCampusMap(nodes: BuildingNode[], edges: BuildingEdge[], floor: number): CampusLayout {
  const groups = [...groupNodesByBuilding(nodes)];
  const layouts = new Map<string, NodeLayout>();
  const entries: BuildingEntry[] = groups.map(([building, buildingNodes]) => {
    const size = buildingSchematicSize(buildingNodes);
    layoutBuildingNodes(buildingNodes, 0, 0, size, layouts);
    return { building, nodes: buildingNodes };
  });

  applyCorridorPlacements(nodes, edges, layouts);

  const measuredBounds = buildingBounds(groups, layouts);
  for (const entry of entries) entry.bounds = measuredBounds.get(entry.building);

  const targets = floor === 1 ? floorOneTargets(entries) : floorTwoTargets(entries);
  for (const entry of entries) {
    const target = targets.get(entry.building);
    if (!entry.bounds || !target) continue;
    translateBuilding(entry.nodes, layouts, target.x - entry.bounds.x, target.y - entry.bounds.y);
  }
  applyRoomPlacements(nodes, edges, layouts);

  const buildings = buildingBounds(groups, layouts);
  return { nodes: layouts, buildings, bounds: contentBounds(layouts, buildings) };
}

function applyRoomPlacements(nodes: BuildingNode[], edges: BuildingEdge[], layouts: Map<string, NodeLayout>): void {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    const placement = roomCorridorDetails(edge, nodeById);
    if (!placement || typeof edge.corridorOffset !== "number" || !edge.side) continue;
    const corridorLayout = layouts.get(placement.corridor.id);
    const roomLayout = layouts.get(placement.room.id);
    if (!corridorLayout || !roomLayout) continue;

    const offset = clamp(edge.corridorOffset, 0, 100) / 100;
    const orientation = corridorOrientation(placement.corridor);
    if (edge.side === "start" || edge.side === "end") {
      const direction = edge.side === "start" ? -1 : 1;
      if (orientation === "vertical") {
        roomLayout.x = corridorLayout.x;
        roomLayout.y = corridorLayout.y + direction * (corridorLayout.height / 2 + roomLayout.height / 2 + 4);
      } else {
        roomLayout.x = corridorLayout.x + direction * (corridorLayout.width / 2 + roomLayout.width / 2 + 4);
        roomLayout.y = corridorLayout.y;
      }
    } else if (orientation === "vertical") {
      roomLayout.x = corridorLayout.x + (edge.side === "left" ? 17 : -17);
      roomLayout.y = corridorLayout.y - corridorLayout.height / 2 + corridorLayout.height * offset;
    } else {
      roomLayout.x = corridorLayout.x - corridorLayout.width / 2 + corridorLayout.width * offset;
      roomLayout.y = corridorLayout.y + (edge.side === "left" ? -13 : 13);
    }
  }
}

function applyCorridorPlacements(nodes: BuildingNode[], edges: BuildingEdge[], layouts: Map<string, NodeLayout>): void {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const placements = edges.filter((edge) => {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    return isPositionedCorridorConnection(edge, from, to)
      && buildingKey(from) === buildingKey(to)
      && typeof edge.corridorOffset === "number";
  });
  const branchAxes = corridorBranchAxes(placements, nodeById, layouts, edges);
  const childIds = new Set(placements.map((edge) => edge.to));
  const positioned = new Set(
    nodes.filter((node) => node.kind === "corridor" && !childIds.has(node.id)).map((node) => node.id),
  );
  const pending = [...placements];

  for (let pass = 0; pass < placements.length && pending.length; pass += 1) {
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const edge = pending[index];
      if (!positioned.has(edge.from)) continue;
      const parent = nodeById.get(edge.from);
      const child = nodeById.get(edge.to);
      const parentLayout = layouts.get(edge.from);
      const childLayout = layouts.get(edge.to);
      if (!parent || !child || !parentLayout || !childLayout) continue;

      const attachment = corridorAttachmentPoint(parent, edge, parentLayout);
      const branchAxis = branchAxes.get(edge);
      if (branchAxis !== undefined) {
        if (corridorOrientation(parent) === "vertical") attachment.y = branchAxis;
        else attachment.x = branchAxis;
      }
      if (usesChildCorridorSide(edge, parent, child)) {
        const parentDirection = edge.side === "start" ? -1 : 1;
        if (corridorOrientation(parent) === "horizontal") {
          childLayout.x = attachment.x + parentDirection * childLayout.width / 2;
          childLayout.y = attachment.y;
        } else {
          childLayout.x = attachment.x;
          childLayout.y = attachment.y + parentDirection * childLayout.height / 2;
        }
      } else {
        const childDirection = edge.toEndpoint === "start" ? 1 : -1;
        if (corridorOrientation(child) === "vertical") {
          childLayout.x = attachment.x;
          childLayout.y = attachment.y + childDirection * childLayout.height / 2;
        } else {
          childLayout.x = attachment.x + childDirection * childLayout.width / 2;
          childLayout.y = attachment.y;
        }
      }
      childLayout.x = round(childLayout.x);
      childLayout.y = round(childLayout.y);
      positioned.add(child.id);
      pending.splice(index, 1);
    }
  }
}

function corridorBranchAxes(
  placements: BuildingEdge[],
  nodeById: Map<string, BuildingNode>,
  layouts: Map<string, NodeLayout>,
  edges: BuildingEdge[],
): Map<BuildingEdge, number> {
  const groups = new Map<string, Array<{
    edge: BuildingEdge;
    parent: BuildingNode;
    parentLayout: NodeLayout;
    branchSpan: number;
  }>>();
  const parentByChild = new Map(placements.map((edge) => [edge.to, edge.from]));

  for (const edge of placements) {
    if (edge.side === "start" || edge.side === "end") continue;
    const parent = nodeById.get(edge.from);
    const childLayout = layouts.get(edge.to);
    const parentLayout = layouts.get(edge.from);
    if (!parent || !childLayout || !parentLayout) continue;
    const key = `${parent.id}|${edge.side}`;
    const branchSpan = corridorBranchClearance(edge.to, parent, childLayout, layouts, edges, nodeById);
    const item = { edge, parent, parentLayout, branchSpan };
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const depth = (corridorId: string): number => {
    let currentId = corridorId;
    let value = 0;
    const visited = new Set<string>();
    while (parentByChild.has(currentId) && !visited.has(currentId)) {
      visited.add(currentId);
      currentId = parentByChild.get(currentId) ?? currentId;
      value += 1;
    }
    return value;
  };
  const orderedGroups = [...groups.values()]
    .sort((left, right) => depth(right[0].parent.id) - depth(left[0].parent.id));
  const gap = 2;

  for (const items of orderedGroups) {
    const { parent, parentLayout } = items[0];
    const vertical = corridorOrientation(parent) === "vertical";
    const axisKey = vertical ? "y" : "x";
    const spanKey = vertical ? "height" : "width";
    const requiredSpan = items.reduce((total, item) => total + item.branchSpan, 0)
      + gap * (items.length - 1)
      + 4;
    expandCorridorAwayFromParent(parent, parentLayout, axisKey, spanKey, requiredSpan, placements, nodeById);
  }

  const result = new Map<BuildingEdge, number>();
  for (const items of orderedGroups) {
    const { parent, parentLayout } = items[0];
    const vertical = corridorOrientation(parent) === "vertical";
    const axisKey = vertical ? "y" : "x";
    const spanKey = vertical ? "height" : "width";
    const start = parentLayout[axisKey] - parentLayout[spanKey] / 2;
    const end = parentLayout[axisKey] + parentLayout[spanKey] / 2;
    const ordered = [...items].sort((left, right) => (left.edge.corridorOffset ?? 50) - (right.edge.corridorOffset ?? 50));
    let previousEnd = start;

    for (const [index, item] of ordered.entries()) {
      const halfSpan = item.branchSpan / 2;
      const offset = clamp(item.edge.corridorOffset ?? 50, 0, 100) / 100;
      const desiredCenter = start + parentLayout[spanKey] * offset;
      const center = Math.max(desiredCenter, previousEnd + halfSpan + (index ? gap : 0));
      result.set(item.edge, center);
      previousEnd = center + halfSpan;
    }

    const last = ordered.at(-1);
    if (!last) continue;
    const overflow = (result.get(last.edge) ?? end) + last.branchSpan / 2 - end;
    if (overflow > 0) {
      for (const item of ordered) result.set(item.edge, (result.get(item.edge) ?? 0) - overflow);
    }
    const first = ordered[0];
    const underflow = start - ((result.get(first.edge) ?? start) - first.branchSpan / 2);
    if (underflow > 0) {
      for (const item of ordered) result.set(item.edge, (result.get(item.edge) ?? 0) + underflow);
    }
  }
  return result;
}

function corridorBranchClearance(
  childId: string,
  parent: BuildingNode,
  childLayout: NodeLayout,
  layouts: Map<string, NodeLayout>,
  edges: BuildingEdge[],
  nodeById: Map<string, BuildingNode>,
): number {
  const parentAxisSpan = corridorOrientation(parent) === "vertical" ? "height" : "width";
  const child = nodeById.get(childId);
  let attachedSpan = 0;
  for (const edge of edges) {
    if (!edge.side || edge.side === "start" || edge.side === "end") continue;
    const attachment = roomCorridorDetails(edge, nodeById);
    if (attachment?.corridor.id !== childId) continue;
    const attachedLayout = layouts.get(attachment.room.id);
    if (attachedLayout) attachedSpan = Math.max(attachedSpan, attachedLayout[parentAxisSpan]);
  }
  if (!child || attachedSpan === 0) return childLayout[parentAxisSpan];
  const sideCenterDistance = corridorOrientation(child) === "vertical" ? 17 : 13;
  return Math.max(childLayout[parentAxisSpan], sideCenterDistance * 2 + attachedSpan);
}

function expandCorridorAwayFromParent(
  corridor: BuildingNode,
  layout: NodeLayout,
  axisKey: "x" | "y",
  spanKey: "width" | "height",
  requiredSpan: number,
  placements: BuildingEdge[],
  nodeById: Map<string, BuildingNode>,
): void {
  const previousSpan = layout[spanKey];
  const nextSpan = Math.max(previousSpan, requiredSpan);
  if (nextSpan === previousSpan) return;

  const parentEdge = placements.find((edge) => edge.to === corridor.id && nodeById.get(edge.from)?.kind === "corridor");
  if (parentEdge?.toEndpoint) {
    const growthDirection = parentEdge.toEndpoint === "start" ? 1 : -1;
    layout[axisKey] = round(layout[axisKey] + growthDirection * (nextSpan - previousSpan) / 2);
  }
  layout[spanKey] = nextSpan;
}

function roomCorridorDetails(edge: BuildingEdge, nodeById: Map<string, BuildingNode>): { corridor: BuildingNode; room: BuildingNode } | undefined {
  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);
  const corridor = from?.kind === "corridor" ? from : to?.kind === "corridor" ? to : undefined;
  const room = isRoomLikeNode(from) ? from : isRoomLikeNode(to) ? to : undefined;
  return corridor && room ? { corridor, room } : undefined;
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

export function usesChildCorridorSide(
  edge: BuildingEdge,
  parent: BuildingNode | undefined,
  child: BuildingNode | undefined,
): boolean {
  return parent?.kind === "corridor"
    && child?.kind === "corridor"
    && !edge.toEndpoint
    && (edge.side === "start" || edge.side === "end")
    && corridorOrientation(parent) !== corridorOrientation(child);
}

function isPositionedCorridorConnection(
  edge: BuildingEdge,
  parent: BuildingNode | undefined,
  child: BuildingNode | undefined,
): boolean {
  return parent?.kind === "corridor"
    && child?.kind === "corridor"
    && Boolean(edge.side)
    && (Boolean(edge.toEndpoint) || usesChildCorridorSide(edge, parent, child));
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
      y: clamp(target.y, nodeLayout.y - nodeLayout.height / 2, nodeLayout.y + nodeLayout.height / 2),
    };
  }

  return {
    x: clamp(target.x, nodeLayout.x - nodeLayout.width / 2, nodeLayout.x + nodeLayout.width / 2),
    y: nodeLayout.y + (target.y < nodeLayout.y ? -nodeLayout.height / 2 : nodeLayout.height / 2),
  };
}

export function corridorAttachmentPoint(corridor: BuildingNode, edge: BuildingEdge, nodeLayout: NodeLayout): Point {
  const offset = clamp(edge.corridorOffset ?? 50, 0, 100) / 100;
  if (edge.side === "start" || edge.side === "end") {
    const direction = edge.side === "start" ? -1 : 1;
    return corridorOrientation(corridor) === "vertical"
      ? { x: nodeLayout.x, y: nodeLayout.y + direction * nodeLayout.height / 2 }
      : { x: nodeLayout.x + direction * nodeLayout.width / 2, y: nodeLayout.y };
  }
  if (corridorOrientation(corridor) === "vertical") {
    return {
      x: nodeLayout.x + (edge.side === "left" ? nodeLayout.width / 2 : -nodeLayout.width / 2),
      y: nodeLayout.y - nodeLayout.height / 2 + nodeLayout.height * offset,
    };
  }
  return {
    x: nodeLayout.x - nodeLayout.width / 2 + nodeLayout.width * offset,
    y: nodeLayout.y + (edge.side === "left" ? -nodeLayout.height / 2 : nodeLayout.height / 2),
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
    const nodeOrientation = node.kind === "corridor" ? corridorOrientation(node) : orientation;
    const nodeDimensions = node.kind === "corridor" ? corridorSize(nodeOrientation, corridorLength) : nodeSize(node);
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
  const backbone = nodes.find((node) => node.kind === "corridor" && node.orientation);
  if (backbone?.orientation) return backbone.orientation;

  const bearings = nodes
    .filter((node) => isRoomLikeNode(node) && Number.isFinite(node.exitBearing))
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
  if (isRoomLikeNode(node)) return { width: Math.max(7.2, Math.min(18, node.label.length * 1.05 + 4)), height: 5.8 };
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
