import type { BuildingGraph } from "./types";

export interface FloorMapData {
  level: number;
  originalFile: string;
  title?: string;
}

export interface BuildingLevelData {
  level: number;
  label: string;
  nodes: BuildingGraph["nodes"];
  edges: BuildingGraph["edges"];
}

interface BuildingDatasetFile {
  schemaVersion: number;
  name: string;
  sourceMaps: FloorMapData[];
  levels: BuildingLevelData[];
  crossLevelEdges: BuildingGraph["edges"];
}

export interface BuildingDataset extends BuildingDatasetFile {
  graph: BuildingGraph;
}

export async function loadBuildingDataset(): Promise<BuildingDataset> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/levels-1-2.json`);

  if (!response.ok) {
    throw new Error(`Could not load building data: ${response.status}`);
  }

  const dataset = await response.json() as BuildingDatasetFile;
  return { ...dataset, graph: buildGraph(dataset) };
}

function buildGraph(dataset: BuildingDatasetFile): BuildingGraph {
  const nodes = dataset.levels.flatMap((level) => level.nodes);
  const edges = [...dataset.levels.flatMap((level) => level.edges), ...dataset.crossLevelEdges];
  const nodeIds = new Set<string>();

  for (const level of dataset.levels) {
    for (const node of level.nodes) {
      if (node.floor !== level.level) {
        throw new Error(`${node.id} says floor ${node.floor}, but is stored in Level ${level.level}.`);
      }
      if (nodeIds.has(node.id)) {
        throw new Error(`Duplicate node ID: ${node.id}`);
      }
      nodeIds.add(node.id);
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) {
      throw new Error(`Duplicate connection ID: ${edge.id}`);
    }
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error(`${edge.id} refers to a node that does not exist.`);
    }
    edgeIds.add(edge.id);
  }

  return { nodes, edges };
}
