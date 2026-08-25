export type NodeKind =
  | "room"
  | "restroom"
  | "corridor"
  | "stairs"
  | "elevator"
  | "door";

export type CorridorEndpoint = "start" | "end";
export type CorridorAttachment = "left" | "right" | "start" | "end";

export interface BuildingNode {
  id: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
  floor: number;
  orientation?: "horizontal" | "vertical";
  aliases?: string[];
  exitBearing?: number;
}

export function isRoomLikeNode(node: BuildingNode | undefined): node is BuildingNode {
  return node?.kind === "room" || node?.kind === "restroom";
}

export interface BuildingEdge {
  id: string;
  from: string;
  to: string;
  weight: number;
  bearing: number;
  kind: "walk" | "stairs" | "elevator" | "door";
  bidirectional?: boolean;
  fromEndpoint?: CorridorEndpoint;
  /** Omit for a perpendicular corridor whose center side joins the parent corridor cap. */
  toEndpoint?: CorridorEndpoint;
  /** Position along the parent corridor, from 0 at start to 100 at end. */
  corridorOffset?: number;
  /** Wall or cap used by a room door, or by the child corridor in a corridor-to-corridor edge. */
  side?: CorridorAttachment;
  label?: string;
}

export interface BuildingGraph {
  nodes: BuildingNode[];
  edges: BuildingEdge[];
}

export interface PathResult {
  nodes: BuildingNode[];
  edges: BuildingEdge[];
  distance: number;
}

export interface DirectionStep {
  text: string;
  distance: number;
  focusNodeId: string;
}
