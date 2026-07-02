import type { BuildingEdge, BuildingGraph, BuildingNode } from "./types";

export interface GraphIndex {
  nodeById: Map<string, BuildingNode>;
  outgoingByNode: Map<string, BuildingEdge[]>;
}

export interface LocationSuggestion {
  id: string;
  label: string;
  detail: string;
  score: number;
}

export function createGraphIndex(graph: BuildingGraph): GraphIndex {
  const nodeById = new Map<string, BuildingNode>();
  const outgoingByNode = new Map<string, BuildingEdge[]>();

  for (const node of graph.nodes) {
    nodeById.set(node.id, node);
    outgoingByNode.set(node.id, []);
  }

  for (const edge of graph.edges) {
    const outgoing = outgoingByNode.get(edge.from);
    if (outgoing) {
      outgoing.push(edge);
    }
  }

  return { nodeById, outgoingByNode };
}

export function normalizeLocation(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function findNodeId(graph: BuildingGraph, query: string): string | undefined {
  const normalizedQuery = normalizeLocation(query);
  if (!normalizedQuery) {
    return undefined;
  }

  for (const node of graph.nodes) {
    if (normalizeLocation(node.id) === normalizedQuery) {
      return node.id;
    }

    if (normalizeLocation(node.label) === normalizedQuery) {
      return node.id;
    }

    if (node.aliases?.some((alias) => normalizeLocation(alias) === normalizedQuery)) {
      return node.id;
    }
  }

  return undefined;
}

function scoreMatch(query: string, candidate: string): number | undefined {
  if (candidate === query) {
    return 0;
  }

  if (candidate.startsWith(query)) {
    return 1;
  }

  if (candidate.includes(query)) {
    return 2;
  }

  return undefined;
}

export function searchLocations(graph: BuildingGraph, query: string, limit = 6): LocationSuggestion[] {
  const normalizedQuery = normalizeLocation(query);
  if (!normalizedQuery) {
    return [];
  }

  const suggestions: LocationSuggestion[] = [];

  for (const node of graph.nodes) {
    const candidates = [node.label, node.id, ...(node.aliases ?? [])];
    let bestScore: number | undefined;
    let bestDetail = node.kind;

    for (const candidate of candidates) {
      const normalizedCandidate = normalizeLocation(candidate);
      const score = scoreMatch(normalizedQuery, normalizedCandidate);
      if (score === undefined) {
        continue;
      }

      if (bestScore === undefined || score < bestScore) {
        bestScore = score;
        bestDetail = candidate;
      }
    }

    if (bestScore === undefined) {
      continue;
    }

    suggestions.push({
      id: node.id,
      label: node.label,
      detail: bestDetail === node.label || bestDetail === node.id ? `${node.kind} • floor ${node.floor}` : bestDetail,
      score: bestScore,
    });
  }

  return suggestions
    .sort((left, right) => left.score - right.score || left.label.localeCompare(right.label))
    .slice(0, limit);
}

export function bearingDelta(fromBearing: number, toBearing: number): number {
  const delta = ((toBearing - fromBearing) % 360 + 360) % 360;
  return delta;
}

export function classifyTurn(fromBearing: number, toBearing: number): "straight" | "left" | "right" | "around" {
  const delta = bearingDelta(fromBearing, toBearing);

  if (delta <= 35 || delta >= 325) {
    return "straight";
  }

  if (delta < 180) {
    return "right";
  }

  if (delta > 180) {
    return "left";
  }

  return "around";
}

export function reverseBearing(bearing: number): number {
  return (bearing + 180) % 360;
}

export function compassLabel(bearing: number): string {
  const normalized = ((bearing % 360) + 360) % 360;
  if (normalized < 22.5 || normalized >= 337.5) return "north";
  if (normalized < 67.5) return "northeast";
  if (normalized < 112.5) return "east";
  if (normalized < 157.5) return "southeast";
  if (normalized < 202.5) return "south";
  if (normalized < 247.5) return "southwest";
  if (normalized < 292.5) return "west";
  return "northwest";
}
