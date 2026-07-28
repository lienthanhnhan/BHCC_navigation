import { searchLocations } from "../lib/graph";
import type { BuildingGraph } from "../lib/types";

type AutocompleteOptions = {
  graph: BuildingGraph;
  input: HTMLInputElement;
  menu: HTMLDivElement;
  limit?: number;
  onChoose?: () => void;
};

const defaultSuggestionLimit = 6;

export function setupAutocomplete({
  graph,
  input,
  menu,
  limit = defaultSuggestionLimit,
  onChoose,
}: AutocompleteOptions): void {
  let activeIndex = -1;
  let suggestions = searchLocations(graph, input.value, limit);
  let hideTimer: number | undefined;

  const setExpanded = (isExpanded: boolean): void => {
    menu.hidden = !isExpanded;
    input.setAttribute("aria-expanded", String(isExpanded));
  };

  const hide = (): void => {
    setExpanded(false);
  };

  const render = (): void => {
    suggestions = searchLocations(graph, input.value, limit);
    activeIndex = suggestions.length > 0 ? Math.min(activeIndex, suggestions.length - 1) : -1;
    menu.innerHTML = "";

    if (suggestions.length === 0) {
      hide();
      return;
    }

    for (const [index, suggestion] of suggestions.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suggestion";
      button.setAttribute("role", "option");
      button.dataset.index = String(index);
      button.setAttribute("aria-selected", String(index === activeIndex));
      button.innerHTML = `
        <strong>${suggestion.label}</strong>
        <span>${suggestion.detail}</span>
      `;
      menu.append(button);
    }

    setExpanded(true);
  };

  const choose = (index: number): void => {
    const suggestion = suggestions[index];

    if (!suggestion) {
      return;
    }

    input.value = suggestion.label;
    hide();
    onChoose?.();
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
    hideTimer = window.setTimeout(hide, 120);
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

    choose(Number(option.dataset.index));
  });

  hide();
}
