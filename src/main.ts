import "./styles.css";
import { classifyTurn, compassLabel, findNodeId, searchLocations } from "./lib/graph";
import { describeRoute } from "./lib/directions";
import { findShortestPath } from "./lib/routing";
import { sampleBuilding } from "./lib/sampleBuilding";
import { registerServiceWorker } from "./pwa";

type Algorithm = "astar" | "dijkstra";

const storageKey = "indoor-nav-state";
const defaultStart = "N-111";
const defaultGoal = "N-317";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found");
}

const savedState = readState();

app.innerHTML = `
  <main class="shell">
    <section class="card form-card">
      <form id="route-form" class="route-form">
        <label>
          <span>Current location</span>
          <div class="autocomplete" data-autocomplete="start">
            <input id="start-input" name="start" placeholder="Search rooms or services, e.g. N-111" autocomplete="off" autocapitalize="off" spellcheck="false" aria-autocomplete="list" aria-controls="start-suggestions" aria-expanded="false" aria-haspopup="listbox" />
            <div id="start-suggestions" class="suggestions" role="listbox" hidden></div>
          </div>
        </label>
        <label>
          <span>Destination</span>
          <div class="autocomplete" data-autocomplete="goal">
            <input id="goal-input" name="goal" placeholder="Search rooms or services, e.g. N-317" autocomplete="off" autocapitalize="off" spellcheck="false" aria-autocomplete="list" aria-controls="goal-suggestions" aria-expanded="false" aria-haspopup="listbox" />
            <div id="goal-suggestions" class="suggestions" role="listbox" hidden></div>
          </div>
        </label>
        <label>
          <span>Algorithm</span>
          <select id="algorithm-input" name="algorithm">
            <option value="astar">A*</option>
            <option value="dijkstra">Dijkstra</option>
          </select>
        </label>
        <button class="primary" type="submit">Find route</button>
      </form>
      <p id="status" class="status">Ready to route through the BHCC directory graph.</p>
    </section>

    <section class="grid">
      <article class="card">
        <div class="card-header">
          <h2>Directions</h2>
          <p id="summary" class="muted"></p>
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
          <li><strong>${sampleBuilding.nodes.length}</strong> nodes</li>
          <li><strong>${sampleBuilding.edges.length}</strong> directed edges</li>
          <li><strong>floor-aware</strong> weights</li>
        </ul>
      </article>
    </section>
  </main>
`;

const startInput = document.querySelector<HTMLInputElement>("#start-input");
const goalInput = document.querySelector<HTMLInputElement>("#goal-input");
const algorithmInput = document.querySelector<HTMLSelectElement>("#algorithm-input");
const form = document.querySelector<HTMLFormElement>("#route-form");
const status = document.querySelector<HTMLParagraphElement>("#status");
const summary = document.querySelector<HTMLParagraphElement>("#summary");
const directionsList = document.querySelector<HTMLOListElement>("#directions");
const trace = document.querySelector<HTMLDivElement>("#trace");
const startSuggestions = document.querySelector<HTMLDivElement>("#start-suggestions");
const goalSuggestions = document.querySelector<HTMLDivElement>("#goal-suggestions");

if (!startInput || !goalInput || !algorithmInput || !form || !status || !summary || !directionsList || !trace || !startSuggestions || !goalSuggestions) {
  throw new Error("Missing UI nodes");
}

startInput.value = findNodeId(sampleBuilding, savedState.start ?? "") ? (savedState.start ?? defaultStart) : defaultStart;
goalInput.value = findNodeId(sampleBuilding, savedState.goal ?? "") ? (savedState.goal ?? defaultGoal) : defaultGoal;
algorithmInput.value = savedState.algorithm ?? "astar";

setupAutocomplete(startInput, startSuggestions);
setupAutocomplete(goalInput, goalSuggestions);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runRoute();
});

registerServiceWorker();
runRoute();

function runRoute(): void {
  const startQuery = startInput.value.trim();
  const goalQuery = goalInput.value.trim();
  const algorithm = algorithmInput.value === "dijkstra" ? "dijkstra" : "astar";

  saveState({ start: startQuery, goal: goalQuery, algorithm });

  const startId = findNodeId(sampleBuilding, startQuery);
  const goalId = findNodeId(sampleBuilding, goalQuery);

  if (!startId || !goalId) {
    setStatus("Could not match one or both locations. Try using a room code or directory name from the BHCC graph.", true);
    directionsList.innerHTML = "";
    trace.innerHTML = "";
    summary.textContent = "";
    return;
  }

  const route = findShortestPath(sampleBuilding, startId, goalId, algorithm);

  if (!route) {
    setStatus("No route could be found between those locations in the BHCC graph.", true);
    directionsList.innerHTML = "";
    trace.innerHTML = "";
    summary.textContent = "";
    return;
  }

  const directions = describeRoute(sampleBuilding, route);
  const estimatedMinutes = Math.max(1, Math.round(route.distance / 70));

  setStatus(`Route found using ${algorithm === "astar" ? "A*" : "Dijkstra"}.`, false);
  summary.textContent = `${route.distance.toFixed(1)} m estimated, about ${estimatedMinutes} min walking time.`;

  directionsList.innerHTML = "";
  for (const step of directions) {
    const item = document.createElement("li");
    item.innerHTML = `
      <span>${step.text}</span>
      <small>${step.distance > 0 ? `${step.distance.toFixed(1)} m` : "destination"}</small>
    `;
    directionsList.append(item);
  }

  trace.innerHTML = "";
  route.nodes.forEach((node, index) => {
    const chip = document.createElement("div");
    chip.className = "trace-chip";

    const previousEdge = route.edges[index - 1];
    const bearing = previousEdge?.bearing;
    const turnText =
      index === 0
        ? node.exitBearing !== undefined
          ? `${compassLabel(node.exitBearing)} exit`
          : "start"
        : index < route.edges.length
          ? classifyTurn(route.edges[index - 1].bearing, route.edges[index].bearing)
          : "arrived";

    chip.innerHTML = `
      <strong>${node.label}</strong>
      <span>${node.kind} • floor ${node.floor}</span>
      <span>${bearing !== undefined ? `bearing ${bearing}°` : turnText}</span>
    `;
    trace.append(chip);
  });
}

function setStatus(message: string, isError: boolean): void {
  status.textContent = message;
  status.dataset.variant = isError ? "error" : "ready";
}

function readState(): { start?: string; goal?: string; algorithm?: Algorithm } {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return {};
    }

    return JSON.parse(raw) as { start?: string; goal?: string; algorithm?: Algorithm };
  } catch {
    return {};
  }
}

function saveState(state: { start: string; goal: string; algorithm: Algorithm }): void {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function setupAutocomplete(input: HTMLInputElement, menu: HTMLDivElement): void {
  let activeIndex = -1;
  let suggestions = searchLocations(sampleBuilding, input.value, 6);
  let hideTimer: number | undefined;

  const render = (): void => {
    suggestions = searchLocations(sampleBuilding, input.value, 6);
    activeIndex = suggestions.length > 0 ? Math.min(activeIndex, suggestions.length - 1) : -1;
    menu.innerHTML = "";

    if (suggestions.length === 0) {
      menu.hidden = true;
      input.setAttribute("aria-expanded", "false");
      return;
    }

    suggestions.forEach((suggestion, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suggestion";
      button.setAttribute("role", "option");
      button.dataset.index = String(index);
      button.setAttribute("aria-selected", index === activeIndex ? "true" : "false");
      button.innerHTML = `
        <strong>${suggestion.label}</strong>
        <span>${suggestion.detail}</span>
      `;
      menu.append(button);
    });

    menu.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  const hide = (): void => {
    menu.hidden = true;
    input.setAttribute("aria-expanded", "false");
  };

  const choose = (index: number): void => {
    const suggestion = suggestions[index];
    if (!suggestion) {
      return;
    }

    input.value = suggestion.label;
    hide();
    if (input === startInput || input === goalInput) {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  input.addEventListener("input", () => {
    activeIndex = 0;
    render();
  });

  input.addEventListener("focus", () => {
    if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer);
    }
    activeIndex = 0;
    render();
  });

  input.addEventListener("blur", () => {
    hideTimer = window.setTimeout(() => hide(), 120);
  });

  input.addEventListener("keydown", (event) => {
    if (menu.hidden && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      render();
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = suggestions.length === 0 ? -1 : (activeIndex + 1) % suggestions.length;
      render();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = suggestions.length === 0 ? -1 : (activeIndex - 1 + suggestions.length) % suggestions.length;
      render();
      return;
    }

    if (event.key === "Escape") {
      hide();
      return;
    }

    if (event.key === "Enter" && !menu.hidden && activeIndex >= 0) {
      event.preventDefault();
      choose(activeIndex);
    }
  });

  menu.addEventListener("pointerdown", (event) => {
    event.preventDefault();
  });

  menu.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const option = target?.closest<HTMLButtonElement>(".suggestion");
    if (!option) {
      return;
    }

    const index = Number(option.dataset.index);
    choose(index);
  });

  hide();
}
