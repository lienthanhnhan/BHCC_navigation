import { createGraphIndex } from "./graph";
import type { BuildingGraph, BuildingNode, PathResult } from "./types";

type QueueEntry = {
  nodeId: string;
  score: number;
};

function heuristic(a: BuildingNode, b: BuildingNode): number {
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  const floorPenalty = Math.abs(a.floor - b.floor) * 24;
  return distance + floorPenalty;
}

function popLowest(queue: QueueEntry[]): QueueEntry | undefined {
  let bestIndex = 0;
  for (let index = 1; index < queue.length; index += 1) {
    if (queue[index].score < queue[bestIndex].score) {
      bestIndex = index;
    }
  }

  if (!queue.length) {
    return undefined;
  }

  const [entry] = queue.splice(bestIndex, 1);
  return entry;
}

export function findShortestPath(
  graph: BuildingGraph,
  startId: string,
  goalId: string,
  algorithm: "astar" | "dijkstra" = "astar",
): PathResult | undefined {
  const index = createGraphIndex(graph);
  const start = index.nodeById.get(startId);
  const goal = index.nodeById.get(goalId);

  if (!start || !goal) {
    return undefined;
  }

  const openSet: QueueEntry[] = [{ nodeId: start.id, score: 0 }];
  const cameFrom = new Map<string, { previousNodeId: string; edgeId: string }>();
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
      const nodes: BuildingNode[] = [goal];
      const edges = [] as PathResult["edges"];
      let cursor = goal.id;

      while (cursor !== start.id) {
        const step = cameFrom.get(cursor);
        if (!step) {
          return undefined;
        }

        const edge = graph.edges.find((candidate) => candidate.id === step.edgeId);
        const node = index.nodeById.get(step.previousNodeId);

        if (!edge || !node) {
          return undefined;
        }

        edges.unshift(edge);
        nodes.unshift(node);
        cursor = step.previousNodeId;
      }

      return {
        nodes,
        edges,
        distance: gScore.get(goal.id) ?? 0,
      };
    }

    closed.add(currentNodeId);

    const outgoing = index.outgoingByNode.get(currentNodeId) ?? [];
    for (const edge of outgoing) {
      const neighborScore = (gScore.get(currentNodeId) ?? Infinity) + edge.weight;
      const currentBest = gScore.get(edge.to) ?? Infinity;

      if (neighborScore >= currentBest) {
        continue;
      }

      cameFrom.set(edge.to, { previousNodeId: currentNodeId, edgeId: edge.id });
      gScore.set(edge.to, neighborScore);

      const neighbor = index.nodeById.get(edge.to);
      const priority = neighbor
        ? neighborScore + (algorithm === "astar" ? heuristic(neighbor, goal) : 0)
        : neighborScore;

      openSet.push({ nodeId: edge.to, score: priority });
    }
  }

  return undefined;
}
