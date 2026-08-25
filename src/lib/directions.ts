import { classifyTurn, compassLabel, reverseBearing } from "./graph";
import { isRoomLikeNode } from "./types";
import type { BuildingEdge, BuildingGraph, BuildingNode, CorridorAttachment, DirectionStep, PathResult } from "./types";

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

type CorridorDoor = {
  corridor: BuildingNode;
  room: BuildingNode;
  offset: number;
  side: CorridorAttachment;
};

const ordinalWords = [
  "",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
];

function corridorDoor(
  nodeById: Map<string, BuildingNode>,
  edge: BuildingEdge,
): CorridorDoor | undefined {
  if (typeof edge.corridorOffset !== "number" || !edge.side) return undefined;

  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);
  const corridor = from?.kind === "corridor" ? from : to?.kind === "corridor" ? to : undefined;
  const room = isRoomLikeNode(from) ? from : isRoomLikeNode(to) ? to : undefined;

  return corridor && room
    ? { corridor, room, offset: edge.corridorOffset, side: edge.side }
    : undefined;
}

function doorOrdinal(position: number): string {
  if (position < ordinalWords.length) return ordinalWords[position];

  const lastTwoDigits = position % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) return `${position}th`;

  const lastDigit = position % 10;
  const suffix = lastDigit === 1 ? "st" : lastDigit === 2 ? "nd" : lastDigit === 3 ? "rd" : "th";
  return `${position}${suffix}`;
}

function oppositeSide(side: "left" | "right"): "left" | "right" {
  return side === "left" ? "right" : "left";
}

function destinationDoorInstruction(graph: BuildingGraph, path: PathResult): string | undefined {
  const destinationEdge = path.edges.at(-1);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const destinationDoor = destinationEdge ? corridorDoor(nodeById, destinationEdge) : undefined;
  if (!destinationEdge || !destinationDoor || destinationEdge.to !== destinationDoor.room.id) return undefined;

  if (destinationDoor.side === "start" || destinationDoor.side === "end") {
    return `Continue to the end of ${destinationDoor.corridor.label}; ${destinationDoor.room.label} is straight ahead`;
  }

  const firstDoor = corridorDoor(nodeById, path.edges[0]);
  const previousEdge = path.edges.at(-2);
  let startOffset = 0;
  let movesTowardEnd = true;

  if (firstDoor?.room.id === path.nodes[0]?.id && firstDoor.corridor.id === destinationDoor.corridor.id) {
    startOffset = firstDoor.offset;
    movesTowardEnd = destinationDoor.offset >= firstDoor.offset;
  } else if (previousEdge?.to === destinationDoor.corridor.id && previousEdge.toEndpoint === "end") {
    startOffset = 100;
    movesTowardEnd = false;
  }

  const destinationOffset = destinationDoor.offset;
  const doorsAhead = graph.edges
    .map((edge) => corridorDoor(nodeById, edge))
    .filter((door): door is CorridorDoor => Boolean(
      door
      && door.corridor.id === destinationDoor.corridor.id
      && (movesTowardEnd
        ? door.offset > startOffset && door.offset <= destinationOffset
        : door.offset < startOffset && door.offset >= destinationOffset),
    ));
  const doorPosition = Math.max(1, new Set(doorsAhead.map((door) => door.room.id)).size);
  const visibleSide = movesTowardEnd ? destinationDoor.side : oppositeSide(destinationDoor.side);
  const positionText = doorPosition === 1 ? "next door" : `${doorOrdinal(doorPosition)} door ahead`;

  return `Continue along ${destinationDoor.corridor.label}; ${destinationDoor.room.label} is the ${positionText} on your ${visibleSide}`;
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
  const destinationInstruction = destinationDoorInstruction(graph, path);
  const firstRelation = start.exitBearing ?? reverseBearing(firstEdge.bearing);
  const firstTurn = classifyTurn(firstRelation, firstEdge.bearing);

  if (isRoomLikeNode(start)) {
    const departure = start.kind === "restroom" ? start.label : `room ${start.label}`;
    if (firstTurn === "left") {
      steps.push({
        text: `Turn left out of ${departure}`,
        distance: firstEdge.weight,
      });
    } else if (firstTurn === "right") {
      steps.push({
        text: `Turn right out of ${departure}`,
        distance: firstEdge.weight,
      });
    } else if (firstTurn === "around") {
      steps.push({
        text: `Turn around and leave ${departure}`,
        distance: firstEdge.weight,
      });
    } else {
      steps.push({
        text: `Leave ${departure} and continue straight`,
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

    if (destinationInstruction && edgeIndex === edges.length - 1) {
      flushStraightRun();
      steps.push({
        text: destinationInstruction,
        distance: currentEdge.weight,
      });
      continue;
    }

    if (currentEdgeIsSpecial && currentNode) {
      flushStraightRun();
      steps.push({
        text: specialEdgeText(currentEdge.kind, previousNode, currentNode, relation),
        distance: currentEdge.weight,
      });
      continue;
    }

    if (turn === "straight" && !isRoomLikeNode(currentNode) && !currentNodeIsSpecial) {
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
