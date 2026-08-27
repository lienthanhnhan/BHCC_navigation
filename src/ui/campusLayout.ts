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
  ensureCorridorAttachmentCapacity(nodes, edges, layouts);
  const maximumLayoutPasses = 10;
  for (let pass = 0; pass < maximumLayoutPasses; pass += 1) {
    applyCorridorPlacements(nodes, edges, layouts);
    applyAttachmentPlacements(nodes, edges, layouts);
    spreadAttachmentsAlongCorridors(nodes, edges, layouts);
    const blockedAttachments = separateOverlappingAttachments(nodes, edges, layouts);
    if (!blockedAttachments.length || pass === maximumLayoutPasses - 1) break;
    expandCorridorsForBlockedAttachments(blockedAttachments, layouts, edges, new Map(nodes.map((node) => [node.id, node])));
  }

  const measuredBounds = buildingBounds(groups, layouts);
  for (const entry of entries) entry.bounds = measuredBounds.get(entry.building);

  const targets = floor === 1 ? floorOneTargets(entries) : floorTwoTargets(entries);
  applyConnectedBuildingTargets(entries, targets, edges);
  for (const entry of entries) {
    const target = targets.get(entry.building);
    if (!entry.bounds || !target) continue;
    translateBuilding(entry.nodes, layouts, target.x - entry.bounds.x, target.y - entry.bounds.y);
  }

  const buildings = buildingBounds(groups, layouts);
  return { nodes: layouts, buildings, bounds: contentBounds(layouts, buildings) };
}

type CorridorAttachmentPlacement = {
  edge: BuildingEdge;
  node: BuildingNode;
  nodeLayout: NodeLayout;
};

function corridorAttachmentGroups(
  nodes: BuildingNode[],
  edges: BuildingEdge[],
  layouts: Map<string, NodeLayout>,
): Map<string, Map<"left" | "right", CorridorAttachmentPlacement[]>> {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const groups = new Map<string, Map<"left" | "right", CorridorAttachmentPlacement[]>>();
  const seen = new Set<string>();

  for (const edge of edges) {
    if (edge.side !== "left" && edge.side !== "right") continue;
    if (typeof edge.corridorOffset !== "number") continue;
    const placement = corridorAttachmentDetails(edge, nodeById);
    if (!placement || !isRoomLikeNode(placement.node)) continue;
    const nodeLayout = layouts.get(placement.node.id);
    if (!nodeLayout) continue;
    const key = `${placement.corridor.id}|${placement.node.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const corridorGroups = groups.get(placement.corridor.id) ?? new Map();
    const sideGroup = corridorGroups.get(edge.side) ?? [];
    sideGroup.push({ edge, node: placement.node, nodeLayout });
    corridorGroups.set(edge.side, sideGroup);
    groups.set(placement.corridor.id, corridorGroups);
  }

  return groups;
}

function ensureCorridorAttachmentCapacity(
  nodes: BuildingNode[],
  edges: BuildingEdge[],
  layouts: Map<string, NodeLayout>,
): void {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const groups = corridorAttachmentGroups(nodes, edges, layouts);
  const gap = 1.2;
  const margin = 2;

  for (const [corridorId, sideGroups] of groups) {
    const corridor = nodeById.get(corridorId);
    const corridorLayout = layouts.get(corridorId);
    if (!corridor || !corridorLayout) continue;
    const vertical = corridorOrientation(corridor) === "vertical";
    const axisKey = vertical ? "y" : "x";
    const spanKey = vertical ? "height" : "width";
    const requiredSpan = Math.max(
      corridorLayout[spanKey],
      ...[...sideGroups.values()].map((placements) => (
        placements.reduce((total, placement) => total + placement.nodeLayout[spanKey], 0)
        + gap * Math.max(0, placements.length - 1)
        + margin * 2
      )),
    );
    const growth = requiredSpan - corridorLayout[spanKey];
    if (growth <= 0) continue;

    const parentEdge = edges.find((edge) => (
      edge.to === corridorId
      && nodeById.get(edge.from)?.kind === "corridor"
      && edge.toEndpoint
    ));
    if (parentEdge?.toEndpoint) {
      const growthDirection = parentEdge.toEndpoint === "start" ? 1 : -1;
      corridorLayout[axisKey] = round(corridorLayout[axisKey] + growthDirection * growth / 2);
    }
    corridorLayout[spanKey] = round(requiredSpan);
  }
}

function spreadAttachmentsAlongCorridors(
  nodes: BuildingNode[],
  edges: BuildingEdge[],
  layouts: Map<string, NodeLayout>,
): void {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const groups = corridorAttachmentGroups(nodes, edges, layouts);
  const gap = 1.2;
  const margin = 2;

  for (const [corridorId, sideGroups] of groups) {
    const corridor = nodeById.get(corridorId);
    const corridorLayout = layouts.get(corridorId);
    if (!corridor || !corridorLayout) continue;
    const vertical = corridorOrientation(corridor) === "vertical";
    const axisKey = vertical ? "y" : "x";
    const spanKey = vertical ? "height" : "width";
    const start = corridorLayout[axisKey] - corridorLayout[spanKey] / 2 + margin;
    const end = corridorLayout[axisKey] + corridorLayout[spanKey] / 2 - margin;

    for (const placements of sideGroups.values()) {
      const ordered = [...placements].sort((left, right) => (
        (left.edge.corridorOffset ?? 50) - (right.edge.corridorOffset ?? 50)
      ));
      let previousEnd = start;

      for (const [index, placement] of ordered.entries()) {
        const halfSpan = placement.nodeLayout[spanKey] / 2;
        const desired = start + (end - start) * clamp(placement.edge.corridorOffset ?? 50, 0, 100) / 100;
        const center = Math.max(desired, previousEnd + halfSpan + (index ? gap : 0));
        placement.nodeLayout[axisKey] = center;
        previousEnd = center + halfSpan;
      }

      const last = ordered.at(-1);
      if (!last) continue;
      const overflow = last.nodeLayout[axisKey] + last.nodeLayout[spanKey] / 2 - end;
      if (overflow > 0) {
        for (const placement of ordered) placement.nodeLayout[axisKey] -= overflow;
      }
      const first = ordered[0];
      const underflow = start - (first.nodeLayout[axisKey] - first.nodeLayout[spanKey] / 2);
      if (underflow > 0) {
        for (const placement of ordered) placement.nodeLayout[axisKey] += underflow;
      }
      for (const placement of ordered) placement.nodeLayout[axisKey] = round(placement.nodeLayout[axisKey]);
    }
  }
}

function separateOverlappingAttachments(
  nodes: BuildingNode[],
  edges: BuildingEdge[],
  layouts: Map<string, NodeLayout>,
): CorridorAttachmentPlacement[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const attachments = edges.flatMap((edge) => {
    if (!edge.side) return [];
    const placement = corridorAttachmentDetails(edge, nodeById);
    if (!placement || seen.has(placement.node.id)) return [];
    seen.add(placement.node.id);
    return [{ edge, ...placement }];
  });
  const attachedIds = new Set(edges.flatMap((edge) => {
    const placement = corridorAttachmentDetails(edge, nodeById);
    return placement ? [placement.node.id] : [];
  }));
  const blocked: CorridorAttachmentPlacement[] = [];
  const gap = 0.8;

  for (const { edge, corridor, node } of attachments) {
    const corridorLayout = layouts.get(corridor.id);
    const nodeLayout = layouts.get(node.id);
    if (!corridorLayout || !nodeLayout) continue;

    const vertical = corridorOrientation(corridor) === "vertical";
    const axisKey = vertical ? "y" : "x";
    const spanKey = vertical ? "height" : "width";
    const halfSpan = nodeLayout[spanKey] / 2;

    const blockers = [...layouts.values()].filter((layout) => (
      layout.node.id !== node.id
      && layout.node.id !== corridor.id
      && buildingKey(layout.node) === buildingKey(node)
      && (isPathNode(layout.node) || attachedIds.has(layout.node.id))
    ));
    if (!blockers.some((blocker) => nodeRectsOverlap(nodeLayout, blocker, gap))) continue;

    const original = nodeLayout[axisKey];
    if (edge.side === "start" || edge.side === "end") {
      const direction = edge.side === "start" ? -1 : 1;
      const candidates = [original, ...blockers.map((blocker) => (
        blocker[axisKey] + direction * (blocker[spanKey] / 2 + halfSpan + gap)
      ))].filter((candidate) => direction * (candidate - original) >= 0)
        .sort((left, right) => Math.abs(left - original) - Math.abs(right - original));
      const freePosition = candidates.find((candidate) => {
        nodeLayout[axisKey] = candidate;
        return blockers.every((blocker) => !nodeRectsOverlap(nodeLayout, blocker, gap));
      });
      nodeLayout[axisKey] = freePosition ?? original;
      continue;
    }

    const minimum = corridorLayout[axisKey] - corridorLayout[spanKey] / 2 + halfSpan + 1;
    const maximum = corridorLayout[axisKey] + corridorLayout[spanKey] / 2 - halfSpan - 1;
    if (minimum > maximum) continue;
    const candidates = [original, minimum, maximum];
    for (const blocker of blockers) {
      candidates.push(
        blocker[axisKey] - blocker[spanKey] / 2 - halfSpan - gap,
        blocker[axisKey] + blocker[spanKey] / 2 + halfSpan + gap,
      );
    }

    const available = [...new Set(candidates.map((candidate) => round(clamp(candidate, minimum, maximum))))]
      .sort((left, right) => Math.abs(left - original) - Math.abs(right - original));
    const freePosition = available.find((candidate) => {
      nodeLayout[axisKey] = candidate;
      return blockers.every((blocker) => !nodeRectsOverlap(nodeLayout, blocker, gap));
    });
    nodeLayout[axisKey] = freePosition ?? original;
    if (freePosition !== undefined) continue;

    if (node.kind === "stairs" || node.kind === "elevator") {
      const outsidePositions = blockers.flatMap((blocker) => [
        blocker[axisKey] - blocker[spanKey] / 2 - halfSpan - gap,
        blocker[axisKey] + blocker[spanKey] / 2 + halfSpan + gap,
      ]).filter((candidate) => candidate < minimum || candidate > maximum)
        .sort((left, right) => Math.abs(left - original) - Math.abs(right - original));
      const outsidePosition = outsidePositions.find((candidate) => {
        nodeLayout[axisKey] = candidate;
        return blockers.every((blocker) => !nodeRectsOverlap(nodeLayout, blocker, gap));
      });
      nodeLayout[axisKey] = outsidePosition ?? original;
      continue;
    }

    blocked.push({ edge, corridor, node, nodeLayout });
  }

  return blocked;
}

function expandCorridorsForBlockedAttachments(
  blockedAttachments: CorridorAttachmentPlacement[],
  layouts: Map<string, NodeLayout>,
  edges: BuildingEdge[],
  nodeById: Map<string, BuildingNode>,
): void {
  const growthByCorridor = new Map<string, number>();
  for (const { corridor, nodeLayout } of blockedAttachments) {
    const spanKey = corridorOrientation(corridor) === "vertical" ? "height" : "width";
    growthByCorridor.set(corridor.id, (growthByCorridor.get(corridor.id) ?? 0) + nodeLayout[spanKey] + 2);
  }

  for (const [corridorId, growth] of growthByCorridor) {
    const corridor = nodeById.get(corridorId);
    const corridorLayout = layouts.get(corridorId);
    if (!corridor || !corridorLayout) continue;
    const vertical = corridorOrientation(corridor) === "vertical";
    const axisKey = vertical ? "y" : "x";
    const spanKey = vertical ? "height" : "width";
    expandCorridorAwayFromParent(
      corridor,
      corridorLayout,
      axisKey,
      spanKey,
      corridorLayout[spanKey] + growth,
      edges,
      nodeById,
    );
  }
}

function nodeRectsOverlap(left: NodeLayout, right: NodeLayout, gap: number): boolean {
  return left.x - left.width / 2 < right.x + right.width / 2 + gap
    && left.x + left.width / 2 + gap > right.x - right.width / 2
    && left.y - left.height / 2 < right.y + right.height / 2 + gap
    && left.y + left.height / 2 + gap > right.y - right.height / 2;
}

function applyAttachmentPlacements(nodes: BuildingNode[], edges: BuildingEdge[], layouts: Map<string, NodeLayout>): void {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    const placement = corridorAttachmentDetails(edge, nodeById);
    if (!placement || typeof edge.corridorOffset !== "number" || !edge.side) continue;
    const corridorLayout = layouts.get(placement.corridor.id);
    const nodeLayout = layouts.get(placement.node.id);
    if (!corridorLayout || !nodeLayout) continue;

    const offset = clamp(edge.corridorOffset, 0, 100) / 100;
    const orientation = corridorOrientation(placement.corridor);
    const connectorGap = 1.5;
    if (edge.side === "start" || edge.side === "end") {
      const direction = edge.side === "start" ? -1 : 1;
      if (orientation === "vertical") {
        nodeLayout.x = corridorLayout.x;
        nodeLayout.y = corridorLayout.y + direction * (corridorLayout.height / 2 + nodeLayout.height / 2 + connectorGap);
      } else {
        nodeLayout.x = corridorLayout.x + direction * (corridorLayout.width / 2 + nodeLayout.width / 2 + connectorGap);
        nodeLayout.y = corridorLayout.y;
      }
    } else if (orientation === "vertical") {
      const sideDistance = corridorLayout.width / 2 + nodeLayout.width / 2 + connectorGap;
      nodeLayout.x = corridorLayout.x + (edge.side === "left" ? sideDistance : -sideDistance);
      nodeLayout.y = corridorLayout.y - corridorLayout.height / 2 + corridorLayout.height * offset;
    } else {
      const sideDistance = corridorLayout.height / 2 + nodeLayout.height / 2 + connectorGap;
      nodeLayout.x = corridorLayout.x - corridorLayout.width / 2 + corridorLayout.width * offset;
      nodeLayout.y = corridorLayout.y + (edge.side === "left" ? -sideDistance : sideDistance);
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
    const attachment = corridorAttachmentDetails(edge, nodeById);
    if (attachment?.corridor.id !== childId) continue;
    const attachedLayout = layouts.get(attachment.node.id);
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

function corridorAttachmentDetails(
  edge: BuildingEdge,
  nodeById: Map<string, BuildingNode>,
): { corridor: BuildingNode; node: BuildingNode } | undefined {
  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);
  const corridor = from?.kind === "corridor" ? from : to?.kind === "corridor" ? to : undefined;
  const node = isCorridorAttachableNode(from) ? from : isCorridorAttachableNode(to) ? to : undefined;
  return corridor && node ? { corridor, node } : undefined;
}

function isCorridorAttachableNode(node: BuildingNode | undefined): node is BuildingNode {
  return Boolean(node && (isRoomLikeNode(node) || node.kind === "stairs" || node.kind === "elevator"));
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

function applyConnectedBuildingTargets(
  entries: BuildingEntry[],
  targets: Map<string, Point>,
  edges: BuildingEdge[],
): void {
  const nodeById = new Map(entries.flatMap((entry) => entry.nodes).map((node) => [node.id, node]));
  const entryByBuilding = new Map(entries.map((entry) => [entry.building, entry]));
  const relationships = edges.flatMap((edge) => {
    const parent = nodeById.get(edge.from);
    const child = nodeById.get(edge.to);
    if (parent?.kind !== "corridor" || child?.kind !== "corridor") return [];
    const parentBuilding = buildingKey(parent);
    const childBuilding = buildingKey(child);
    if (parentBuilding === childBuilding) return [];
    return [{
      parentBuilding,
      childBuilding,
      direction: connectedBuildingDirection(edge, parent, child),
    }];
  });
  if (!relationships.length) return;

  const neighbors = new Map<string, Array<{ building: string; direction: BuildingDirection }>>();
  const incoming = new Set<string>();
  for (const relationship of relationships) {
    neighbors.set(relationship.parentBuilding, [
      ...(neighbors.get(relationship.parentBuilding) ?? []),
      { building: relationship.childBuilding, direction: relationship.direction },
    ]);
    neighbors.set(relationship.childBuilding, [
      ...(neighbors.get(relationship.childBuilding) ?? []),
      { building: relationship.parentBuilding, direction: oppositeDirection(relationship.direction) },
    ]);
    incoming.add(relationship.childBuilding);
  }

  const ungrouped = new Set(entries.filter((entry) => entry.bounds).map((entry) => entry.building));
  const components: Array<{ buildings: string[]; positions: Map<string, Point>; bounds: Rect }> = [];
  while (ungrouped.size) {
    const first = ungrouped.values().next().value as string;
    const buildings: string[] = [];
    const componentQueue = [first];
    ungrouped.delete(first);
    while (componentQueue.length) {
      const building = componentQueue.shift();
      if (!building) continue;
      buildings.push(building);
      for (const neighbor of neighbors.get(building) ?? []) {
        if (!ungrouped.delete(neighbor.building)) continue;
        componentQueue.push(neighbor.building);
      }
    }

    const root = buildings.find((building) => !incoming.has(building)) ?? buildings[0];
    const positions = new Map<string, Point>([[root, { x: 0, y: 0 }]]);
    const queue = [root];
    while (queue.length) {
      const parentBuilding = queue.shift();
      if (!parentBuilding) continue;
      const parentTarget = positions.get(parentBuilding);
      const parentBounds = entryByBuilding.get(parentBuilding)?.bounds;
      if (!parentTarget || !parentBounds) continue;
      for (const neighbor of neighbors.get(parentBuilding) ?? []) {
        if (positions.has(neighbor.building)) continue;
        const childBounds = entryByBuilding.get(neighbor.building)?.bounds;
        if (!childBounds) continue;
        const childTarget = adjacentBuildingTarget(parentTarget, parentBounds, childBounds, neighbor.direction);
        avoidBuildingOverlap(childTarget, childBounds, neighbor.direction, positions, entryByBuilding);
        positions.set(neighbor.building, childTarget);
        queue.push(neighbor.building);
      }
    }

    const componentBounds = boundsForBuildingPositions(buildings, positions, entryByBuilding);
    components.push({ buildings, positions, bounds: componentBounds });
  }

  components.sort((left, right) => right.buildings.length - left.buildings.length);
  const totalArea = components.reduce((sum, component) => sum + component.bounds.width * component.bounds.height, 0);
  const rowLimit = Math.max(...components.map((component) => component.bounds.width), Math.sqrt(totalArea) * 1.8);
  let cursorX = 0, cursorY = 0, rowHeight = 0;
  targets.clear();
  for (const component of components) {
    if (cursorX > 0 && cursorX + component.bounds.width > rowLimit) {
      cursorX = 0;
      cursorY += rowHeight + 10;
      rowHeight = 0;
    }
    for (const building of component.buildings) {
      const position = component.positions.get(building);
      if (!position) continue;
      targets.set(building, {
        x: cursorX + position.x - component.bounds.x,
        y: cursorY + position.y - component.bounds.y,
      });
    }
    cursorX += component.bounds.width + 10;
    rowHeight = Math.max(rowHeight, component.bounds.height);
  }
}

type BuildingDirection = "up" | "right" | "down" | "left";

function connectedBuildingDirection(edge: BuildingEdge, parent: BuildingNode, child: BuildingNode): BuildingDirection {
  const hasComplementaryEndpoints = edge.fromEndpoint
    && edge.toEndpoint
    && edge.fromEndpoint !== edge.toEndpoint
    && corridorOrientation(parent) === corridorOrientation(child);
  if (hasComplementaryEndpoints) {
    if (corridorOrientation(parent) === "vertical") return edge.fromEndpoint === "start" ? "up" : "down";
    return edge.fromEndpoint === "start" ? "left" : "right";
  }
  const bearing = ((edge.bearing % 360) + 360) % 360;
  if (bearing < 45 || bearing >= 315) return "up";
  if (bearing < 135) return "right";
  if (bearing < 225) return "down";
  return "left";
}

function oppositeDirection(direction: BuildingDirection): BuildingDirection {
  return { up: "down", right: "left", down: "up", left: "right" }[direction] as BuildingDirection;
}

function adjacentBuildingTarget(parent: Point, parentBounds: Rect, childBounds: Rect, direction: BuildingDirection): Point {
  const gap = 4;
  if (direction === "up") return { x: parent.x, y: parent.y - childBounds.height - gap };
  if (direction === "down") return { x: parent.x, y: parent.y + parentBounds.height + gap };
  if (direction === "left") return { x: parent.x - childBounds.width - gap, y: parent.y };
  return { x: parent.x + parentBounds.width + gap, y: parent.y };
}

function avoidBuildingOverlap(
  target: Point,
  bounds: Rect,
  direction: BuildingDirection,
  positions: Map<string, Point>,
  entryByBuilding: Map<string, BuildingEntry>,
): void {
  const gap = 4;
  for (let attempt = 0; attempt < positions.size + 1; attempt += 1) {
    const overlap = [...positions].find(([building, position]) => {
      const other = entryByBuilding.get(building)?.bounds;
      return other && target.x < position.x + other.width + gap
        && target.x + bounds.width + gap > position.x
        && target.y < position.y + other.height + gap
        && target.y + bounds.height + gap > position.y;
    });
    if (!overlap) return;
    const [building, position] = overlap;
    const other = entryByBuilding.get(building)?.bounds;
    if (!other) return;
    if (direction === "up" || direction === "down") target.x = position.x + other.width + gap;
    else target.y = position.y + other.height + gap;
  }
}

function boundsForBuildingPositions(
  buildings: string[],
  positions: Map<string, Point>,
  entryByBuilding: Map<string, BuildingEntry>,
): Rect {
  const positioned = buildings.flatMap((building) => {
    const point = positions.get(building);
    const bounds = entryByBuilding.get(building)?.bounds;
    return point && bounds ? [{ ...point, width: bounds.width, height: bounds.height }] : [];
  });
  const minX = Math.min(...positioned.map((rect) => rect.x));
  const minY = Math.min(...positioned.map((rect) => rect.y));
  const maxX = Math.max(...positioned.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...positioned.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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
  if (node.kind === "stairs" || node.kind === "elevator") {
    return { width: Math.max(10, node.label.length * 1.05 + 4), height: 5.8 };
  }
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
