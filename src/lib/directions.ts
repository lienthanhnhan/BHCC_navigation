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
    return `up from Level ${fromFloor} to Level ${toFloor}`;
  }

  if (toFloor < fromFloor) {
    return `down from Level ${fromFloor} to Level ${toFloor}`;
  }

  return `on Level ${toFloor}`;
}

function specialEdgeText(
  kind: string,
  fromNode: BuildingNode,
  toNode: BuildingNode,
  relation: string,
): string {
  if (kind === "stairs" || kind === "elevator") {
    const transport = kind === "stairs" ? "stairs" : "elevator";
    const specialNode = fromNode.kind === kind ? fromNode : toNode;

    if (fromNode.floor !== toNode.floor) {
      return `Take ${specialNode.label} ${floorDirection(fromNode.floor, toNode.floor)}`;
    }

    if (toNode.kind === kind) {
      return `Walk to ${toNode.label}`;
    }

    if (fromNode.kind === kind) {
      return `Exit ${fromNode.label} on Level ${toNode.floor}`;
    }

    return `Continue toward the ${transport}`;
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

function roomLandmark(node: BuildingNode): string {
  return node.kind === "restroom" ? node.label : `room ${node.label}`;
}

function navigationLandmark(node: BuildingNode | undefined): string {
  if (!node) return "the next waypoint";
  if (node.kind === "corridor") return "the next corridor junction";
  return node.label;
}

function corridorTravelBearing(corridor: BuildingNode, movesTowardEnd: boolean): number {
  if (corridor.orientation === "vertical") return movesTowardEnd ? 180 : 0;
  return movesTowardEnd ? 90 : 270;
}

function corridorEdgeOffset(edge: BuildingEdge): number | undefined {
  if (edge.fromEndpoint === "start") return 0;
  if (edge.fromEndpoint === "end") return 100;
  if (typeof edge.corridorOffset === "number") return edge.corridorOffset;
  return undefined;
}

function corridorDoors(graph: BuildingGraph, corridorId: string): CorridorDoor[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const doors = graph.edges
    .map((edge) => corridorDoor(nodeById, edge))
    .filter((door): door is CorridorDoor => door?.corridor.id === corridorId);
  return [...new Map(doors.map((door) => [door.room.id, door])).values()];
}

function nearestRoomAlongCorridor(
  graph: BuildingGraph,
  corridorId: string,
  startOffset: number,
  targetOffset: number,
  excludedRoomId?: string,
): CorridorDoor | undefined {
  const movesTowardEnd = targetOffset >= startOffset;
  return corridorDoors(graph, corridorId)
    .filter((door) => door.room.id !== excludedRoomId)
    .filter((door) => movesTowardEnd
      ? door.offset > startOffset && door.offset <= targetOffset
      : door.offset < startOffset && door.offset >= targetOffset)
    .sort((left, right) => Math.abs(left.offset - startOffset) - Math.abs(right.offset - startOffset))[0];
}

function nearestRoomAtCorridorPoint(
  graph: BuildingGraph,
  corridorId: string,
  offset: number,
): CorridorDoor | undefined {
  return corridorDoors(graph, corridorId)
    .sort((left, right) => Math.abs(left.offset - offset) - Math.abs(right.offset - offset))[0];
}

function departureInstruction(graph: BuildingGraph, path: PathResult): string | undefined {
  const start = path.nodes[0];
  const firstEdge = path.edges[0];
  const nextEdge = path.edges[1];
  if (!isRoomLikeNode(start) || !firstEdge || !nextEdge) return undefined;

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const startDoor = corridorDoor(nodeById, firstEdge);
  if (!startDoor || startDoor.room.id !== start.id || nextEdge.from !== startDoor.corridor.id) return undefined;

  const targetOffset = corridorEdgeOffset(nextEdge);
  if (targetOffset === undefined || targetOffset === startDoor.offset) return undefined;
  const movesTowardEnd = targetOffset > startDoor.offset;
  const travelBearing = corridorTravelBearing(startDoor.corridor, movesTowardEnd);
  const turn = classifyTurn(firstEdge.bearing, travelBearing);
  const landmark = nearestRoomAlongCorridor(
    graph,
    startDoor.corridor.id,
    startDoor.offset,
    targetOffset,
    start.id,
  );
  const toward = landmark ? ` toward ${roomLandmark(landmark.room)}` : " along the corridor";
  const departure = roomLandmark(start);

  if (turn === "left" || turn === "right") return `Go ${turn} from ${departure}${toward}`;
  if (turn === "around") return `Turn around after leaving ${departure}, then continue${toward}`;
  return `Leave ${departure} and walk straight${toward}`;
}

function corridorTurnLocation(graph: BuildingGraph, corridor: BuildingNode, edge: BuildingEdge): string {
  const offset = corridorEdgeOffset(edge);
  if (offset === undefined) return "at the corridor junction";
  const landmark = nearestRoomAtCorridorPoint(graph, corridor.id, offset);
  if (landmark) return `near ${roomLandmark(landmark.room)}`;
  if (offset === 0 || offset === 100) return "at the end of the corridor";
  return "at the corridor junction";
}

function destinationDoorInstruction(graph: BuildingGraph, path: PathResult): string | undefined {
  const destinationEdge = path.edges.at(-1);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const destinationDoor = destinationEdge ? corridorDoor(nodeById, destinationEdge) : undefined;
  if (!destinationEdge || !destinationDoor || destinationEdge.to !== destinationDoor.room.id) return undefined;

  if (destinationDoor.side === "start" || destinationDoor.side === "end") {
    return `Continue to the end of the corridor; ${destinationDoor.room.label} is straight ahead`;
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

  return `Continue along the corridor; ${destinationDoor.room.label} is the ${positionText} on your ${visibleSide}`;
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
  const addStep = (text: string, distance: number, focusNode: BuildingNode): void => {
    steps.push({ text, distance, focusNodeId: focusNode.id });
  };

  if (isRoomLikeNode(start)) {
    const landmarkDeparture = departureInstruction(graph, path);
    const departure = roomLandmark(start);
    if (landmarkDeparture) {
      addStep(landmarkDeparture, firstEdge.weight, start);
    } else if (firstTurn === "left") {
      addStep(`Turn left out of ${departure}`, firstEdge.weight, start);
    } else if (firstTurn === "right") {
      addStep(`Turn right out of ${departure}`, firstEdge.weight, start);
    } else if (firstTurn === "around") {
      addStep(`Turn around and leave ${departure}`, firstEdge.weight, start);
    } else {
      addStep(`Leave ${departure} and continue straight`, firstEdge.weight, start);
    }
  } else {
    addStep(`Head ${headingText(firstEdge.bearing)} from ${navigationLandmark(start)}`, firstEdge.weight, start);
  }

  let straightRunDistance = 0;
  let straightRunFocusNode = start;

  const flushStraightRun = (landmark?: BuildingNode): void => {
    if (straightRunDistance <= 0) {
      return;
    }

    const text = landmark?.kind === "stairs" || landmark?.kind === "elevator"
      ? `Continue along the hallway toward ${landmark.label}`
      : "Continue along the hallway";
    addStep(text, straightRunDistance, straightRunFocusNode);
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
      addStep(destinationInstruction, currentEdge.weight, currentNode ?? previousNode);
      continue;
    }

    if (currentEdgeIsSpecial && currentNode) {
      flushStraightRun(currentNode);
      addStep(specialEdgeText(currentEdge.kind, previousNode, currentNode, relation), currentEdge.weight, currentNode);
      continue;
    }

    if (turn === "straight" && !isRoomLikeNode(currentNode) && !currentNodeIsSpecial) {
      if (straightRunDistance === 0) {
        straightRunFocusNode = previousNode ?? start;
      }
      straightRunDistance += currentEdge.weight;
      continue;
    }

    if (currentNodeIsSpecial && currentNode) {
      addStep(specialEdgeText(currentNode.kind, previousNode, currentNode, relation), currentEdge.weight, currentNode);
      continue;
    }

    if (turn === "straight") {
      addStep(`Continue straight toward ${navigationLandmark(currentNode)}`, currentEdge.weight, currentNode ?? previousNode);
      continue;
    }

    const turnLocation = previousNode?.kind === "corridor"
      ? corridorTurnLocation(graph, previousNode, currentEdge)
      : `at ${previousNode.label}`;

    if (turn === "around") {
      addStep(`Turn around ${turnLocation}`, currentEdge.weight, previousNode);
      continue;
    }

    addStep(`Turn ${relation} ${turnLocation}`, currentEdge.weight, previousNode);
  }

  flushStraightRun();

  const destination = nodes[nodes.length - 1];
  addStep(`Arrive at ${destination.label}`, 0, destination);

  return steps;
}
