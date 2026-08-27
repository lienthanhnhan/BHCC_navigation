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
type MapViewBox = { x: number; y: number; width: number; height: number };
type MapPanState = {
  pointerId: number;
  svg: SVGSVGElement;
  clientX: number;
  clientY: number;
  originX: number;
  originY: number;
  hasMoved: boolean;
};
type MapTouchPoint = {
  svg: SVGSVGElement;
  clientX: number;
  clientY: number;
};
type MapPinchState = {
  svg: SVGSVGElement;
  startDistance: number;
  startMidpoint: { x: number; y: number };
  mapPoint: DOMPoint;
  startViewBox: MapViewBox;
};
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
  mapCanvas: HTMLDivElement;
  mapZoomIn: HTMLButtonElement;
  mapZoomOut: HTMLButtonElement;
  mapReset: HTMLButtonElement;
  mapVisual: HTMLDivElement;
  mapCaption: HTMLParagraphElement;
  shareDirections: HTMLButtonElement;
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
let mapPanState: MapPanState | undefined;
let mapPinchState: MapPinchState | undefined;
const mapTouchPoints = new Map<number, MapTouchPoint>();

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

    const queryState = readRouteQueryState();
    const savedState = readState();
    elements.startInput.value = validRouteLocation(queryState.start, validRouteLocation(savedState.start, defaultStart));
    elements.goalInput.value = validRouteLocation(queryState.goal, validRouteLocation(savedState.goal, defaultGoal));

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
    mapCanvas: getRequiredElement<HTMLDivElement>("#map-canvas"),
    mapZoomIn: getRequiredElement<HTMLButtonElement>("#map-zoom-in"),
    mapZoomOut: getRequiredElement<HTMLButtonElement>("#map-zoom-out"),
    mapReset: getRequiredElement<HTMLButtonElement>("#map-reset"),
    mapVisual: getRequiredElement<HTMLDivElement>("#map-visual"),
    mapCaption: getRequiredElement<HTMLParagraphElement>("#map-caption"),
    shareDirections: getRequiredElement<HTMLButtonElement>("#share-directions"),
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
          <div class="card-header directions-header">
            <div>
              <h2>Directions</h2>
              <p id="summary" class="muted"></p>
            </div>
            <button id="share-directions" class="share-directions" type="button" aria-label="Share directions" title="Share directions" disabled>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M18 8a3 3 0 1 0-2.83-4A3 3 0 0 0 15.17 5L8.9 8.14a3 3 0 1 0 0 7.72L15.17 19A3 3 0 1 0 16.06 17l-6.27-3.14a3.1 3.1 0 0 0 0-3.72L16.06 7A3 3 0 0 0 18 8Z" />
              </svg>
              <span class="visually-hidden">Share directions</span>
            </button>
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
          <div id="map-visual" class="map-visual">
            <div id="map-canvas" class="map-frame sign-map-frame"></div>
            <div class="map-zoom-controls" aria-label="Map zoom controls">
              <button id="map-zoom-in" type="button" aria-label="Zoom in" title="Zoom in">+</button>
              <button id="map-zoom-out" type="button" aria-label="Zoom out" title="Zoom out">−</button>
            </div>
          </div>
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
  elements.mapZoomIn.addEventListener("click", zoomInMap);
  elements.mapZoomOut.addEventListener("click", zoomOutMap);
  elements.mapReset.addEventListener("click", showFullFloorMap);
  elements.shareDirections.addEventListener("click", shareDirections);
  elements.mapCanvas.addEventListener("dblclick", zoomMapAtPointer);
  elements.mapCanvas.addEventListener("wheel", panMapWithWheel, { passive: false });
  elements.mapCanvas.addEventListener("pointerdown", startMapPan);
  elements.mapCanvas.addEventListener("pointermove", moveMapPan);
  elements.mapCanvas.addEventListener("pointerup", finishMapPan);
  elements.mapCanvas.addEventListener("pointercancel", finishMapPan);
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

  mapPanState = undefined;
  mapPinchState = undefined;
  mapTouchPoints.clear();
  elements.mapCanvas.innerHTML = renderSignMap({
    map: currentFloorMap,
    route: currentRoute,
    startId: currentStartId,
    goalId: currentGoalId,
  });
  const svg = elements.mapVisual.querySelector<SVGSVGElement>(".sign-map");
  if (svg) svg.dataset.fullViewBox = svg.getAttribute("viewBox") ?? "";
  setMapZoomControls(false);
}

function zoomMapAtPointer(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const svg = target.closest<SVGSVGElement>(".sign-map");
  const screenMatrix = svg?.getScreenCTM();
  if (!svg || !screenMatrix) return;

  const fullViewBox = parseViewBox(svg.dataset.fullViewBox);
  const currentViewBox = svg.viewBox.baseVal;
  if (!fullViewBox || currentViewBox.width <= fullViewBox.width * 0.08) return;

  event.preventDefault();
  const pointer = svg.createSVGPoint();
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  const mapPoint = pointer.matrixTransform(screenMatrix.inverse());
  const scale = Math.max(0.08 * fullViewBox.width / currentViewBox.width, 0.62);
  const width = currentViewBox.width * scale;
  const height = currentViewBox.height * scale;
  const x = clampMapPosition(
    mapPoint.x - (mapPoint.x - currentViewBox.x) * scale,
    fullViewBox.x,
    fullViewBox.x + fullViewBox.width - width,
  );
  const y = clampMapPosition(
    mapPoint.y - (mapPoint.y - currentViewBox.y) * scale,
    fullViewBox.y,
    fullViewBox.y + fullViewBox.height - height,
  );

  svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  svg.classList.add("is-map-zoomed");
  setMapZoomControls(true);
}

function zoomInMap(): void {
  const svg = elements.mapCanvas.querySelector<SVGSVGElement>(".sign-map");
  const fullViewBox = svg ? parseViewBox(svg.dataset.fullViewBox) : undefined;
  if (!svg || !fullViewBox) return;

  const current = copyViewBox(svg.viewBox.baseVal);
  const scale = 0.62;
  const width = current.width * scale;
  const height = current.height * scale;
  const minimumWidth = fullViewBox.width * 0.08;
  const minimumHeight = fullViewBox.height * 0.08;
  if (width < minimumWidth || height < minimumHeight) return;

  const x = clampMapPosition(
    current.x + (current.width - width) / 2,
    fullViewBox.x,
    fullViewBox.x + fullViewBox.width - width,
  );
  const y = clampMapPosition(
    current.y + (current.height - height) / 2,
    fullViewBox.y,
    fullViewBox.y + fullViewBox.height - height,
  );

  svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  svg.classList.add("is-map-zoomed");
  setMapZoomControls(true);
}

function zoomOutMap(): void {
  const svg = elements.mapCanvas.querySelector<SVGSVGElement>(".sign-map");
  const fullViewBox = svg ? parseViewBox(svg.dataset.fullViewBox) : undefined;
  if (!svg || !fullViewBox || !isMapZoomed(svg)) return;

  const current = copyViewBox(svg.viewBox.baseVal);
  const scale = 1.5;
  if (current.width * scale >= fullViewBox.width || current.height * scale >= fullViewBox.height) {
    restoreFullMapView(svg, fullViewBox);
    return;
  }

  const width = current.width * scale;
  const height = current.height * scale;
  const centerX = current.x + current.width / 2;
  const centerY = current.y + current.height / 2;
  const x = clampMapPosition(centerX - width / 2, fullViewBox.x, fullViewBox.x + fullViewBox.width - width);
  const y = clampMapPosition(centerY - height / 2, fullViewBox.y, fullViewBox.y + fullViewBox.height - height);
  svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
}

function panMapWithWheel(event: WheelEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const svg = target.closest<SVGSVGElement>(".sign-map");
  if (!svg || !isMapZoomed(svg)) return;

  const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? svg.getBoundingClientRect().height
      : 1;
  const deltaX = (event.shiftKey ? event.deltaY : event.deltaX) * deltaScale;
  const deltaY = (event.shiftKey ? 0 : event.deltaY) * deltaScale;
  if (panMapByPixels(svg, deltaX, deltaY)) event.preventDefault();
}

function startMapPan(event: PointerEvent): void {
  if (event.button !== 0) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const svg = target.closest<SVGSVGElement>(".sign-map");
  if (!svg) return;

  if (event.pointerType === "touch") {
    mapTouchPoints.set(event.pointerId, { svg, clientX: event.clientX, clientY: event.clientY });
    const touches = touchesForMap(svg);
    if (touches.length === 2) {
      for (const [pointerId] of touches) {
        if (!svg.hasPointerCapture(pointerId)) svg.setPointerCapture(pointerId);
      }
      beginMapPinch(svg, touches);
    }
    return;
  }

  if (!isMapZoomed(svg)) return;

  mapPanState = createMapPanState(event, svg);
  svg.setPointerCapture(event.pointerId);
}

function moveMapPan(event: PointerEvent): void {
  if (event.pointerType === "touch") {
    const touch = mapTouchPoints.get(event.pointerId);
    if (!touch) return;
    touch.clientX = event.clientX;
    touch.clientY = event.clientY;
    const touches = touchesForMap(touch.svg);
    if (mapPinchState?.svg === touch.svg && touches.length >= 2) {
      updateMapPinch(mapPinchState, touches);
      event.preventDefault();
      return;
    }
  }

  if (!mapPanState || mapPanState.pointerId !== event.pointerId) return;
  if (!mapPanState.hasMoved) {
    const distance = Math.hypot(event.clientX - mapPanState.originX, event.clientY - mapPanState.originY);
    if (distance < 4) return;
    mapPanState.hasMoved = true;
    mapPanState.svg.classList.add("is-panning");
  }
  const deltaX = mapPanState.clientX - event.clientX;
  const deltaY = mapPanState.clientY - event.clientY;
  mapPanState.clientX = event.clientX;
  mapPanState.clientY = event.clientY;
  panMapByPixels(mapPanState.svg, deltaX, deltaY);
  event.preventDefault();
}

function finishMapPan(event: PointerEvent): void {
  const touch = mapTouchPoints.get(event.pointerId);
  const svg = touch?.svg ?? mapPanState?.svg;
  if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);

  if (event.pointerType === "touch" && touch) {
    mapTouchPoints.delete(event.pointerId);
    if (mapPinchState?.svg === touch.svg) mapPinchState = undefined;
    const remainingTouches = touchesForMap(touch.svg);
    for (const [pointerId] of remainingTouches) {
      if (touch.svg.hasPointerCapture(pointerId)) touch.svg.releasePointerCapture(pointerId);
    }
    mapPanState = undefined;
  } else if (mapPanState?.pointerId === event.pointerId) {
    mapPanState = undefined;
  }

  svg?.classList.remove("is-panning", "is-pinching");
}

function createMapPanState(event: PointerEvent, svg: SVGSVGElement): MapPanState {
  return {
    pointerId: event.pointerId,
    svg,
    clientX: event.clientX,
    clientY: event.clientY,
    originX: event.clientX,
    originY: event.clientY,
    hasMoved: false,
  };
}

function touchesForMap(svg: SVGSVGElement): Array<[number, MapTouchPoint]> {
  return [...mapTouchPoints].filter(([, point]) => point.svg === svg);
}

function beginMapPinch(svg: SVGSVGElement, touches: Array<[number, MapTouchPoint]>): void {
  const first = touches[0][1];
  const second = touches[1][1];
  const midpoint = touchMidpoint(first, second);
  const mapPoint = clientPointToMap(svg, midpoint.x, midpoint.y);
  if (!mapPoint) return;

  mapPanState = undefined;
  svg.classList.remove("is-panning");
  svg.classList.add("is-pinching");
  mapPinchState = {
    svg,
    startDistance: touchDistance(first, second),
    startMidpoint: midpoint,
    mapPoint,
    startViewBox: copyViewBox(svg.viewBox.baseVal),
  };
}

function updateMapPinch(state: MapPinchState, touches: Array<[number, MapTouchPoint]>): void {
  const first = touches[0][1];
  const second = touches[1][1];
  const distance = touchDistance(first, second);
  const fullViewBox = parseViewBox(state.svg.dataset.fullViewBox);
  const bounds = state.svg.getBoundingClientRect();
  if (!fullViewBox || distance <= 0 || state.startDistance <= 0 || bounds.width <= 0 || bounds.height <= 0) return;

  const midpoint = touchMidpoint(first, second);
  const minimumScale = Math.max(
    fullViewBox.width * 0.08 / state.startViewBox.width,
    fullViewBox.height * 0.08 / state.startViewBox.height,
  );
  const maximumScale = Math.min(
    fullViewBox.width / state.startViewBox.width,
    fullViewBox.height / state.startViewBox.height,
  );
  const requestedScale = state.startDistance / distance;
  if (requestedScale >= maximumScale * 0.995) {
    restoreFullMapView(state.svg, fullViewBox);
    return;
  }

  const scale = clampMapPosition(requestedScale, minimumScale, maximumScale);
  const width = state.startViewBox.width * scale;
  const height = state.startViewBox.height * scale;
  const midpointDeltaX = (midpoint.x - state.startMidpoint.x) * state.startViewBox.width / bounds.width * scale;
  const midpointDeltaY = (midpoint.y - state.startMidpoint.y) * state.startViewBox.height / bounds.height * scale;
  const x = clampMapPosition(
    state.mapPoint.x - (state.mapPoint.x - state.startViewBox.x) * scale - midpointDeltaX,
    fullViewBox.x,
    fullViewBox.x + fullViewBox.width - width,
  );
  const y = clampMapPosition(
    state.mapPoint.y - (state.mapPoint.y - state.startViewBox.y) * scale - midpointDeltaY,
    fullViewBox.y,
    fullViewBox.y + fullViewBox.height - height,
  );

  state.svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  state.svg.classList.toggle("is-map-zoomed", width < fullViewBox.width - 0.01 || height < fullViewBox.height - 0.01);
  setMapZoomControls(isMapZoomed(state.svg));
}

function touchDistance(first: MapTouchPoint, second: MapTouchPoint): number {
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

function touchMidpoint(first: MapTouchPoint, second: MapTouchPoint): { x: number; y: number } {
  return { x: (first.clientX + second.clientX) / 2, y: (first.clientY + second.clientY) / 2 };
}

function clientPointToMap(svg: SVGSVGElement, clientX: number, clientY: number): DOMPoint | undefined {
  const matrix = svg.getScreenCTM();
  if (!matrix) return undefined;
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  return point.matrixTransform(matrix.inverse());
}

function copyViewBox(viewBox: SVGRect): MapViewBox {
  return { x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height };
}

function setMapZoomControls(isZoomed: boolean): void {
  elements.mapZoomIn.disabled = false;
  elements.mapZoomOut.disabled = !isZoomed;
  elements.mapReset.hidden = !isZoomed;
}

function restoreFullMapView(svg: SVGSVGElement, fullViewBox: MapViewBox): void {
  svg.setAttribute("viewBox", `${fullViewBox.x} ${fullViewBox.y} ${fullViewBox.width} ${fullViewBox.height}`);
  svg.classList.remove("is-building-focused", "is-map-zoomed", "is-panning", "is-pinching");
  for (const plate of svg.querySelectorAll<SVGGElement>(".building-plate.is-focused")) {
    plate.classList.remove("is-focused");
  }
  clearDirectionSelection();
  elements.mapCaption.textContent = currentFloorMap?.title ?? `${currentFloorMap?.label ?? "Floor"} simplified campus map`;
  setMapZoomControls(false);
}

function panMapByPixels(svg: SVGSVGElement, deltaX: number, deltaY: number): boolean {
  const fullViewBox = parseViewBox(svg.dataset.fullViewBox);
  const bounds = svg.getBoundingClientRect();
  const current = svg.viewBox.baseVal;
  if (!fullViewBox || bounds.width <= 0 || bounds.height <= 0) return false;

  const x = clampMapPosition(
    current.x + deltaX * current.width / bounds.width,
    fullViewBox.x,
    fullViewBox.x + fullViewBox.width - current.width,
  );
  const y = clampMapPosition(
    current.y + deltaY * current.height / bounds.height,
    fullViewBox.y,
    fullViewBox.y + fullViewBox.height - current.height,
  );
  if (Math.abs(x - current.x) < 0.001 && Math.abs(y - current.y) < 0.001) return false;

  svg.setAttribute("viewBox", `${x} ${y} ${current.width} ${current.height}`);
  return true;
}

function isMapZoomed(svg: SVGSVGElement): boolean {
  const fullViewBox = parseViewBox(svg.dataset.fullViewBox);
  const current = svg.viewBox.baseVal;
  return Boolean(fullViewBox && (
    current.width < fullViewBox.width - 0.01
    || current.height < fullViewBox.height - 0.01
  ));
}

function clampMapPosition(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function parseViewBox(value: string | undefined): { x: number; y: number; width: number; height: number } | undefined {
  const values = value?.trim().split(/\s+/).map(Number);
  if (!values || values.length !== 4 || values.some((number) => !Number.isFinite(number))) return undefined;
  const [x, y, width, height] = values;
  return { x, y, width, height };
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
  svg.classList.add("is-building-focused", "is-map-zoomed");
  for (const plate of svg.querySelectorAll<SVGGElement>(".building-plate")) {
    plate.classList.toggle("is-focused", plate.dataset.building === building);
  }

  elements.mapCaption.textContent = `Focused on ${building} Building. Scroll, drag, or pinch the map to follow the route.`;
  setMapZoomControls(true);
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
  elements.shareDirections.disabled = false;
  if (focusFirstInstruction || hasRouteQuery()) {
    writeRouteQuery(state);
  }
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
  elements.shareDirections.disabled = true;
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

function readRouteQueryState(): SavedState {
  const params = new URLSearchParams(window.location.search);

  return {
    start: params.get("from") ?? params.get("start") ?? undefined,
    goal: params.get("to") ?? params.get("goal") ?? undefined,
  };
}

function hasRouteQuery(): boolean {
  const params = new URLSearchParams(window.location.search);
  return ["from", "to", "start", "goal"].some((name) => params.has(name));
}

function writeRouteQuery(state: RouteFormState): void {
  const url = new URL(window.location.href);
  url.searchParams.set("from", state.start);
  url.searchParams.set("to", state.goal);
  url.searchParams.delete("start");
  url.searchParams.delete("goal");
  window.history.replaceState(null, "", url);
}

async function shareDirections(): Promise<void> {
  if (!currentRoute) return;

  const state = getRouteFormState();
  writeRouteQuery(state);
  const url = window.location.href;
  const shareData = {
    title: "BHCC indoor directions",
    text: `Directions from ${state.start} to ${state.goal}`,
    url,
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }

    await navigator.clipboard.writeText(url);
    showShareConfirmation();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    window.prompt("Copy this directions link", url);
  }
}

function showShareConfirmation(): void {
  const button = elements.shareDirections;
  const previousLabel = button.getAttribute("aria-label") ?? "Share directions";
  button.setAttribute("aria-label", "Directions link copied");
  button.title = "Directions link copied";
  button.classList.add("is-copied");

  window.setTimeout(() => {
    button.setAttribute("aria-label", previousLabel);
    button.title = previousLabel;
    button.classList.remove("is-copied");
  }, 1800);
}

function saveState(state: RouteFormState): void {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function validRouteLocation(value: string | undefined, fallback: string): string {
  return value && findNodeId(buildingGraph, value) ? value : fallback;
}
