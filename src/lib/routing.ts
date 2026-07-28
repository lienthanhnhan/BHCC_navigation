import { createGraphIndex } from "./graph";
import type { BuildingEdge, BuildingGraph, BuildingNode, PathResult } from "./types";

type QueueEntry = {
  nodeId: string;
  score: number;
};

type PreviousStep = {
  previousNodeId: string;
  edge: BuildingEdge;
};

function heuristic(a: BuildingNode, b: BuildingNode): number {
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  const floorPenalty = Math.abs(a.floor - b.floor) * 24;
  return distance + floorPenalty;
}

function popLowest(queue: QueueEntry[]): QueueEntry | undefined {
  if (!queue.length) {
    return undefined;
  }

  let bestIndex = 0;
  for (let index = 1; index < queue.length; index += 1) {
    if (queue[index].score < queue[bestIndex].score) {
      bestIndex = index;
    }
  }

  const [entry] = queue.splice(bestIndex, 1);
  return entry;
}

function reconstructPath(
  nodesById: Map<string, BuildingNode>,
  cameFrom: Map<string, PreviousStep>,
  startId: string,
  goal: BuildingNode,
  distance: number,
): PathResult | undefined {
  const nodes: BuildingNode[] = [goal];
  const edges: BuildingEdge[] = [];
  let cursor = goal.id;

  while (cursor !== startId) {
    const step = cameFrom.get(cursor);
    const previousNode = step ? nodesById.get(step.previousNodeId) : undefined;

    if (!step || !previousNode) {
      return undefined;
    }

    edges.unshift(step.edge);
    nodes.unshift(previousNode);
    cursor = step.previousNodeId;
  }

  return { nodes, edges, distance };
}

export function findShortestPath(
  graph: BuildingGraph,
  startId: string,
  goalId: string,
): PathResult | undefined {
  const index = createGraphIndex(graph);
  const start = index.nodeById.get(startId);
  const goal = index.nodeById.get(goalId);

  if (!start || !goal) {
    return undefined;
  }

  const openSet: QueueEntry[] = [{ nodeId: start.id, score: 0 }];
  const cameFrom = new Map<string, PreviousStep>();
  const gScore = new Map<string, number>([[start.id, 0]]);
  const closed = new Set<string>();

  while (openSet.length > 0) {
    const currentEntry = popLowest(openSet);
    if (!currentEntry) {
      break;
    }

    const currentNodeId = currentEntry.nodeId;
    if (closed.has(currentNodeId)) {
      continue;
    }

    if (currentNodeId === goal.id) {
      return reconstructPath(index.nodeById, cameFrom, start.id, goal, gScore.get(goal.id) ?? 0);
    }

    closed.add(currentNodeId);

    const outgoing = index.outgoingByNode.get(currentNodeId) ?? [];
    for (const edge of outgoing) {
      const neighborScore = (gScore.get(currentNodeId) ?? Infinity) + edge.weight;
      const currentBest = gScore.get(edge.to) ?? Infinity;

      if (neighborScore >= currentBest) {
        continue;
      }

      cameFrom.set(edge.to, { previousNodeId: currentNodeId, edge });
      gScore.set(edge.to, neighborScore);

      const neighbor = index.nodeById.get(edge.to);
      const priority = neighbor ? neighborScore + heuristic(neighbor, goal) : neighborScore;

      openSet.push({ nodeId: edge.to, score: priority });
    }
  }

  return undefined;
}
