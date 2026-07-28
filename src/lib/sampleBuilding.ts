import type { BuildingGraph } from "./types";

export interface FloorMapData {
  level: number;
  file: string;
  originalFile: string;
  label: string;
  title?: string;
}

export interface BuildingLevelData {
  level: number;
  label: string;
  mapFile: string;
  nodes: BuildingGraph["nodes"];
  edges: BuildingGraph["edges"];
}

export interface BuildingDataset {
  schemaVersion: number;
  name: string;
  title?: string;
  sourceMaps: FloorMapData[];
  levels: BuildingLevelData[];
  graph: BuildingGraph;
}

export async function loadBuildingDataset(): Promise<BuildingDataset> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/levels-1-2.json`);

  if (!response.ok) {
    throw new Error(`Could not load building data: ${response.status}`);
  }

  return response.json() as Promise<BuildingDataset>;
}
