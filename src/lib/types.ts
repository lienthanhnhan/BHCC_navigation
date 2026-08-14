export type NodeKind =
  | "room"
  | "corridor"
  | "stairs"
  | "elevator"
  | "door";

export type CorridorEndpoint = "start" | "end";

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

export interface BuildingEdge {
  id: string;
  from: string;
  to: string;
  weight: number;
  bearing: number;
  kind: "walk" | "stairs" | "elevator" | "door";
  bidirectional?: boolean;
  fromEndpoint?: CorridorEndpoint;
  toEndpoint?: CorridorEndpoint;
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
}
