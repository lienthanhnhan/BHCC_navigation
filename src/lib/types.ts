export type NodeKind =
  | "room"
  | "corridor"
  | "intersection"
  | "stairs"
  | "elevator"
  | "door";

export interface BuildingNode {
  id: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
  floor: number;
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
