import type { BuildingGraph } from "./types";

const editorDatasetStorageKey = "bhcc-map-editor-dataset-v5";

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

interface SavedDataset {
  baseFingerprint: string;
  dataset: BuildingDatasetFile;
}

export interface BuildingDataset extends BuildingDatasetFile {
  graph: BuildingGraph;
}

export async function loadBuildingDataset(): Promise<BuildingDataset> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/levels-1-2.json`);

  if (!response.ok) {
    throw new Error(`Could not load building data: ${response.status}`);
  }

  const baseDataset = await response.json() as BuildingDatasetFile;
  const savedDataset = readSavedDataset(baseDataset);

  if (savedDataset) {
    try {
      return { ...savedDataset, graph: buildGraph(savedDataset) };
    } catch {
      window.localStorage.removeItem(editorDatasetStorageKey);
    }
  }

  return { ...baseDataset, graph: buildGraph(baseDataset) };
}

function readSavedDataset(baseDataset: BuildingDatasetFile): BuildingDatasetFile | undefined {
  try {
    const savedJson = window.localStorage.getItem(editorDatasetStorageKey);
    if (!savedJson) return undefined;

    const saved = JSON.parse(savedJson) as SavedDataset;
    if (saved.baseFingerprint !== datasetFingerprint(baseDataset) || !Array.isArray(saved.dataset?.levels)) {
      window.localStorage.removeItem(editorDatasetStorageKey);
      return undefined;
    }
    return saved.dataset;
  } catch {
    window.localStorage.removeItem(editorDatasetStorageKey);
    return undefined;
  }
}

function datasetFingerprint(dataset: BuildingDatasetFile): string {
  const json = JSON.stringify(dataset);
  let hash = 5381;

  for (let index = 0; index < json.length; index += 1) {
    hash = ((hash << 5) + hash) ^ json.charCodeAt(index);
  }

  return `${dataset.schemaVersion}-${hash >>> 0}`;
}

function buildGraph(dataset: BuildingDatasetFile): BuildingGraph {
  const nodes = dataset.levels.flatMap((level) => level.nodes);
  const edges = [...dataset.levels.flatMap((level) => level.edges), ...dataset.crossLevelEdges];
  const nodeIds = new Set<string>();
  const nodeLabels = new Set<string>();

  for (const level of dataset.levels) {
    for (const node of level.nodes) {
      if (node.floor !== level.level) {
        throw new Error(`${node.id} says floor ${node.floor}, but is stored in Level ${level.level}.`);
      }
      if (nodeIds.has(node.id)) {
        throw new Error(`Duplicate node ID: ${node.id}`);
      }
      const normalizedLabel = node.label.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!normalizedLabel) {
        throw new Error(`${node.id} is missing a label.`);
      }
      if (nodeLabels.has(normalizedLabel)) {
        throw new Error(`Duplicate node label: ${node.label}`);
      }
      nodeIds.add(node.id);
      nodeLabels.add(normalizedLabel);
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
