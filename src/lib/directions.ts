import { classifyTurn, compassLabel, reverseBearing } from "./graph";
import type { BuildingGraph, DirectionStep, PathResult } from "./types";

function headingText(bearing: number): string {
  return compassLabel(bearing);
}

function relationPhrase(relation: string): string {
  if (relation === "ahead") {
    return "straight ahead";
  }

  if (relation === "behind") {
    return "behind you";
  }

  return `on the ${relation}`;
}

function floorDirection(fromFloor: number, toFloor: number): string {
  if (toFloor > fromFloor) {
    return `up to floor ${toFloor}`;
  }

  if (toFloor < fromFloor) {
    return `down to floor ${toFloor}`;
  }

  return `on floor ${toFloor}`;
}

function specialEdgeText(
  kind: string,
  fromNode: { floor: number; label: string },
  toNode: { floor: number; label: string },
  relation: string,
): string {
  if (kind === "stairs") {
    return `Take the stairs ${floorDirection(fromNode.floor, toNode.floor)}`;
  }

  if (kind === "elevator") {
    return `Take the elevator ${floorDirection(fromNode.floor, toNode.floor)}`;
  }

  if (kind === "door") {
    return `Pass through ${toNode.label.replace(/^Door\s+/i, "the door ")}`;
  }

  return `Move toward ${relationPhrase(relation)} ${toNode.label}`;
}

function relationWord(fromBearing: number, toBearing: number): "left" | "right" | "ahead" | "behind" {
  const turn = classifyTurn(fromBearing, toBearing);
  if (turn === "left") return "left";
  if (turn === "right") return "right";
  if (turn === "around") return "behind";
  return "ahead";
}

function isSpecialKind(kind: string): boolean {
  return kind === "stairs" || kind === "elevator" || kind === "door";
}

export function describeRoute(graph: BuildingGraph, path: PathResult): DirectionStep[] {
  const steps: DirectionStep[] = [];
  const nodes = path.nodes;
  const edges = path.edges;

  if (!nodes.length || !edges.length) {
    return steps;
  }

  const start = nodes[0];
  const firstEdge = edges[0];
  const firstRelation = start.exitBearing ?? reverseBearing(firstEdge.bearing);
  const firstTurn = classifyTurn(firstRelation, firstEdge.bearing);

  if (start.kind === "room") {
    if (firstTurn === "left") {
      steps.push({
        text: `Turn left out of room ${start.label}`,
        distance: firstEdge.weight,
      });
    } else if (firstTurn === "right") {
      steps.push({
        text: `Turn right out of room ${start.label}`,
        distance: firstEdge.weight,
      });
    } else if (firstTurn === "around") {
      steps.push({
        text: `Turn around and leave room ${start.label}`,
        distance: firstEdge.weight,
      });
    } else {
      steps.push({
        text: `Leave room ${start.label} and continue straight`,
        distance: firstEdge.weight,
      });
    }
  } else {
    steps.push({
      text: `Head ${headingText(firstEdge.bearing)} from ${start.label}`,
      distance: firstEdge.weight,
    });
  }

  let straightRunDistance = 0;

  const flushStraightRun = (): void => {
    if (straightRunDistance <= 0) {
      return;
    }

    steps.push({
      text: "Walk to the end of the corridor",
      distance: straightRunDistance,
    });
    straightRunDistance = 0;
  };

  for (let edgeIndex = 1; edgeIndex < edges.length; edgeIndex += 1) {
    const previousEdge = edges[edgeIndex - 1];
    const currentEdge = edges[edgeIndex];
    const previousNode = nodes[edgeIndex];
    const currentNode = nodes[edgeIndex + 1];
    const turn = classifyTurn(previousEdge.bearing, currentEdge.bearing);
    const relation = relationWord(previousEdge.bearing, currentEdge.bearing);
    const currentNodeIsSpecial = Boolean(currentNode && isSpecialKind(currentNode.kind));
    const currentEdgeIsSpecial = isSpecialKind(currentEdge.kind);

    if (currentEdgeIsSpecial && currentNode) {
      flushStraightRun();
      steps.push({
        text: specialEdgeText(currentEdge.kind, previousNode, currentNode, relation),
        distance: currentEdge.weight,
      });
      continue;
    }

    if (turn === "straight" && currentNode.kind !== "room" && !currentNodeIsSpecial) {
      straightRunDistance += currentEdge.weight;
      continue;
    }

    if (currentNodeIsSpecial && currentNode) {
      steps.push({
        text: specialEdgeText(currentNode.kind, previousNode, currentNode, relation),
        distance: currentEdge.weight,
      });
      continue;
    }

    if (turn === "straight") {
      steps.push({
        text: `Continue straight toward ${currentNode?.label ?? "the next waypoint"}`,
        distance: currentEdge.weight,
      });
      continue;
    }

    if (turn === "around") {
      steps.push({
        text: `Turn around at ${previousNode.label}`,
        distance: currentEdge.weight,
      });
      continue;
    }

    steps.push({
      text: `Turn ${relation} at ${previousNode.label}`,
      distance: currentEdge.weight,
    });
  }

  flushStraightRun();

  const destination = nodes[nodes.length - 1];
  steps.push({
    text: `Arrive at ${destination.label}`,
    distance: 0,
  });

  return steps;
}
