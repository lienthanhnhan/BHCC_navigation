import "./styles.css";
import { classifyTurn, compassLabel, findNodeId } from "./lib/graph";
import { describeRoute } from "./lib/directions";
import { findShortestPath } from "./lib/routing";
import { loadBuildingDataset } from "./lib/sampleBuilding";
import type { BuildingGraph, PathResult } from "./lib/types";
import { registerServiceWorker } from "./pwa";
import { setupAutocomplete } from "./ui/autocomplete";
import { getRequiredElement } from "./ui/dom";

type SavedState = Partial<RouteFormState>;
type RouteFormState = {
  start: string;
  goal: string;
};
type FloorMap = {
  level: number;
  label: string;
  src: string;
  title?: string;
};
type AppElements = {
  startInput: HTMLInputElement;
  goalInput: HTMLInputElement;
  submitButton: HTMLButtonElement;
  form: HTMLFormElement;
  status: HTMLParagraphElement;
  summary: HTMLParagraphElement;
  routeLoading: HTMLDivElement;
  directionsList: HTMLOListElement;
  trace: HTMLDivElement;
  startSuggestions: HTMLDivElement;
  goalSuggestions: HTMLDivElement;
  mapTabs: HTMLDivElement;
  mapImage: HTMLImageElement;
  mapCaption: HTMLParagraphElement;
};

const storageKey = "indoor-nav-state";
const defaultStart = "N-111";
const defaultGoal = "E-229";
const metersPerWalkingMinute = 70;

const app = getRequiredElement<HTMLDivElement>("#app");
let buildingGraph: BuildingGraph;
let elements: AppElements;
let floorMaps: FloorMap[] = [];

void initializeApp();

async function initializeApp(): Promise<void> {
  try {
    const dataset = await loadBuildingDataset();
    buildingGraph = dataset.graph;
    floorMaps = dataset.sourceMaps.map((map) => ({
      level: map.level,
      label: map.label,
      title: map.title,
      src: `${import.meta.env.BASE_URL}${map.file}`,
    }));

    app.innerHTML = createAppMarkup(buildingGraph);
    elements = getAppElements();

    const savedState = readState();
    elements.startInput.value = validSavedLocation(savedState.start, defaultStart);
    elements.goalInput.value = validSavedLocation(savedState.goal, defaultGoal);

    setupLocationSearch(elements.startInput, elements.startSuggestions);
    setupLocationSearch(elements.goalInput, elements.goalSuggestions);
    setupFloorMapTabs();

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
    routeLoading: getRequiredElement<HTMLDivElement>("#route-loading"),
    directionsList: getRequiredElement<HTMLOListElement>("#directions"),
    trace: getRequiredElement<HTMLDivElement>("#trace"),
    startSuggestions: getRequiredElement<HTMLDivElement>("#start-suggestions"),
    goalSuggestions: getRequiredElement<HTMLDivElement>("#goal-suggestions"),
    mapTabs: getRequiredElement<HTMLDivElement>("#map-tabs"),
    mapImage: getRequiredElement<HTMLImageElement>("#map-image"),
    mapCaption: getRequiredElement<HTMLParagraphElement>("#map-caption"),
  };
}

function createAppMarkup(graph: BuildingGraph): string {
  return `
    <main class="shell">
      <section class="card form-card">
        <form id="route-form" class="route-form">
          ${createLocationFieldMarkup("Current location", "start", "N-111")}
          ${createLocationFieldMarkup("Destination", "goal", "E-229")}
          <button id="route-submit" class="primary" type="submit">Find route</button>
        </form>
        <p id="status" class="status">Ready to route through the BHCC directory graph.</p>
      </section>

      <section class="grid">
        <article class="card map-card">
          <div class="card-header map-header">
            <div>
              <h2>Floor map</h2>
              <p id="map-caption" class="muted"></p>
            </div>
            <div id="map-tabs" class="map-tabs" role="tablist" aria-label="Floor maps"></div>
          </div>
          <div class="map-frame">
            <img id="map-image" alt="Selected BHCC floor map" />
          </div>
        </article>

        <article class="card directions-card">
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
          <p class="muted">Rooms, floor cores, corridor connectors, stairs, and elevators are represented as graph vertices.</p>
          </div>
          <ul class="meta-list">
            <li><strong>${graph.nodes.length}</strong> nodes</li>
            <li><strong>${graph.edges.length}</strong> directed edges</li>
            <li><strong>floor-aware</strong> weights</li>
          </ul>
        </article>
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

function showFloorMap(map: FloorMap): void {
  elements.mapImage.src = map.src;
  elements.mapImage.alt = `${map.label} BHCC floor map`;
  elements.mapCaption.textContent = map.title ?? `${map.label} drawn campus map`;

  for (const tab of elements.mapTabs.querySelectorAll<HTMLButtonElement>(".map-tab")) {
    const isSelected = tab.dataset.level === String(map.level);
    tab.setAttribute("aria-selected", String(isSelected));
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

  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      runRoute();
      setRouteLoading(false);
    }, 350);
  });
}

function setRouteLoading(isLoading: boolean): void {
  elements.submitButton.disabled = isLoading;
  elements.routeLoading.hidden = !isLoading;
  elements.directionsList.toggleAttribute("aria-busy", isLoading);
  elements.trace.toggleAttribute("aria-busy", isLoading);

  if (isLoading) {
    elements.summary.textContent = "";
    elements.directionsList.innerHTML = "";
    elements.trace.innerHTML = "";
    setStatus("Searching for a new route...", false);
  }
}

function runRoute(): void {
  const state = getRouteFormState();

  saveState(state);

  const startId = findNodeId(buildingGraph, state.start);
  const goalId = findNodeId(buildingGraph, state.goal);

  if (!startId || !goalId) {
    showEmptyRoute("Could not match one or both locations. Try using a room code or directory name from the BHCC graph.");
    return;
  }

  const route = findShortestPath(buildingGraph, startId, goalId);

  if (!route) {
    showEmptyRoute("No route could be found between those locations in the BHCC graph.");
    return;
  }

  renderRoute(route);
}

function getRouteFormState(): RouteFormState {
  return {
    start: elements.startInput.value.trim(),
    goal: elements.goalInput.value.trim(),
  };
}

function renderRoute(route: PathResult): void {
  const directions = describeRoute(buildingGraph, route);
  const estimatedMinutes = Math.max(1, Math.round(route.distance / metersPerWalkingMinute));

  setStatus("Route found using A*.", false);
  elements.summary.textContent = `${route.distance.toFixed(1)} m estimated, about ${estimatedMinutes} min walking time.`;

  elements.directionsList.innerHTML = "";
  for (const step of directions) {
    const item = document.createElement("li");
    item.innerHTML = `
      <span>${step.text}</span>
      <small>${step.distance > 0 ? `${step.distance.toFixed(1)} m` : "destination"}</small>
    `;
    elements.directionsList.append(item);
  }

  elements.trace.innerHTML = "";
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
  elements.trace.innerHTML = "";
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
