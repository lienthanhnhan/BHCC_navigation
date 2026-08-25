import "./styles.css";
import { classifyTurn, compassLabel, findNodeId } from "./lib/graph";
import { describeRoute } from "./lib/directions";
import { findShortestPath } from "./lib/routing";
import { loadBuildingDataset } from "./lib/sampleBuilding";
import type { BuildingGraph, PathResult } from "./lib/types";
import { registerServiceWorker } from "./pwa";
import { setupAutocomplete } from "./ui/autocomplete";
import { buildingKey } from "./ui/campusLayout";
import { getRequiredElement } from "./ui/dom";
import { renderSignMap, type SignMapData } from "./ui/signMap";

type SavedState = Partial<RouteFormState>;
type RouteFormState = {
  start: string;
  goal: string;
};
type FloorMap = SignMapData;
type AppElements = {
  startInput: HTMLInputElement;
  goalInput: HTMLInputElement;
  submitButton: HTMLButtonElement;
  form: HTMLFormElement;
  status: HTMLParagraphElement;
  summary: HTMLParagraphElement;
  directionsCard: HTMLElement;
  routeLoading: HTMLDivElement;
  directionsList: HTMLOListElement;
  trace: HTMLDivElement | null;
  startSuggestions: HTMLDivElement;
  goalSuggestions: HTMLDivElement;
  mapTabs: HTMLDivElement;
  mapReset: HTMLButtonElement;
  mapVisual: HTMLDivElement;
  mapCaption: HTMLParagraphElement;
};

const storageKey = "indoor-nav-state";
const defaultStart = "Entrance";
const defaultGoal = "D-113";
const metersPerWalkingMinute = 70;

const app = getRequiredElement<HTMLDivElement>("#app");
let buildingGraph: BuildingGraph;
let elements: AppElements;
let floorMaps: FloorMap[] = [];
let currentFloorMap: FloorMap | undefined;
let currentRoute: PathResult | undefined;
let currentStartId: string | undefined;
let currentGoalId: string | undefined;

void initializeApp();

async function initializeApp(): Promise<void> {
  try {
    const dataset = await loadBuildingDataset();
    buildingGraph = dataset.graph;
    floorMaps = dataset.levels.map((level) => {
      const sourceMap = dataset.sourceMaps.find((map) => map.level === level.level);

      return {
        level: level.level,
        label: level.label,
        title: sourceMap?.title ?? level.label,
        nodes: level.nodes,
        edges: level.edges,
      };
    });

    app.innerHTML = createAppMarkup(buildingGraph);
    elements = getAppElements();

    const savedState = readState();
    elements.startInput.value = validSavedLocation(savedState.start, defaultStart);
    elements.goalInput.value = validSavedLocation(savedState.goal, defaultGoal);

    setupLocationSearch(elements.startInput, elements.startSuggestions);
    setupLocationSearch(elements.goalInput, elements.goalSuggestions);
    setupFloorMapTabs();
    setupMapControls();

    elements.form.addEventListener("submit", (event) => {
      event.preventDefault();
      runRouteWithLoading();
    });

    registerServiceWorker();
    showFloorMap(floorMaps[0]);
    runRoute();
  } catch (error) {
    app.innerHTML = `
      <main class="shell">
        <section class="card form-card">
          <p class="status" data-variant="error">Could not load the BHCC map data.</p>
        </section>
      </main>
    `;
    console.error(error);
  }
}

function getAppElements(): AppElements {
  return {
    startInput: getRequiredElement<HTMLInputElement>("#start-input"),
    goalInput: getRequiredElement<HTMLInputElement>("#goal-input"),
    submitButton: getRequiredElement<HTMLButtonElement>("#route-submit"),
    form: getRequiredElement<HTMLFormElement>("#route-form"),
    status: getRequiredElement<HTMLParagraphElement>("#status"),
    summary: getRequiredElement<HTMLParagraphElement>("#summary"),
    directionsCard: getRequiredElement<HTMLElement>("#directions-card"),
    routeLoading: getRequiredElement<HTMLDivElement>("#route-loading"),
    directionsList: getRequiredElement<HTMLOListElement>("#directions"),
    trace: document.querySelector<HTMLDivElement>("#trace"),
    startSuggestions: getRequiredElement<HTMLDivElement>("#start-suggestions"),
    goalSuggestions: getRequiredElement<HTMLDivElement>("#goal-suggestions"),
    mapTabs: getRequiredElement<HTMLDivElement>("#map-tabs"),
    mapReset: getRequiredElement<HTMLButtonElement>("#map-reset"),
    mapVisual: getRequiredElement<HTMLDivElement>("#map-visual"),
    mapCaption: getRequiredElement<HTMLParagraphElement>("#map-caption"),
  };
}

function createAppMarkup(graph: BuildingGraph): string {
  const developmentCards = import.meta.env.DEV
    ? `
        <article class="card">
          <div class="card-header">
            <h2>Route trace</h2>
            <p class="muted">Nodes, bearings, and turn logic used by the engine.</p>
          </div>
          <div id="trace" class="trace"></div>
        </article>

        <article class="card">
          <div class="card-header">
            <h2>BHCC graph</h2>
            <p class="muted">Rooms, corridors, corridor endpoints, stairs, and elevators are represented in the navigation graph.</p>
          </div>
          <ul class="meta-list">
            <li><strong>${graph.nodes.length}</strong> nodes</li>
            <li><strong>${graph.edges.length}</strong> corridor connections</li>
            <li><strong>floor-aware</strong> weights</li>
          </ul>
        </article>
      `
    : "";

  return `
    <main class="shell">
      <section class="content-intro">
        <h2>Charlestown Campus Indoor Navigation</h2>
        <p>Choose your current location and destination to view directions through the BHCC campus map.</p>
        <p><a class="editor-link" href="${import.meta.env.BASE_URL}editor.html">Open map data editor</a></p>
      </section>

      <section class="card form-card">
        <form id="route-form" class="route-form">
          ${createLocationFieldMarkup("Current location", "start", "Entrance")}
          ${createLocationFieldMarkup("Destination", "goal", "D-113")}
          <button id="route-submit" class="primary" type="submit">Find route</button>
        </form>
        <p id="status" class="status">Ready to route through the BHCC directory graph.</p>
      </section>

      <section class="grid">
        <article id="directions-card" class="card directions-card">
          <div class="card-header">
            <h2>Directions</h2>
            <p id="summary" class="muted"></p>
          </div>
          <div id="route-loading" class="route-loading" role="status" aria-live="polite" hidden>
            <span class="route-loader" aria-hidden="true"></span>
            <span>Searching new route...</span>
          </div>
          <ol id="directions" class="directions"></ol>
        </article>

        <article class="card map-card">
          <div class="card-header map-header">
            <div>
              <h2>Floor map</h2>
              <p id="map-caption" class="muted"></p>
            </div>
            <div class="map-controls">
              <div id="map-tabs" class="map-tabs" role="tablist" aria-label="Floor maps"></div>
              <button id="map-reset" class="map-reset" type="button" hidden>Show full floor</button>
            </div>
          </div>
          <div id="map-visual" class="map-frame sign-map-frame"></div>
        </article>

        ${developmentCards}
      </section>
    </main>
  `;
}

function setupFloorMapTabs(): void {
  for (const map of floorMaps) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-tab";
    button.textContent = map.label;
    button.setAttribute("role", "tab");
    button.dataset.level = String(map.level);
    button.addEventListener("click", () => showFloorMap(map));
    elements.mapTabs.append(button);
  }
}

function setupMapControls(): void {
  elements.mapReset.addEventListener("click", showFullFloorMap);
}

function showFloorMap(map: FloorMap): void {
  currentFloorMap = map;
  elements.mapCaption.textContent = map.title ?? `${map.label} simplified campus map`;
  clearDirectionSelection();

  for (const tab of elements.mapTabs.querySelectorAll<HTMLButtonElement>(".map-tab")) {
    const isSelected = tab.dataset.level === String(map.level);
    tab.setAttribute("aria-selected", String(isSelected));
  }

  renderFloorMap();
}

function renderFloorMap(): void {
  if (!currentFloorMap) {
    return;
  }

  elements.mapVisual.innerHTML = renderSignMap({
    map: currentFloorMap,
    route: currentRoute,
    startId: currentStartId,
    goalId: currentGoalId,
  });
  elements.mapReset.hidden = true;
}

function focusDirectionNode(nodeId: string, button: HTMLButtonElement): void {
  const node = buildingGraph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return;

  const floorMap = floorMaps.find((map) => map.level === node.floor);
  if (floorMap && floorMap !== currentFloorMap) showFloorMap(floorMap);

  for (const directionButton of elements.directionsList.querySelectorAll<HTMLButtonElement>(".direction-focus")) {
    directionButton.setAttribute("aria-pressed", String(directionButton === button));
  }

  focusBuilding(buildingKey(node));
  elements.mapVisual.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function focusBuilding(building: string): void {
  const svg = elements.mapVisual.querySelector<SVGSVGElement>(".sign-map");
  if (!svg) return;

  const buildingRects = [...svg.querySelectorAll<SVGGElement>(".building-plate")]
    .filter((plate) => plate.dataset.building === building)
    .map((plate) => plate.querySelector<SVGRectElement>(".floor-plate"))
    .filter((rect): rect is SVGRectElement => rect !== null);
  if (!buildingRects.length) return;

  const left = Math.min(...buildingRects.map((rect) => Number(rect.getAttribute("x"))));
  const top = Math.min(...buildingRects.map((rect) => Number(rect.getAttribute("y"))));
  const right = Math.max(...buildingRects.map((rect) => Number(rect.getAttribute("x")) + Number(rect.getAttribute("width"))));
  const bottom = Math.max(...buildingRects.map((rect) => Number(rect.getAttribute("y")) + Number(rect.getAttribute("height"))));
  const padding = Math.max(6, Math.max(right - left, bottom - top) * 0.08);

  svg.setAttribute("viewBox", `${left - padding} ${top - padding} ${right - left + padding * 2} ${bottom - top + padding * 2}`);
  svg.classList.add("is-building-focused");
  for (const plate of svg.querySelectorAll<SVGGElement>(".building-plate")) {
    plate.classList.toggle("is-focused", plate.dataset.building === building);
  }

  elements.mapCaption.textContent = `Focused on ${building} Building.`;
  elements.mapReset.hidden = false;
}

function showFullFloorMap(): void {
  if (!currentFloorMap) return;
  clearDirectionSelection();
  renderFloorMap();
  elements.mapCaption.textContent = currentFloorMap.title ?? `${currentFloorMap.label} simplified campus map`;
}

function clearDirectionSelection(): void {
  for (const button of elements.directionsList.querySelectorAll<HTMLButtonElement>(".direction-focus")) {
    button.setAttribute("aria-pressed", "false");
  }
}

function createLocationFieldMarkup(label: string, fieldName: "start" | "goal", placeholderRoom: string): string {
  return `
    <label>
      <span>${label}</span>
      <div class="autocomplete" data-autocomplete="${fieldName}">
        <input id="${fieldName}-input" name="${fieldName}" placeholder="Search rooms or services, e.g. ${placeholderRoom}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-autocomplete="list" aria-controls="${fieldName}-suggestions" aria-expanded="false" aria-haspopup="listbox" />
        <div id="${fieldName}-suggestions" class="suggestions" role="listbox" hidden></div>
      </div>
    </label>
  `;
}

function setupLocationSearch(input: HTMLInputElement, menu: HTMLDivElement): void {
  setupAutocomplete({
    graph: buildingGraph,
    input,
    menu,
    onChoose: () => input.dispatchEvent(new Event("change", { bubbles: true })),
  });
}

function runRouteWithLoading(): void {
  setRouteLoading(true);
  elements.directionsCard.scrollIntoView({ behavior: "smooth", block: "nearest" });

  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      runRoute(true);
      setRouteLoading(false);
    }, 350);
  });
}

function setRouteLoading(isLoading: boolean): void {
  elements.submitButton.disabled = isLoading;
  elements.routeLoading.hidden = !isLoading;
  elements.directionsList.toggleAttribute("aria-busy", isLoading);
  elements.trace?.toggleAttribute("aria-busy", isLoading);

  if (isLoading) {
    elements.summary.textContent = "";
    elements.directionsList.innerHTML = "";
    elements.trace?.replaceChildren();
    setStatus("Searching for a new route...", false);
  }
}

function runRoute(focusFirstInstruction = false): void {
  const state = getRouteFormState();

  saveState(state);

  const startId = findNodeId(buildingGraph, state.start);
  const goalId = findNodeId(buildingGraph, state.goal);

  currentStartId = startId;
  currentGoalId = goalId;

  if (!startId || !goalId) {
    currentRoute = undefined;
    renderFloorMap();
    showEmptyRoute("Could not match one or both locations. Try using a room code or directory name from the BHCC graph.");
    return;
  }

  const route = findShortestPath(buildingGraph, startId, goalId);

  if (!route) {
    currentRoute = undefined;
    renderFloorMap();
    showEmptyRoute("No route could be found between those locations in the BHCC graph.");
    return;
  }

  currentRoute = route;
  showRouteFloor(route);
  renderFloorMap();
  renderRoute(route, focusFirstInstruction);
}

function showRouteFloor(route: PathResult): void {
  const routeFloor = route.nodes[0]?.floor;
  const routeMap = floorMaps.find((map) => map.level === routeFloor);

  if (routeMap && routeMap !== currentFloorMap) {
    showFloorMap(routeMap);
  }
}

function getRouteFormState(): RouteFormState {
  return {
    start: elements.startInput.value.trim(),
    goal: elements.goalInput.value.trim(),
  };
}

function renderRoute(route: PathResult, focusFirstInstruction: boolean): void {
  const directions = describeRoute(buildingGraph, route);
  const estimatedMinutes = Math.max(1, Math.round(route.distance / metersPerWalkingMinute));

  setStatus("", false);
  elements.summary.textContent = `${route.distance.toFixed(1)} m estimated, about ${estimatedMinutes} min walking time.`;

  elements.directionsList.innerHTML = "";
  for (const step of directions) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const instruction = document.createElement("span");
    const distance = document.createElement("small");

    button.type = "button";
    button.className = "direction-focus";
    button.setAttribute("aria-pressed", "false");
    instruction.textContent = step.text;
    distance.textContent = step.distance > 0 ? `${step.distance.toFixed(1)} m` : "destination";
    button.append(instruction, distance);
    button.addEventListener("click", () => focusDirectionNode(step.focusNodeId, button));
    item.append(button);
    elements.directionsList.append(item);
  }

  if (focusFirstInstruction) {
    const firstInstruction = elements.directionsList.querySelector<HTMLButtonElement>(".direction-focus");
    if (firstInstruction) window.requestAnimationFrame(() => firstInstruction.click());
  }

  elements.trace?.replaceChildren();
  if (!elements.trace) {
    return;
  }

  route.nodes.forEach((node, index) => {
    const chip = document.createElement("div");
    chip.className = "trace-chip";
    chip.innerHTML = `
      <strong>${node.label}</strong>
      <span>${node.kind} • floor ${node.floor}</span>
      <span>${traceDetail(route, index)}</span>
    `;
    elements.trace.append(chip);
  });
}

function traceDetail(route: PathResult, nodeIndex: number): string {
  const previousEdge = route.edges[nodeIndex - 1];

  if (previousEdge) {
    return `bearing ${previousEdge.bearing}°`;
  }

  const node = route.nodes[nodeIndex];

  if (nodeIndex === 0) {
    return node.exitBearing !== undefined ? `${compassLabel(node.exitBearing)} exit` : "start";
  }

  if (nodeIndex < route.edges.length) {
    return classifyTurn(route.edges[nodeIndex - 1].bearing, route.edges[nodeIndex].bearing);
  }

  return "arrived";
}

function showEmptyRoute(message: string): void {
  setStatus(message, true);
  elements.directionsList.innerHTML = "";
  elements.trace?.replaceChildren();
  elements.summary.textContent = "";
}

function setStatus(message: string, isError: boolean): void {
  elements.status.textContent = message;
  elements.status.dataset.variant = isError ? "error" : "ready";
}

function readState(): SavedState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return {};
    }

    return JSON.parse(raw) as SavedState;
  } catch {
    return {};
  }
}

function saveState(state: RouteFormState): void {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function validSavedLocation(savedValue: string | undefined, fallback: string): string {
  return savedValue && findNodeId(buildingGraph, savedValue) ? savedValue : fallback;
}
