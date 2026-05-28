import { makeGuidanceSnapshot, makeIdleSnapshot, type GuidanceSnapshot, type PositionSample } from "./guidance";
import { GlassDisplay } from "./glasses";
import L, { type LatLngExpression, type Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  type PlaceResult,
  type RouteResult,
  type TravelMode,
  type UnitSystem,
  bearingDegrees,
  distanceMeters,
  fetchDrivingRoute,
  formatDistance,
  formatEta,
  reverseGeocodePlace,
  searchPlaces
} from "./navigation";
import "./styles.css";

type AppState = {
  mode: TravelMode;
  unitSystem: UnitSystem;
  guidanceView: "arrows" | "map";
  showSideRoads: boolean;
  activeSearchField: "origin" | "destination" | null;
  bridgeConnected: boolean;
  locating: boolean;
  locatingFor: "origin" | "destination" | null;
  searching: boolean;
  originSearching: boolean;
  routing: boolean;
  navigating: boolean;
  devDriving: boolean;
  devDriveSpeedMetersPerSecond: number;
  autoRerouting: boolean;
  offRouteSampleCount: number;
  lastAutoRerouteAt: number;
  startWhenRouteReady: boolean;
  routeRequestId: number;
  originQuery: string;
  originResults: PlaceResult[];
  originLabel: string;
  query: string;
  results: PlaceResult[];
  favorites: PlaceResult[];
  glassesFavoriteIndex: number;
  glassesStartFavoriteIndex: number;
  glassesDestinationFavoriteIndex: number;
  glassesSettingsIndex: number;
  glassesScreen: "home" | "favoriteOrigin" | "favoriteDestination" | "routeReady" | "settings";
  glassesSelectedOrigin: PlaceResult | null;
  devToolsEnabled: boolean;
  selectedPlace: PlaceResult | null;
  route: RouteResult | null;
  position: PositionSample | null;
  locationSource: "gps" | "manual" | "simulated" | null;
  locationStatus: string;
  nextStepIndex: number;
  error: string | null;
};

type GlassAction = "press" | "double" | "up" | "down" | "long";

const FAVORITES_STORAGE_KEY = "apexline-favorites";
const UNIT_SYSTEM_STORAGE_KEY = "apexline-unit-system";
const SIDE_ROADS_STORAGE_KEY = "apexline-side-roads";

const state: AppState = {
  mode: "motorcycle",
  unitSystem: loadUnitSystem(),
  guidanceView: "arrows",
  showSideRoads: loadSideRoadsEnabled(),
  activeSearchField: null,
  bridgeConnected: false,
  locating: false,
  locatingFor: null,
  searching: false,
  originSearching: false,
  routing: false,
  navigating: false,
  devDriving: false,
  devDriveSpeedMetersPerSecond: defaultDevDriveSpeed("motorcycle"),
  autoRerouting: false,
  offRouteSampleCount: 0,
  lastAutoRerouteAt: 0,
  startWhenRouteReady: false,
  routeRequestId: 0,
  originQuery: "",
  originResults: [],
  originLabel: "",
  query: "",
  results: [],
  favorites: loadFavorites(),
  glassesFavoriteIndex: 0,
  glassesStartFavoriteIndex: 0,
  glassesDestinationFavoriteIndex: 0,
  glassesSettingsIndex: 0,
  glassesScreen: "home",
  glassesSelectedOrigin: null,
  devToolsEnabled: false,
  selectedPlace: null,
  route: null,
  position: null,
  locationSource: null,
  locationStatus: "No location yet",
  nextStepIndex: 0,
  error: null
};

const DEV_TEST_ORIGIN: PlaceResult = {
  id: "dev-hulftegg-passhoehe",
  label: "Hulftegg Passhoehe",
  coordinate: {
    lat: 47.35735,
    lon: 8.96847
  }
};

const DEV_TEST_DESTINATION: PlaceResult = {
  id: "dev-schwaegalp-passhoehe",
  label: "Schwaegalp Passhoehe",
  coordinate: {
    lat: 47.25692,
    lon: 9.3041
  }
};

const AUTO_REROUTE_SAMPLE_THRESHOLD = 3;
const AUTO_REROUTE_COOLDOWN_MS = 10000;

const glassDisplay = new GlassDisplay();
const app = document.querySelector<HTMLDivElement>("#app");
let positionWatchId: number | null = null;
let searchTimer: number | null = null;
let originSearchTimer: number | null = null;
let map: LeafletMap | null = null;
let destinationMarker: L.Marker | null = null;
let currentMarker: L.CircleMarker | null = null;
let routeLine: L.Polyline | null = null;
let devDriveTimer: number | null = null;
let devDriveDistanceMeters = 0;
let lastDevDriveAt = 0;
let titleTapCount = 0;
let titleTapResetTimer: number | null = null;
let devGlassesKeyboardBound = false;

void boot();

async function boot(): Promise<void> {
  applyLaunchOptions();
  installDevGlassHarness();
  render();
  state.bridgeConnected = await glassDisplay.connect(handleGlassInput);
  await updateGlass();
  if (shouldAutoRunDevRoute()) {
    await buildDevTestRoute();
    if (shouldAutoStartDevDriving()) {
      startDevDriving();
    }
  }
  render();
}

function installDevGlassHarness(): void {
  const devWindow = window as Window & {
    __apexlineDevGlassInput?: (action: GlassAction) => void;
    __apexlineDebugState?: () => Record<string, unknown>;
  };

  devWindow.__apexlineDevGlassInput = (action) => {
    if (!state.devToolsEnabled) {
      return;
    }

    runDevGlassInput(action);
  };
  devWindow.__apexlineDebugState = devDebugSnapshot;
  document.addEventListener("apexline-dev-glass-input", (event) => {
    const action = (event as CustomEvent<unknown>).detail;
    if (!state.devToolsEnabled || !isGlassAction(action)) {
      return;
    }

    runDevGlassInput(action);
  });
}

function devDebugSnapshot(): Record<string, unknown> {
  return {
    devToolsEnabled: state.devToolsEnabled,
    glassesScreen: state.glassesScreen,
    guidanceView: state.guidanceView,
    mode: state.mode,
    unitSystem: state.unitSystem,
    showSideRoads: state.showSideRoads,
    settingsIndex: state.glassesSettingsIndex,
    startFavoriteIndex: state.glassesStartFavoriteIndex,
    destinationFavoriteIndex: state.glassesDestinationFavoriteIndex,
    selectedOrigin: state.glassesSelectedOrigin?.label ?? null,
    selectedDestination: state.selectedPlace?.label ?? null,
    routeReady: Boolean(state.route),
    navigating: state.navigating,
    devDriving: state.devDriving
  };
}

function syncDevDebugState(): void {
  if (document.body) {
    document.body.dataset.apexlineDebugState = JSON.stringify(devDebugSnapshot());
  }
}

function runDevGlassInput(action: GlassAction): void {
  handleGlassInput(action);
  syncDevDebugState();
  window.setTimeout(syncDevDebugState, 0);
}

function isGlassAction(action: unknown): action is GlassAction {
  return action === "press" || action === "double" || action === "up" || action === "down" || action === "long";
}

function shouldAutoRunDevRoute(): boolean {
  return new URLSearchParams(window.location.search).has("devRoute");
}

function shouldAutoStartDevDriving(): boolean {
  return new URLSearchParams(window.location.search).has("autoDrive");
}

function applyLaunchOptions(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "map") {
    state.guidanceView = "map";
  }

  const units = params.get("units");
  if (units === "metric" || units === "imperial") {
    state.unitSystem = units;
    saveUnitSystem();
  }

  if (params.has("sideRoads")) {
    state.showSideRoads = params.get("sideRoads") !== "0";
    saveSideRoadsEnabled();
  }

  if (params.has("devTools")) {
    state.devToolsEnabled = params.get("devTools") !== "0";
  }
}

function render(): void {
  if (!app) {
    return;
  }

  currentSnapshot();
  disposeMap();
  app.innerHTML = `
    <section class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Even Realities G2</p>
          <h1 id="app-title">Apexline</h1>
          <p class="tagline">Ride the line. Drive the pass.</p>
        </div>
        <div class="topbar-actions">
          <span class="bridge ${state.bridgeConnected ? "on" : ""}">
            ${state.bridgeConnected ? "Glasses live" : "Phone preview"}
          </span>
          <details class="settings-menu">
            <summary aria-label="Settings" title="Settings">
              <span aria-hidden="true">⚙</span>
            </summary>
            ${renderSettingsMenu()}
          </details>
        </div>
      </header>

      <section class="panel route-panel">
        <div class="mode-row" role="group" aria-label="Travel mode">
          <button class="mode ${state.mode === "motorcycle" ? "active" : ""}" data-mode="motorcycle" type="button">Moto</button>
          <button class="mode ${state.mode === "car" ? "active" : ""}" data-mode="car" type="button">Drive</button>
        </div>
        <p class="mode-note">
          Moto gives earlier turn prep and a wider off-route buffer; Drive keeps prompts tighter for spirited road driving.
        </p>
        <div class="route-builder" aria-label="Route planner">
          <div class="route-rail" aria-hidden="true">
            <span class="origin-dot"></span>
            <span class="rail-line"></span>
            <span class="destination-dot"></span>
          </div>

          <div class="route-fields">
            <label class="route-field">
              <span>Start</span>
              <input
                id="origin"
                type="search"
                autocomplete="off"
                placeholder="Current location or start point"
                value="${escapeHtml(originInputValue())}"
              />
            </label>
            <div id="origin-results-slot">
              ${renderOriginResults()}
            </div>

            <label class="route-field">
              <span>Destination</span>
              <input
                id="destination"
                type="search"
                autocomplete="off"
                placeholder="Search address or place"
                value="${escapeHtml(state.query)}"
              />
            </label>
            <div id="results-slot">
              ${renderResults()}
            </div>
          </div>
        </div>

        <section class="map-pane" aria-label="Destination map">
          <div id="map"></div>
        </section>

        <div class="actions">
          <button class="primary" id="start-nav" type="button" ${canStartNavigation() ? "" : "disabled"}>
            ${state.autoRerouting ? "Recalculating..." : state.navigating ? "Navigation running" : state.routing && state.startWhenRouteReady ? "Starting..." : "Start navigation"}
          </button>
          ${canCancelNavigation() ? `<button class="danger" id="cancel-route" type="button">${state.routing ? "Cancel route" : "Stop navigation"}</button>` : ""}
        </div>

        ${state.devToolsEnabled ? `
          <div class="dev-tools" aria-label="Developer tools">
            <button class="dev-route" id="dev-route" type="button">
              Dev test route: Hulftegg to Schwaegalp
            </button>
            <button class="dev-route" id="dev-drive" type="button">
              ${state.devDriving ? "Pause simulated drive" : "Simulate driving"}
            </button>
            ${state.devDriving ? renderDevSpeedControl() : ""}
          </div>
        ` : ""}

        ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
        <p class="location-note">${escapeHtml(state.locationStatus)}</p>
      </section>

      <section class="dashboard">
        <article class="guidance-card" id="guidance-card">
          ${renderGuidancePanel()}
        </article>
        <article class="stats" id="stats-card">
          ${renderStats()}
        </article>
      </section>

    </section>
  `;

  bindEvents();
  syncMap();
  syncDevDebugState();
}

function updateResultsSlot(): void {
  const resultsSlot = document.querySelector<HTMLDivElement>("#results-slot");
  if (!resultsSlot) {
    return;
  }

  resultsSlot.innerHTML = renderResults();
  bindResultEvents();
  bindFavoriteEvents();
  bindDevGlassesKeyboard();
}

function updateOriginResultsSlot(): void {
  const resultsSlot = document.querySelector<HTMLDivElement>("#origin-results-slot");
  if (!resultsSlot) {
    return;
  }

  resultsSlot.innerHTML = renderOriginResults();
  bindOriginResultEvents();
  bindFavoriteEvents();
}

function updateStatsCard(): void {
  const statsCard = document.querySelector<HTMLElement>("#stats-card");
  if (statsCard) {
    statsCard.innerHTML = renderStats();
  }

  const guidanceCard = document.querySelector<HTMLElement>("#guidance-card");
  if (guidanceCard) {
    guidanceCard.innerHTML = renderGuidancePanel();
  }
}

function renderSettingsMenu(): string {
  return `
    <div class="settings-popover">
      <div class="settings-grid">
        <div class="setting-group">
          <span>Glasses view</span>
          <div class="segmented-row" role="group" aria-label="Glasses guidance style">
            <button class="view-mode ${state.guidanceView === "arrows" ? "active" : ""}" data-guidance-view="arrows" type="button">Arrows</button>
            <button class="view-mode ${state.guidanceView === "map" ? "active" : ""}" data-guidance-view="map" type="button">Map</button>
          </div>
        </div>
        <div class="setting-group">
          <span>Units</span>
          <div class="segmented-row" role="group" aria-label="Distance units">
            <button class="unit-mode ${state.unitSystem === "imperial" ? "active" : ""}" data-unit-system="imperial" type="button">Imperial</button>
            <button class="unit-mode ${state.unitSystem === "metric" ? "active" : ""}" data-unit-system="metric" type="button">Metric</button>
          </div>
        </div>
        <label class="setting-toggle">
          <input type="checkbox" data-side-roads ${state.showSideRoads ? "checked" : ""} />
          <span>Intersection side roads</span>
        </label>
      </div>
    </div>
  `;
}

function currentOriginPlace(): PlaceResult | null {
  if (!state.position) {
    return null;
  }

  return {
    id: `origin-${state.position.coordinate.lat.toFixed(6)}-${state.position.coordinate.lon.toFixed(6)}`,
    label: originInputValue() || "Start",
    coordinate: state.position.coordinate
  };
}

function originInputValue(): string {
  if (state.originQuery) {
    return state.originQuery;
  }

  if (state.position && state.locationSource === "gps") {
    return "Current Location";
  }

  return state.originLabel;
}

function renderOriginResults(): string {
  if (state.activeSearchField !== "origin" && !state.position) {
    return "";
  }

  const useCurrentButton = `
    <button class="result current-location-option" data-use-current-location="origin" type="button">
      ${state.locating && state.locatingFor === "origin" ? "Locating..." : "Use current location"}
    </button>
  `;

  if (state.originSearching) {
    return `<div class="results">${useCurrentButton}${renderFavoriteChoices("origin")}<div class="muted result-note">Searching start points...</div></div>`;
  }

  if (state.originResults.length > 0) {
    return `
      <div class="results">
        ${useCurrentButton}
        ${renderFavoriteChoices("origin")}
        ${state.originResults
          .map(
            (place) => `
              <button class="result" data-origin-place-id="${place.id}" type="button">
                ${escapeHtml(place.label)}
              </button>
            `
          )
          .join("")}
      </div>
    `;
  }

  if (state.position && state.activeSearchField !== "origin") {
    return `
      <div class="selected-summary">
        <span>Start: ${escapeHtml(originInputValue())}</span>
        ${renderFavoriteToggle(currentOriginPlace(), "origin")}
      </div>
    `;
  }

  if (state.position && state.activeSearchField === "origin") {
    return `
      <div class="results">
        <div class="selected-summary">
          <span>Start: ${escapeHtml(originInputValue())}</span>
          ${renderFavoriteToggle(currentOriginPlace(), "origin")}
        </div>
        ${useCurrentButton}
        ${renderFavoriteChoices("origin")}
      </div>
    `;
  }

  return `
    <div class="results">
      ${useCurrentButton}
      ${renderFavoriteChoices("origin")}
      <div class="muted result-note">Type a start point or tap the map while the Start field is active.</div>
    </div>
  `;
}

function renderResults(): string {
  if (state.activeSearchField !== "destination" && !state.selectedPlace) {
    return "";
  }

  const useCurrentButton = state.activeSearchField === "destination"
    ? `
      <button class="result current-location-option" data-use-current-location="destination" type="button">
        ${state.locating && state.locatingFor === "destination" ? "Locating..." : "Use current location"}
      </button>
    `
    : "";

  if (state.searching) {
    return `<div class="results">${useCurrentButton}${renderFavoriteChoices("destination")}<div class="muted result-note">Searching...</div></div>`;
  }

  if (state.selectedPlace) {
    return `
      <div class="results">
        <div class="selected-summary">
          <span>Pinned: ${escapeHtml(state.selectedPlace.label)}</span>
          ${renderFavoriteToggle(state.selectedPlace, "destination")}
        </div>
        ${state.activeSearchField === "destination" ? `${useCurrentButton}${renderFavoriteChoices("destination")}` : ""}
      </div>
    `;
  }

  if (state.results.length === 0) {
    const hint = state.query.trim().length >= 3 ? "No destination selected" : "Type a destination, use current location, or tap the map.";
    return `<div class="results">${useCurrentButton}${renderFavoriteChoices("destination")}<div class="muted result-note">${hint}</div></div>`;
  }

  return `
    <div class="results">
      ${useCurrentButton}
      ${renderFavoriteChoices("destination")}
      ${state.results
        .map(
          (place) => `
            <button class="result ${state.selectedPlace?.id === place.id ? "selected" : ""}" data-place-id="${place.id}" type="button">
              ${escapeHtml(place.label)}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderFavoriteChoices(target: "origin" | "destination"): string {
  if (state.favorites.length === 0) {
    return "";
  }

  return `
    <div class="favorite-list" aria-label="Favorites">
      ${state.favorites
        .map(
          (favorite) => `
            <button class="favorite-choice" data-favorite-${target}-id="${favorite.id}" type="button">
              ${escapeHtml(favorite.label)}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderFavoriteToggle(place: PlaceResult | null, target: "origin" | "destination"): string {
  if (!place) {
    return "";
  }

  const favorite = isFavorite(place);
  return `
    <button class="favorite-toggle ${favorite ? "saved" : ""}" data-favorite-toggle="${target}" type="button">
      ${favorite ? "Saved" : "Save"}
    </button>
  `;
}

function renderStats(): string {
  if (!state.route) {
    return `
      <div class="stat"><span>Status</span><strong>${state.position ? "Location ready" : "No location"}</strong></div>
      <div class="stat"><span>Source</span><strong>${locationSourceLabel()}</strong></div>
      <div class="stat"><span>Mode</span><strong>${state.mode === "motorcycle" ? "Moto" : "Drive"}</strong></div>
      <div class="stat"><span>Route</span><strong>Not built</strong></div>
    `;
  }

  const nextStep = state.route.steps[state.nextStepIndex];
  return `
    <div class="stat"><span>Total</span><strong>${formatDistance(state.route.distanceMeters, state.unitSystem)}</strong></div>
    <div class="stat"><span>ETA</span><strong>${formatEta(state.route.durationSeconds)}</strong></div>
    <div class="stat"><span>Source</span><strong>${locationSourceLabel()}</strong></div>
    <div class="stat"><span>Next</span><strong>${nextStep ? escapeHtml(nextStep.shortInstruction) : "Done"}</strong></div>
    <p class="destination">${escapeHtml(state.route.destinationLabel)}</p>
  `;
}

function renderGuidancePanel(): string {
  if (!state.route || !state.position || !state.navigating) {
    return `
      <div class="guidance-visual idle">--</div>
      <div>
        <span>Glasses guidance</span>
        <strong>${state.guidanceView === "arrows" ? "Arrow view" : "Map view"}</strong>
        <p>Start navigation to preview the G2 prompt style.</p>
      </div>
    `;
  }

  const snapshot = withDisplayPreferences(
    makeGuidanceSnapshot(state.route, state.position, state.mode, state.nextStepIndex, state.unitSystem)
  );
  if (state.guidanceView === "map") {
    return `
      <div class="mini-map-visual" aria-hidden="true">
        <span class="mini-road"></span>
        <span class="mini-position"></span>
        <span class="mini-destination"></span>
      </div>
      <div>
        <span>Map view</span>
        <strong>${escapeHtml(snapshot.primary)}</strong>
        <p>${escapeHtml(snapshot.tertiary)}</p>
      </div>
    `;
  }

  return `
    <div class="guidance-visual">${escapeHtml(snapshot.arrow)}</div>
    <div>
      <span>Arrow view</span>
      <strong>${escapeHtml(snapshot.primary)}</strong>
      <p>${escapeHtml(snapshot.secondary)}</p>
    </div>
  `;
}

function renderDevSpeedControl(): string {
  return `
    <label class="dev-speed-control">
      <span>Simulation speed</span>
      <input
        id="dev-speed"
        type="range"
        min="${devSpeedSliderMin()}"
        max="${devSpeedSliderMax()}"
        step="${devSpeedSliderStep()}"
        value="${devSpeedSliderValue()}"
      />
      <strong id="dev-speed-readout">${formatDevDriveSpeed()}</strong>
    </label>
  `;
}

function bindEvents(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      setTravelMode(button.dataset.mode as TravelMode);
      void updateGlass();
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-guidance-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.guidanceView = button.dataset.guidanceView as AppState["guidanceView"];
      void updateGlass();
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-unit-system]").forEach((button) => {
    button.addEventListener("click", () => {
      state.unitSystem = button.dataset.unitSystem as UnitSystem;
      saveUnitSystem();
      void updateGlass();
      render();
    });
  });

  document.querySelector<HTMLInputElement>("[data-side-roads]")?.addEventListener("change", (event) => {
    state.showSideRoads = (event.target as HTMLInputElement).checked;
    saveSideRoadsEnabled();
    void updateGlass();
    render();
  });

  document.querySelector<HTMLElement>("#app-title")?.addEventListener("click", () => {
    titleTapCount += 1;
    if (titleTapResetTimer != null) {
      window.clearTimeout(titleTapResetTimer);
    }

    titleTapResetTimer = window.setTimeout(() => {
      titleTapCount = 0;
    }, 1400);

    if (titleTapCount >= 5) {
      titleTapCount = 0;
      state.devToolsEnabled = !state.devToolsEnabled;
      state.locationStatus = state.devToolsEnabled ? "Dev tools enabled." : "Dev tools hidden.";
      render();
    }
  });

  const originInput = document.querySelector<HTMLInputElement>("#origin");
  originInput?.addEventListener("focus", activateOriginSearch);
  originInput?.addEventListener("click", activateOriginSearch);

  originInput?.addEventListener("input", (event) => {
    activateOriginSearch();
    const input = event.target as HTMLInputElement;
    state.originQuery = input.value;
    state.originLabel = "";
    state.position = null;
    state.locationSource = null;
    state.locationStatus = "Choose a start point or use current location.";
    state.route = null;
    state.navigating = false;
    state.routeRequestId += 1;
    scheduleOriginSearch();
    updateOriginResultsSlot();
    updateResultsSlot();
    updateStatsCard();
    syncCurrentMarker();
    syncRouteLine();
  });

  const destinationInput = document.querySelector<HTMLInputElement>("#destination");
  destinationInput?.addEventListener("focus", activateDestinationSearch);
  destinationInput?.addEventListener("click", activateDestinationSearch);

  destinationInput?.addEventListener("input", (event) => {
    activateDestinationSearch();
    const input = event.target as HTMLInputElement;
    state.query = input.value;
    state.selectedPlace = null;
    state.route = null;
    state.navigating = false;
    state.routeRequestId += 1;
    scheduleSearch();
    updateOriginResultsSlot();
    updateResultsSlot();
    updateStatsCard();
    syncRouteLine();
  });

  bindResultEvents();
  bindOriginResultEvents();
  bindFavoriteEvents();
  bindDevGlassesKeyboard();

  document.querySelector<HTMLButtonElement>("#start-nav")?.addEventListener("click", () => {
    startNavigation();
  });

  document.querySelector<HTMLButtonElement>("#cancel-route")?.addEventListener("click", () => {
    cancelNavigation(state.routing ? "Route request cancelled." : "Navigation stopped.");
  });

  document.querySelector<HTMLButtonElement>("#dev-route")?.addEventListener("click", () => {
    void buildDevTestRoute();
  });

  document.querySelector<HTMLButtonElement>("#dev-drive")?.addEventListener("click", () => {
    void toggleDevDriving();
  });

  document.querySelector<HTMLInputElement>("#dev-speed")?.addEventListener("input", (event) => {
    state.devDriveSpeedMetersPerSecond = devSliderValueToMetersPerSecond((event.target as HTMLInputElement).valueAsNumber);
    if (state.position && state.locationSource === "simulated") {
      state.position = {
        ...state.position,
        speedMetersPerSecond: state.devDriving ? state.devDriveSpeedMetersPerSecond : 0
      };
    }
    state.locationStatus = state.devDriving
      ? `Simulated drive running at ${formatDevDriveSpeed()}.`
      : state.locationStatus;
    void updateGlass();
    updateStatsCard();
    updateDevSpeedReadout();
  });
}

function bindDevGlassesKeyboard(): void {
  if (devGlassesKeyboardBound) {
    return;
  }

  devGlassesKeyboardBound = true;
  document.addEventListener("keydown", (event) => {
    if (!state.devToolsEnabled || isTextEntryTarget(event.target)) {
      return;
    }

    const action = devKeyToGlassAction(event.key);
    if (!action) {
      return;
    }

    event.preventDefault();
    runDevGlassInput(action);
  });
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || target.isContentEditable;
}

function devKeyToGlassAction(key: string): GlassAction | null {
  if (key === "Enter") {
    return "press";
  }
  if (key === "ArrowUp") {
    return "up";
  }
  if (key === "ArrowDown") {
    return "down";
  }
  if (key.toLowerCase() === "d" || key === "Escape") {
    return "double";
  }
  if (key.toLowerCase() === "l") {
    return "long";
  }

  return null;
}

function setTravelMode(mode: TravelMode): void {
  state.mode = mode;
  if (!state.devDriving) {
    state.devDriveSpeedMetersPerSecond = defaultDevDriveSpeed(state.mode);
  }
}

function activateOriginSearch(): void {
  if (state.activeSearchField !== "origin") {
    state.activeSearchField = "origin";
    updateOriginResultsSlot();
    updateResultsSlot();
  }
}

function activateDestinationSearch(): void {
  if (state.activeSearchField !== "destination") {
    state.activeSearchField = "destination";
    updateOriginResultsSlot();
    updateResultsSlot();
  }
}

function bindResultEvents(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-place-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const place = state.results.find((result) => result.id === button.dataset.placeId);
      if (!place) {
        return;
      }

      applyDestination(place);
      render();
      void ensureRouteReady();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-favorite-destination-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const favorite = findFavorite(button.dataset.favoriteDestinationId);
      if (!favorite) {
        return;
      }

      selectFavoriteDestination(favorite);
      render();
      void ensureRouteReady();
    });
  });
}

function selectFavoriteDestination(favorite: PlaceResult): void {
  applyDestination(favorite);
  state.activeSearchField = null;
}

function bindOriginResultEvents(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-origin-place-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const place = state.originResults.find((result) => result.id === button.dataset.originPlaceId);
      if (!place) {
        return;
      }

      applyManualOrigin(place);
      render();
      void ensureRouteReady();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-use-current-location]").forEach((button) => {
    button.addEventListener("click", () => {
      startLocationWatch(button.dataset.useCurrentLocation as "origin" | "destination");
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-favorite-origin-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const favorite = findFavorite(button.dataset.favoriteOriginId);
      if (!favorite) {
        return;
      }

      applyManualOrigin(favorite);
      render();
      void ensureRouteReady();
    });
  });
}

function applyDestination(place: PlaceResult): void {
  state.selectedPlace = place;
  state.query = place.label;
  state.results = [];
  state.searching = false;
  state.route = null;
  state.navigating = false;
  state.offRouteSampleCount = 0;
  state.routeRequestId += 1;
}

function bindFavoriteEvents(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-favorite-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.favoriteToggle as "origin" | "destination";
      const place = target === "origin" ? currentOriginPlace() : state.selectedPlace;
      if (!place) {
        return;
      }

      toggleFavorite(place);
      render();
      void updateGlass();
    });
  });
}

function findFavorite(id: string | undefined): PlaceResult | null {
  return state.favorites.find((favorite) => favorite.id === id) ?? null;
}

function toggleFavorite(place: PlaceResult): void {
  if (isFavorite(place)) {
    state.favorites = state.favorites.filter((favorite) => !samePlace(favorite, place));
  } else {
    state.favorites = [normalizeFavorite(place), ...state.favorites].slice(0, 20);
  }

  if (state.glassesFavoriteIndex >= state.favorites.length) {
    state.glassesFavoriteIndex = Math.max(0, state.favorites.length - 1);
  }
  if (state.glassesStartFavoriteIndex >= state.favorites.length) {
    state.glassesStartFavoriteIndex = Math.max(0, state.favorites.length - 1);
  }
  if (state.glassesDestinationFavoriteIndex >= state.favorites.length) {
    state.glassesDestinationFavoriteIndex = Math.max(0, state.favorites.length - 1);
  }

  saveFavorites();
}

function isFavorite(place: PlaceResult): boolean {
  return state.favorites.some((favorite) => samePlace(favorite, place));
}

function samePlace(a: PlaceResult, b: PlaceResult): boolean {
  return Math.abs(a.coordinate.lat - b.coordinate.lat) < 0.00001 &&
    Math.abs(a.coordinate.lon - b.coordinate.lon) < 0.00001;
}

function normalizeFavorite(place: PlaceResult): PlaceResult {
  return {
    id: `fav-${place.coordinate.lat.toFixed(6)}-${place.coordinate.lon.toFixed(6)}`,
    label: place.label,
    coordinate: place.coordinate
  };
}

function loadFavorites(): PlaceResult[] {
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as PlaceResult[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((favorite) =>
      typeof favorite.id === "string" &&
      typeof favorite.label === "string" &&
      typeof favorite.coordinate?.lat === "number" &&
      typeof favorite.coordinate?.lon === "number"
    );
  } catch {
    return [];
  }
}

function saveFavorites(): void {
  window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(state.favorites));
}

function loadUnitSystem(): UnitSystem {
  return window.localStorage.getItem(UNIT_SYSTEM_STORAGE_KEY) === "metric" ? "metric" : "imperial";
}

function saveUnitSystem(): void {
  window.localStorage.setItem(UNIT_SYSTEM_STORAGE_KEY, state.unitSystem);
}

function loadSideRoadsEnabled(): boolean {
  return window.localStorage.getItem(SIDE_ROADS_STORAGE_KEY) === "1";
}

function saveSideRoadsEnabled(): void {
  window.localStorage.setItem(SIDE_ROADS_STORAGE_KEY, state.showSideRoads ? "1" : "0");
}

function scheduleSearch(): void {
  if (searchTimer != null) {
    window.clearTimeout(searchTimer);
  }

  searchTimer = window.setTimeout(() => {
    void runSearch();
  }, 350);
}

function scheduleOriginSearch(): void {
  if (originSearchTimer != null) {
    window.clearTimeout(originSearchTimer);
  }

  originSearchTimer = window.setTimeout(() => {
    void runOriginSearch();
  }, 350);
}

async function runSearch(): Promise<void> {
  const query = state.query.trim();
  if (query.length < 3) {
    state.results = [];
    state.searching = false;
    updateResultsSlot();
    return;
  }

  state.searching = true;
  state.error = null;
  updateResultsSlot();

  try {
    const results = await searchPlaces(query);
    if (state.query.trim() === query) {
      state.results = results;
    }
  } catch (error) {
    if (state.query.trim() === query) {
      state.error = toMessage(error);
      state.results = [];
    }
  } finally {
    if (state.query.trim() === query) {
      state.searching = false;
    }
    updateResultsSlot();
  }
}

async function runOriginSearch(): Promise<void> {
  const query = state.originQuery.trim();
  if (query.length < 3) {
    state.originResults = [];
    state.originSearching = false;
    updateOriginResultsSlot();
    return;
  }

  state.originSearching = true;
  state.error = null;
  updateOriginResultsSlot();

  try {
    const results = await searchPlaces(query);
    if (state.originQuery.trim() === query) {
      state.originResults = results;
    }
  } catch (error) {
    if (state.originQuery.trim() === query) {
      state.error = toMessage(error);
      state.originResults = [];
    }
  } finally {
    if (state.originQuery.trim() === query) {
      state.originSearching = false;
    }
    updateOriginResultsSlot();
  }
}

function startLocationWatch(target: "origin" | "destination" = "origin"): void {
  if (!("geolocation" in navigator)) {
    state.error = "This WebView does not expose location services.";
    state.locationStatus = target === "origin"
      ? "Tap the Start field, then tap the map as a fallback."
      : "Tap the Destination field, then tap the map as a fallback.";
    render();
    return;
  }

  if (!window.isSecureContext) {
    state.error = "Location requires a secure WebView or localhost.";
    state.locationStatus = target === "origin"
      ? "Tap the Start field, then tap the map for local testing."
      : "Tap the Destination field, then tap the map for local testing.";
    render();
    return;
  }

  state.locating = true;
  state.locatingFor = target;
  state.error = null;
  state.locationStatus = target === "origin"
    ? "Requesting phone location for start..."
    : "Requesting phone location for destination...";
  render();

  if (positionWatchId != null) {
    navigator.geolocation.clearWatch(positionWatchId);
    positionWatchId = null;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      applyCurrentLocation(position, target);
      if (target === "origin") {
        startGpsWatch();
      }
    },
    (error) => {
      state.locating = false;
      state.locatingFor = null;
      state.error = geolocationErrorMessage(error);
      state.locationStatus = target === "origin"
        ? "Phone GPS unavailable. Tap the Start field, then tap the map to choose a starting point."
        : "Phone GPS unavailable. Tap the Destination field, then tap the map to choose a destination.";
      if (target === "origin") {
        startGpsWatch(false);
      }
      render();
    },
    locationOptions()
  );
}

function startGpsWatch(clearErrors = true): void {
  positionWatchId = navigator.geolocation.watchPosition(
    (position) => {
      applyGpsOrigin(position);
      void updateGlass();
      render();
    },
    (error) => {
      state.locating = false;
      state.locatingFor = null;
      if (clearErrors) {
        state.error = geolocationErrorMessage(error);
      }
      state.locationStatus = "Waiting for GPS. Keep the Even app open and confirm phone location permission.";
      render();
    },
    locationOptions()
  );
}

function applyCurrentLocation(position: GeolocationPosition, target: "origin" | "destination"): void {
  if (target === "origin") {
    applyGpsOrigin(position);
    return;
  }

  applyGpsDestination(position);
}

function applyGpsOrigin(position: GeolocationPosition): void {
  stopDevDriving();
  state.locating = false;
  state.locatingFor = null;
  state.position = {
    coordinate: {
      lat: position.coords.latitude,
      lon: position.coords.longitude
    },
    speedMetersPerSecond: position.coords.speed,
    headingDegrees: position.coords.heading
  };
  state.locationSource = "gps";
  state.originQuery = "Current Location";
  state.originLabel = "Current Location";
  state.originResults = [];
  state.originSearching = false;
  state.locationStatus = `Phone GPS locked (${position.coords.accuracy.toFixed(0)} m accuracy).`;
  state.error = null;
  handleOriginPositionChanged();
}

function applyGpsDestination(position: GeolocationPosition): void {
  state.locating = false;
  state.locatingFor = null;
  const coordinate = {
    lat: position.coords.latitude,
    lon: position.coords.longitude
  };

  state.selectedPlace = {
    id: `current-destination-${coordinate.lat.toFixed(6)}-${coordinate.lon.toFixed(6)}`,
    label: "Current Location",
    coordinate
  };
  applyDestination(state.selectedPlace);
  state.locationStatus = `Destination set to current location (${position.coords.accuracy.toFixed(0)} m accuracy).`;
  state.error = null;
  void ensureRouteReady();
}

function handleOriginPositionChanged(): void {
  if (!state.selectedPlace || state.routing) {
    return;
  }

  if (state.navigating && state.route) {
    evaluateAutoReroute();
    return;
  }

  if (!state.route) {
    state.routeRequestId += 1;
    void ensureRouteReady();
  }
}

function locationOptions(): PositionOptions {
  return {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 15000
  };
}

async function ensureRouteReady(): Promise<void> {
  if (!state.position || !state.selectedPlace) {
    return;
  }

  const requestId = state.routeRequestId + 1;
  state.routeRequestId = requestId;
  state.routing = true;
  state.route = null;
  state.navigating = false;
  state.error = null;
  updateStatsCard();
  render();

  try {
    const route = await fetchDrivingRoute(
      state.position.coordinate,
      state.selectedPlace.coordinate,
      state.selectedPlace.label
    );
    if (state.routeRequestId !== requestId) {
      return;
    }

    state.route = route;
    if (state.locationSource === "simulated") {
      snapSimulatedGpsToRoute(route);
    }
    state.nextStepIndex = 0;
    state.offRouteSampleCount = 0;
    state.locationStatus = "Route ready.";
    if (state.startWhenRouteReady) {
      state.startWhenRouteReady = false;
      state.navigating = true;
      await updateGlass();
    }
  } catch (error) {
    if (state.routeRequestId === requestId) {
      state.error = toMessage(error);
    }
  } finally {
    if (state.routeRequestId === requestId) {
      state.routing = false;
      render();
    }
  }
}

function evaluateAutoReroute(): void {
  if (!state.route || !state.position || !state.selectedPlace || !state.navigating || state.routing) {
    state.offRouteSampleCount = 0;
    return;
  }

  const snapshot = makeGuidanceSnapshot(
    state.route,
    state.position,
    state.mode,
    state.nextStepIndex,
    state.unitSystem
  );
  state.nextStepIndex = snapshot.nextStepIndex;

  if (!snapshot.offRoute) {
    state.offRouteSampleCount = 0;
    return;
  }

  state.offRouteSampleCount += 1;
  const now = Date.now();
  if (
    state.offRouteSampleCount >= AUTO_REROUTE_SAMPLE_THRESHOLD &&
    now - state.lastAutoRerouteAt >= AUTO_REROUTE_COOLDOWN_MS
  ) {
    state.lastAutoRerouteAt = now;
    void rerouteFromCurrentPosition();
  }
}

async function rerouteFromCurrentPosition(): Promise<void> {
  if (!state.position || !state.selectedPlace || state.routing) {
    return;
  }

  const requestId = state.routeRequestId + 1;
  state.routeRequestId = requestId;
  state.routing = true;
  state.autoRerouting = true;
  state.startWhenRouteReady = false;
  state.error = null;
  state.locationStatus = "Off route. Recalculating route...";
  render();

  try {
    const route = await fetchDrivingRoute(
      state.position.coordinate,
      state.selectedPlace.coordinate,
      state.selectedPlace.label
    );
    if (state.routeRequestId !== requestId) {
      return;
    }

    state.route = route;
    state.nextStepIndex = 0;
    state.navigating = true;
    state.offRouteSampleCount = 0;
    state.locationStatus = "Route recalculated.";
    await updateGlass();
  } catch (error) {
    if (state.routeRequestId === requestId) {
      state.error = `Reroute failed: ${toMessage(error)}`;
      state.locationStatus = "Reroute failed. Staying on current route.";
    }
  } finally {
    if (state.routeRequestId === requestId) {
      state.routing = false;
      state.autoRerouting = false;
      render();
    }
  }
}

async function buildDevTestRoute(): Promise<void> {
  stopDevDriving();
  applySimulatedOrigin(DEV_TEST_ORIGIN, DEV_TEST_DESTINATION);
  state.selectedPlace = DEV_TEST_DESTINATION;
  state.query = DEV_TEST_DESTINATION.label;
  state.results = [];
  state.activeSearchField = null;
  state.startWhenRouteReady = true;
  await ensureRouteReady();
  if (state.route) {
    state.navigating = true;
    state.nextStepIndex = 0;
    state.locationStatus = "Dev test route running with simulated GPS at Hulftegg Passhoehe.";
    await updateGlass();
    render();
  }
}

async function toggleDevDriving(): Promise<void> {
  if (state.devDriving) {
    stopDevDriving("Simulated drive paused.");
    render();
    return;
  }

  if (!state.route || state.locationSource !== "simulated") {
    await buildDevTestRoute();
  }

  if (!state.route) {
    return;
  }

  startDevDriving();
}

function startDevDriving(): void {
  if (!state.route || state.route.geometry.length < 2) {
    state.error = "No route geometry available for driving simulation.";
    render();
    return;
  }

  if (devDriveTimer != null) {
    window.clearInterval(devDriveTimer);
  }

  state.locationSource = "simulated";
  state.navigating = true;
  state.devDriving = true;
  state.error = null;
  devDriveDistanceMeters = distanceAlongRoute(state.route.geometry, state.position?.coordinate ?? state.route.geometry[0]);
  lastDevDriveAt = performance.now();
  devDriveTimer = window.setInterval(tickDevDriving, 250);
  tickDevDriving();
  render();
}

function stopDevDriving(status?: string): void {
  if (devDriveTimer != null) {
    window.clearInterval(devDriveTimer);
    devDriveTimer = null;
  }

  if (state.devDriving) {
    state.devDriving = false;
  }

  if (status) {
    state.locationStatus = status;
  }
}

function canCancelNavigation(): boolean {
  return state.routing || state.navigating || state.devDriving || state.startWhenRouteReady;
}

function cancelNavigation(status = "Navigation stopped."): void {
  stopDevDriving();
  state.routeRequestId += 1;
  state.routing = false;
  state.autoRerouting = false;
  state.navigating = false;
  state.startWhenRouteReady = false;
  state.offRouteSampleCount = 0;
  state.error = null;
  state.locationStatus = status;
  void updateGlass();
  render();
}

function tickDevDriving(): void {
  if (!state.route || !state.devDriving) {
    stopDevDriving();
    return;
  }

  const now = performance.now();
  const elapsedSeconds = Math.min(0.75, Math.max(0, (now - lastDevDriveAt) / 1000));
  lastDevDriveAt = now;
  devDriveDistanceMeters += devDriveSpeedMetersPerSecond() * elapsedSeconds;
  const routeLength = routeGeometryLength(state.route.geometry);

  if (devDriveDistanceMeters >= routeLength) {
    devDriveDistanceMeters = routeLength;
    stopDevDriving("Simulated drive arrived.");
  }

  const sample = sampleRouteAtDistance(state.route.geometry, devDriveDistanceMeters);
  state.position = {
    coordinate: sample.coordinate,
    speedMetersPerSecond: state.devDriving ? devDriveSpeedMetersPerSecond() : 0,
    headingDegrees: sample.headingDegrees
  };
  state.locationStatus = state.devDriving
    ? `Simulated drive running at ${formatDevDriveSpeed()}.`
    : state.locationStatus;
  void updateGlass();
  updateStatsCard();
  syncCurrentMarker();
}

function devDriveSpeedMetersPerSecond(): number {
  return state.devDriveSpeedMetersPerSecond;
}

function formatDevDriveSpeed(): string {
  const speed = devDriveSpeedMetersPerSecond();
  if (state.unitSystem === "metric") {
    return `${Math.round(speed * 3.6)} km/h`;
  }

  return `${Math.round(speed * 2.236936)} mph`;
}

function defaultDevDriveSpeed(mode: TravelMode): number {
  return mode === "motorcycle" ? 24.6 : 29.1;
}

function devSliderValueToMetersPerSecond(value: number): number {
  if (!Number.isFinite(value)) {
    return defaultDevDriveSpeed(state.mode);
  }

  return state.unitSystem === "metric" ? value / 3.6 : value / 2.236936;
}

function devSpeedSliderValue(): number {
  const speed = devDriveSpeedMetersPerSecond();
  return state.unitSystem === "metric"
    ? Math.round(speed * 3.6)
    : Math.round(speed * 2.236936);
}

function devSpeedSliderMin(): number {
  return state.unitSystem === "metric" ? 10 : 5;
}

function devSpeedSliderMax(): number {
  return state.unitSystem === "metric" ? 180 : 110;
}

function devSpeedSliderStep(): number {
  return 5;
}

function updateDevSpeedReadout(): void {
  const readout = document.querySelector<HTMLElement>("#dev-speed-readout");
  if (readout) {
    readout.textContent = formatDevDriveSpeed();
  }
}

function startNavigation(): void {
  if (!state.position || !state.selectedPlace || state.navigating) {
    return;
  }

  if (!state.route) {
    state.startWhenRouteReady = true;
    render();
    void ensureRouteReady().then(() => {
      render();
    });
    return;
  }

  state.startWhenRouteReady = false;
  state.navigating = true;
  state.nextStepIndex = 0;
  state.offRouteSampleCount = 0;
  void updateGlass();
  render();
}

async function updateGlass(): Promise<void> {
  const snapshot = currentSnapshot();
  await glassDisplay.render(snapshot);
}

function currentSnapshot(): GuidanceSnapshot {
  if (state.glassesScreen === "settings") {
    return glassesSettingsSnapshot();
  }

  if (!state.navigating) {
    if (state.glassesScreen === "favoriteOrigin") {
      return favoriteGlassesSnapshot("origin");
    }

    if (state.glassesScreen === "favoriteDestination") {
      return favoriteGlassesSnapshot("destination");
    }

    if (state.glassesScreen === "routeReady") {
      return routeReadyGlassesSnapshot();
    }

    return homeGlassesSnapshot();
  }

  if (!state.route || !state.position) {
    return homeGlassesSnapshot();
  }

  const snapshot = withDisplayPreferences(
    makeGuidanceSnapshot(state.route, state.position, state.mode, state.nextStepIndex, state.unitSystem)
  );
  state.nextStepIndex = snapshot.nextStepIndex;
  return state.guidanceView === "map" ? mapGlassesSnapshot(snapshot) : snapshot;
}

function withDisplayPreferences(snapshot: GuidanceSnapshot): GuidanceSnapshot {
  return {
    ...snapshot,
    showSideRoads: state.showSideRoads
  };
}

function routeReadyGlassesSnapshot(): GuidanceSnapshot {
  const origin = originInputValue() || state.glassesSelectedOrigin?.label || "Start";
  const destination = state.selectedPlace?.label ?? "Destination";
  const routeStatus = state.routing ? "Building route" : state.route ? "Ready to ride" : "Route needed";
  return {
    active: false,
    title: "Route Ready",
    primary: routeStatus,
    secondary: `${shortGlassLabel(origin)} -> ${shortGlassLabel(destination)}`,
    tertiary: state.route ? "Swipe down to start" : "Building automatically",
    hint: "Double back",
    arrow: "--",
    nextStepIndex: 0,
    distanceToStepMeters: 0,
    offRoute: false
  };
}

function homeGlassesSnapshot(): GuidanceSnapshot {
  const hasFavorites = glassesFavoriteOptions().length > 0;
  const hasPhoneRoute = Boolean(state.position && state.selectedPlace);
  const gpsStatus = hasPhoneRoute ? "Route ready" : state.position ? "GPS ready" : "No GPS connection";
  return {
    active: false,
    title: "Apexline",
    primary: gpsStatus,
    secondary: hasPhoneRoute ? "Swipe down starts" : hasFavorites ? "Click to choose favorites" : "Save favorites on phone",
    tertiary: state.position ? "Phone route available" : "Pick start and finish",
    hint: state.devToolsEnabled ? "Dev test favorites ready" : "Ride ready",
    arrow: "--",
    nextStepIndex: 0,
    distanceToStepMeters: 0,
    offRoute: false
  };
}

function favoriteGlassesSnapshot(target: "origin" | "destination"): GuidanceSnapshot {
  const favorite = selectedGlassesFavorite(target);
  if (!favorite) {
    return makeIdleSnapshot("No favorites saved");
  }

  const index = favoriteIndex(target) + 1;
  const count = glassesFavoriteOptions().length;
  return {
    active: false,
    title: target === "origin" ? "Choose Start" : "Choose Finish",
    primary: favorite.label,
    secondary: `${index}/${count}`,
    tertiary: `Click selects ${target === "origin" ? "start" : "finish"}`,
    hint: "Swipe changes | Double back",
    arrow: "--",
    nextStepIndex: 0,
    distanceToStepMeters: 0,
    offRoute: false
  };
}

function glassesSettingsSnapshot(): GuidanceSnapshot {
  const setting = glassesSettings()[state.glassesSettingsIndex] ?? glassesSettings()[0];
  return {
    active: false,
    title: "Settings",
    primary: `${state.glassesSettingsIndex + 1}/${glassesSettings().length} ${setting.label}`,
    secondary: setting.value(),
    tertiary: "Click changes | Swipe moves",
    hint: "Double back",
    arrow: "--",
    nextStepIndex: 0,
    distanceToStepMeters: 0,
    offRoute: false
  };
}

function mapGlassesSnapshot(snapshot: GuidanceSnapshot): GuidanceSnapshot {
  if (!state.route) {
    return snapshot;
  }

  const step = state.route.steps[snapshot.nextStepIndex];
  return {
    ...snapshot,
    title: "Apex Map",
    primary: snapshot.offRoute ? "REROUTE NEEDED" : snapshot.primary,
    secondary: step ? `${snapshot.arrow} ${step.instruction}` : snapshot.secondary,
    hint: "Map view | Double exits"
  };
}

function handleGlassInput(action: GlassAction): void {
  if (action === "long") {
    state.glassesScreen = state.glassesScreen === "settings" ? "home" : "settings";
    void updateGlass();
    render();
    return;
  }

  if (state.glassesScreen === "settings") {
    handleGlassesSettingsInput(action);
    return;
  }

  if (state.navigating) {
    if (action === "double") {
      state.glassesScreen = "home";
      cancelNavigation("Navigation stopped.");
      return;
    }

    void updateGlass();
    return;
  }

  if (state.glassesScreen === "favoriteOrigin") {
    handleFavoritePickerInput("origin", action);
    return;
  }

  if (state.glassesScreen === "favoriteDestination") {
    handleFavoritePickerInput("destination", action);
    return;
  }

  if (state.glassesScreen === "routeReady") {
    handleRouteReadyInput(action);
    return;
  }

  if (action === "double") {
    state.glassesScreen = "settings";
    void updateGlass();
    render();
    return;
  }

  if (action === "press" && glassesFavoriteOptions().length > 0) {
    state.glassesScreen = "favoriteOrigin";
    void updateGlass();
    return;
  }

  if (action === "down" && state.position && state.selectedPlace) {
    startGlassesNavigation();
    return;
  }

  void updateGlass();
  render();
}

function handleFavoritePickerInput(target: "origin" | "destination", action: "press" | "double" | "up" | "down"): void {
  if (action === "double") {
    state.glassesScreen = target === "origin" ? "home" : "favoriteOrigin";
    void updateGlass();
    return;
  }

  if (action === "up" || action === "down") {
    cycleGlassesFavorite(target, action === "up" ? -1 : 1);
    void updateGlass();
    return;
  }

  if (action !== "press") {
    return;
  }

  const favorite = selectedGlassesFavorite(target);
  if (!favorite) {
    return;
  }

  if (target === "origin") {
    state.glassesSelectedOrigin = favorite;
    primeDestinationFavoriteIndex(favorite);
    state.glassesScreen = "favoriteDestination";
    void updateGlass();
    render();
    return;
  }

  selectGlassesDestination(favorite);
}

function handleRouteReadyInput(action: "press" | "double" | "up" | "down"): void {
  if (action === "double") {
    state.glassesScreen = "home";
    state.startWhenRouteReady = false;
    void updateGlass();
    return;
  }

  if (action === "press") {
    startGlassesNavigation();
    return;
  }

  if (action === "down") {
    startGlassesNavigation();
  }
}

function handleGlassesSettingsInput(action: "press" | "double" | "up" | "down"): void {
  if (action === "double") {
    state.glassesScreen = "home";
    void updateGlass();
    return;
  }

  if (action === "up" || action === "down") {
    const count = glassesSettings().length;
    const delta = action === "up" ? -1 : 1;
    state.glassesSettingsIndex = (state.glassesSettingsIndex + delta + count) % count;
    void updateGlass();
    return;
  }

  if (action === "press") {
    glassesSettings()[state.glassesSettingsIndex]?.toggle();
    void updateGlass();
    render();
  }
}

function selectedGlassesFavorite(target: "origin" | "destination" = "destination"): PlaceResult | null {
  const favorites = glassesFavoriteOptions();
  if (favorites.length === 0) {
    return null;
  }

  const index = Math.min(Math.max(favoriteIndex(target), 0), favorites.length - 1);
  return favorites[index] ?? null;
}

function cycleGlassesFavorite(target: "origin" | "destination", delta: number): void {
  const favorites = glassesFavoriteOptions();
  if (favorites.length === 0) {
    setFavoriteIndex(target, 0);
    return;
  }

  setFavoriteIndex(target, (favoriteIndex(target) + delta + favorites.length) % favorites.length);
}

function favoriteIndex(target: "origin" | "destination"): number {
  return target === "origin" ? state.glassesStartFavoriteIndex : state.glassesDestinationFavoriteIndex;
}

function setFavoriteIndex(target: "origin" | "destination", index: number): void {
  if (target === "origin") {
    state.glassesStartFavoriteIndex = index;
  } else {
    state.glassesDestinationFavoriteIndex = index;
  }
  state.glassesFavoriteIndex = index;
}

function primeDestinationFavoriteIndex(origin: PlaceResult): void {
  const favorites = glassesFavoriteOptions();
  if (favorites.length < 2) {
    return;
  }

  const selectedDestination = favorites[state.glassesDestinationFavoriteIndex];
  if (selectedDestination && !samePlace(selectedDestination, origin)) {
    return;
  }

  const nextIndex = favorites.findIndex((favorite) => !samePlace(favorite, origin));
  if (nextIndex >= 0) {
    state.glassesDestinationFavoriteIndex = nextIndex;
    state.glassesFavoriteIndex = nextIndex;
  }
}

function selectGlassesDestination(destination: PlaceResult): void {
  const origin = state.glassesSelectedOrigin;
  if (origin) {
    if (state.devToolsEnabled) {
      applySimulatedOrigin(origin, destination);
    } else {
      applyManualOrigin(origin);
    }
  }

  selectFavoriteDestination(destination);
  state.glassesScreen = "routeReady";
  state.startWhenRouteReady = false;
  void ensureRouteReady().then(() => {
    void updateGlass();
  });
  void updateGlass();
  render();
}

function startGlassesNavigation(): void {
  if (!state.position || !state.selectedPlace) {
    state.glassesScreen = "favoriteOrigin";
    void updateGlass();
    return;
  }

  if (!state.route) {
    state.startWhenRouteReady = true;
    void ensureRouteReady().then(() => {
      if (state.route && state.locationSource === "simulated") {
        startDevDriving();
      }
    });
    void updateGlass();
    render();
    return;
  }

  if (state.locationSource === "simulated") {
    startDevDriving();
    return;
  }

  startNavigation();
}

function glassesSettings(): Array<{ label: string; value: () => string; toggle: () => void }> {
  return [
    {
      label: "Guidance view",
      value: () => state.guidanceView === "map" ? "Map HUD" : "Arrow HUD",
      toggle: () => {
        state.guidanceView = state.guidanceView === "map" ? "arrows" : "map";
      }
    },
    {
      label: "Ride mode",
      value: () => state.mode === "motorcycle" ? "Moto" : "Drive",
      toggle: () => {
        setTravelMode(state.mode === "car" ? "motorcycle" : "car");
      }
    },
    {
      label: "Units",
      value: () => state.unitSystem === "metric" ? "Metric" : "Imperial",
      toggle: () => {
        state.unitSystem = state.unitSystem === "metric" ? "imperial" : "metric";
        saveUnitSystem();
      }
    },
    {
      label: "Side roads",
      value: () => state.showSideRoads ? "Shown at complex turns" : "Hidden",
      toggle: () => {
        state.showSideRoads = !state.showSideRoads;
        saveSideRoadsEnabled();
      }
    }
  ];
}

function glassesFavoriteOptions(): PlaceResult[] {
  if (!state.devToolsEnabled) {
    return state.favorites;
  }

  const devFavorites = [DEV_TEST_ORIGIN, DEV_TEST_DESTINATION].filter(
    (devFavorite) => !state.favorites.some((favorite) => samePlace(favorite, devFavorite))
  );
  return [...devFavorites, ...state.favorites];
}

function shortGlassLabel(label: string): string {
  return label.length > 24 ? `${label.slice(0, 21)}...` : label;
}

function canStartNavigation(): boolean {
  return Boolean(state.position && state.selectedPlace && !state.navigating);
}

function syncMap(focusDestination = false): void {
  const mapElement = document.querySelector<HTMLDivElement>("#map");
  if (!mapElement) {
    return;
  }

  if (!map) {
    map = L.map(mapElement, {
      zoomControl: true,
      attributionControl: true
    }).setView(initialMapCenter(), state.position ? 13 : 11);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    map.on("click", (event) => {
      const coordinate = {
        lat: event.latlng.lat,
        lon: event.latlng.lng
      };
      if (state.activeSearchField === "origin") {
        void selectManualOrigin(coordinate);
        return;
      }

      void selectMapPin(coordinate);
    });
  }

  map.invalidateSize();
  syncCurrentMarker();
  syncDestinationMarker();
  syncRouteLine();

  if (focusDestination && state.selectedPlace) {
    map.setView(toLatLng(state.selectedPlace.coordinate), Math.max(map.getZoom(), 15));
    return;
  }

  const bounds = boundsForVisiblePoints();
  if (bounds) {
    map.fitBounds(bounds, { padding: [26, 26], maxZoom: 15 });
  }
}

function disposeMap(): void {
  if (!map) {
    return;
  }

  map.remove();
  map = null;
  destinationMarker = null;
  currentMarker = null;
  routeLine = null;
}

async function selectMapPin(coordinate: PlaceResult["coordinate"]): Promise<void> {
  const fallbackPlace: PlaceResult = {
    id: `pin-${coordinate.lat.toFixed(6)}-${coordinate.lon.toFixed(6)}`,
    label: `Pin ${coordinate.lat.toFixed(5)}, ${coordinate.lon.toFixed(5)}`,
    coordinate
  };

  state.selectedPlace = fallbackPlace;
  applyDestination(fallbackPlace);
  state.error = null;
  render();

  try {
    const resolvedPlace = await reverseGeocodePlace(coordinate);
    if (state.selectedPlace?.id === fallbackPlace.id) {
      applyDestination(resolvedPlace);
      render();
      void ensureRouteReady();
    }
  } catch {
    // The pin coordinates are still valid if reverse lookup is unavailable.
  }
}

async function selectManualOrigin(coordinate: PlaceResult["coordinate"]): Promise<void> {
  if (positionWatchId != null) {
    navigator.geolocation.clearWatch(positionWatchId);
    positionWatchId = null;
  }

  const fallbackPlace: PlaceResult = {
    id: `origin-${coordinate.lat.toFixed(6)}-${coordinate.lon.toFixed(6)}`,
    label: `Start ${coordinate.lat.toFixed(5)}, ${coordinate.lon.toFixed(5)}`,
    coordinate
  };

  applyManualOrigin(fallbackPlace);
  render();

  try {
    const resolvedPlace = await reverseGeocodePlace(coordinate);
    if (state.position && distanceBetweenSameStart(coordinate, state.position.coordinate)) {
      applyManualOrigin(resolvedPlace);
      render();
      void ensureRouteReady();
    }
  } catch {
    // The coordinates are enough for routing even if reverse lookup is unavailable.
  }
}

function applyManualOrigin(place: PlaceResult): void {
  stopDevDriving();
  if (positionWatchId != null) {
    navigator.geolocation.clearWatch(positionWatchId);
    positionWatchId = null;
  }

  state.position = {
    coordinate: place.coordinate,
    speedMetersPerSecond: null,
    headingDegrees: null
  };
  state.originQuery = place.label;
  state.originLabel = place.label;
  state.originResults = [];
  state.originSearching = false;
  state.locationSource = "manual";
  state.locationStatus = `Start set: ${place.label}`;
  state.route = null;
  state.navigating = false;
  state.offRouteSampleCount = 0;
  state.routeRequestId += 1;
  state.error = null;
}

function applySimulatedOrigin(origin: PlaceResult, destination: PlaceResult): void {
  if (positionWatchId != null) {
    navigator.geolocation.clearWatch(positionWatchId);
    positionWatchId = null;
  }

  state.position = {
    coordinate: origin.coordinate,
    speedMetersPerSecond: 0,
    headingDegrees: bearingDegrees(origin.coordinate, destination.coordinate)
  };
  state.originQuery = origin.label;
  state.originLabel = origin.label;
  state.originResults = [];
  state.originSearching = false;
  state.locationSource = "simulated";
  state.locationStatus = `Simulated GPS at start: ${origin.label}`;
  state.route = null;
  state.navigating = false;
  state.offRouteSampleCount = 0;
  state.routeRequestId += 1;
  state.error = null;
}

function snapSimulatedGpsToRoute(route: RouteResult): void {
  if (!state.position || route.geometry.length === 0) {
    return;
  }

  const start = route.geometry[0];
  const headingTarget = route.geometry.find((point) => distanceBetweenSameStart(point, start) === false) ??
    route.steps[0]?.maneuverLocation ??
    route.destination;

  state.position = {
    coordinate: start,
    speedMetersPerSecond: 0,
    headingDegrees: bearingDegrees(start, headingTarget)
  };
  state.locationStatus = "Simulated GPS snapped to the start of the driving route.";
}

function routeGeometryLength(geometry: RouteResult["geometry"]): number {
  let total = 0;
  for (let index = 1; index < geometry.length; index += 1) {
    total += distanceMeters(geometry[index - 1], geometry[index]);
  }
  return total;
}

function distanceAlongRoute(geometry: RouteResult["geometry"], coordinate: PlaceResult["coordinate"]): number {
  if (geometry.length < 2) {
    return 0;
  }

  let nearestSegment = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestT = 0;
  for (let index = 0; index < geometry.length - 1; index += 1) {
    const projection = projectToSegment(coordinate, geometry[index], geometry[index + 1]);
    if (projection.distanceMeters < nearestDistance) {
      nearestDistance = projection.distanceMeters;
      nearestSegment = index;
      nearestT = projection.t;
    }
  }

  let distance = 0;
  for (let index = 1; index <= nearestSegment; index += 1) {
    distance += distanceMeters(geometry[index - 1], geometry[index]);
  }
  return distance + distanceMeters(geometry[nearestSegment], geometry[nearestSegment + 1]) * nearestT;
}

function sampleRouteAtDistance(
  geometry: RouteResult["geometry"],
  targetMeters: number
): { coordinate: PlaceResult["coordinate"]; headingDegrees: number } {
  if (geometry.length === 0) {
    return { coordinate: DEV_TEST_ORIGIN.coordinate, headingDegrees: 0 };
  }

  if (geometry.length === 1) {
    return { coordinate: geometry[0], headingDegrees: 0 };
  }

  let traveled = 0;
  for (let index = 1; index < geometry.length; index += 1) {
    const start = geometry[index - 1];
    const end = geometry[index];
    const segmentLength = distanceMeters(start, end);
    if (traveled + segmentLength >= targetMeters) {
      const t = segmentLength === 0 ? 0 : (targetMeters - traveled) / segmentLength;
      const coordinate = {
        lat: start.lat + (end.lat - start.lat) * t,
        lon: start.lon + (end.lon - start.lon) * t
      };
      return {
        coordinate,
        headingDegrees: bearingDegrees(coordinate, end)
      };
    }
    traveled += segmentLength;
  }

  const last = geometry[geometry.length - 1];
  const previous = geometry[geometry.length - 2];
  return {
    coordinate: last,
    headingDegrees: bearingDegrees(previous, last)
  };
}

function projectToSegment(
  coordinate: PlaceResult["coordinate"],
  start: PlaceResult["coordinate"],
  end: PlaceResult["coordinate"]
): { t: number; distanceMeters: number } {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos((coordinate.lat * Math.PI) / 180);
  const startX = (start.lon - coordinate.lon) * metersPerDegreeLon;
  const startY = (start.lat - coordinate.lat) * metersPerDegreeLat;
  const endX = (end.lon - coordinate.lon) * metersPerDegreeLon;
  const endY = (end.lat - coordinate.lat) * metersPerDegreeLat;
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, -(startX * segmentX + startY * segmentY) / lengthSquared));
  const nearestX = startX + t * segmentX;
  const nearestY = startY + t * segmentY;
  return {
    t,
    distanceMeters: Math.hypot(nearestX, nearestY)
  };
}

function syncDestinationMarker(): void {
  if (!map) {
    return;
  }

  if (!state.selectedPlace) {
    destinationMarker?.remove();
    destinationMarker = null;
    return;
  }

  const coordinate = state.selectedPlace.coordinate;
  if (!destinationMarker) {
    destinationMarker = L.marker(toLatLng(coordinate), {
      icon: L.divIcon({
        className: "destination-pin",
        html: "<span></span>",
        iconSize: [28, 34],
        iconAnchor: [14, 31]
      })
    }).addTo(map);
  } else {
    destinationMarker.setLatLng(toLatLng(coordinate));
  }

  destinationMarker.bindTooltip(state.selectedPlace.label, {
    direction: "top",
    offset: [0, -26],
    opacity: 0.92
  });
}

function syncCurrentMarker(): void {
  if (!map) {
    return;
  }

  if (!state.position) {
    currentMarker?.remove();
    currentMarker = null;
    return;
  }

  const coordinate = toLatLng(state.position.coordinate);
  if (!currentMarker) {
    currentMarker = L.circleMarker(coordinate, {
      radius: 7,
      weight: 3,
      color: "#11120f",
      fillColor: "#6ee1c7",
      fillOpacity: 1
    }).addTo(map);
  } else {
    currentMarker.setLatLng(coordinate);
  }
}

function syncRouteLine(): void {
  if (!map) {
    return;
  }

  if (!state.route || state.route.geometry.length === 0) {
    routeLine?.remove();
    routeLine = null;
    return;
  }

  const points = state.route.geometry.map(toLatLng);
  if (!routeLine) {
    routeLine = L.polyline(points, {
      color: "#f1c64b",
      weight: 5,
      opacity: 0.92
    }).addTo(map);
  } else {
    routeLine.setLatLngs(points);
  }
}

function boundsForVisiblePoints(): L.LatLngBounds | null {
  const points: LatLngExpression[] = [];
  if (state.position) {
    points.push(toLatLng(state.position.coordinate));
  }

  if (state.selectedPlace) {
    points.push(toLatLng(state.selectedPlace.coordinate));
  }

  if (state.route?.geometry.length) {
    points.push(...state.route.geometry.map(toLatLng));
  }

  return points.length > 0 ? L.latLngBounds(points) : null;
}

function initialMapCenter(): LatLngExpression {
  if (state.position) {
    return toLatLng(state.position.coordinate);
  }

  if (state.selectedPlace) {
    return toLatLng(state.selectedPlace.coordinate);
  }

  return [39.8283, -98.5795];
}

function toLatLng(coordinate: PlaceResult["coordinate"]): LatLngExpression {
  return [coordinate.lat, coordinate.lon];
}

function distanceBetweenSameStart(a: PlaceResult["coordinate"], b: PlaceResult["coordinate"]): boolean {
  return Math.abs(a.lat - b.lat) < 0.00001 && Math.abs(a.lon - b.lon) < 0.00001;
}

function locationSourceLabel(): string {
  if (state.locationSource === "gps") {
    return "Phone GPS";
  }

  if (state.locationSource === "manual") {
    return "Map start";
  }

  if (state.locationSource === "simulated") {
    return "Sim GPS";
  }

  return "--";
}

function geolocationErrorMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location permission was denied. Enable Location for the Even Realities app, then try again.";
  }

  if (error.code === error.POSITION_UNAVAILABLE) {
    return "The phone could not determine its location right now.";
  }

  if (error.code === error.TIMEOUT) {
    return "Location timed out. Keep the Even app open on screen and try again.";
  }

  return error.message || "Location failed.";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}
