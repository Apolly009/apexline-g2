import { makeGuidanceSnapshot, makeIdleSnapshot, type GuidanceSnapshot, type PositionSample } from "./guidance";
import { GlassDisplay } from "./glasses";
import { waitForEvenAppBridge } from "@evenrealities/even_hub_sdk";
import L, { type LatLngExpression, type Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  type PlaceResult,
  type RouteResult,
  type TravelMode,
  type UnitSystem,
  bearingDegrees,
  distanceMeters,
  fetchBicycleRoute,
  formatDistance,
  formatEta,
  formatSpeed,
  reverseGeocodePlace,
  searchPlaces
} from "./navigation";
import "./styles.css";

type AppState = {
  mode: TravelMode;
  unitSystem: UnitSystem;
  guidanceView: "arrows" | "map";
  showSideRoads: boolean;
  showSpeed: boolean;
  showControlHints: boolean;
  nightMode: boolean;
  arrowLayout: "left" | "bottom";
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
  glassesHomeSelectionIndex: number;
  glassesScreen: "splash" | "homeTransition" | "home" | "homeMenu" | "favoriteOrigin" | "favoriteDestination" | "routeReady" | "settings" | "speed";
  glassesSelectedOrigin: PlaceResult | null;
  devToolsEnabled: boolean;
  selectedPlace: PlaceResult | null;
  route: RouteResult | null;
  position: PositionSample | null;
  locationSource: "gps" | "manual" | "simulated" | null;
  locationStatus: string;
  lastLocationError: LocationDiagnostic | null;
  favoriteStorageStatus: string;
  nextStepIndex: number;
  error: string | null;
};

type GlassAction = "press" | "double" | "up" | "down" | "long";
type GlassPickerTarget = "origin" | "destination";
type GlassPickerOption = PlaceResult & {
  badge?: string;
  disabled?: boolean;
};
type LocationDiagnostic = {
  source: "getCurrentPosition" | "watchPosition" | "feature-check" | "secure-context";
  target: "origin" | "destination";
  code: number | null;
  codeName: string;
  message: string;
  at: number;
  secureContext: boolean;
  hasGeolocation: boolean;
};
type StoredFavoritesEnvelope = {
  version: 1;
  updatedAt: number;
  favorites: PlaceResult[];
};
type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};
type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

const FAVORITES_STORAGE_KEY = "apexbike-favorites";
const FAVORITES_ENVELOPE_STORAGE_KEY = "apexbike-favorites-v2";
const UNIT_SYSTEM_STORAGE_KEY = "apexbike-unit-system";
const SIDE_ROADS_STORAGE_KEY = "apexbike-side-roads";
const SPEED_DISPLAY_STORAGE_KEY = "apexbike-speed-display";
const CONTROL_HINTS_STORAGE_KEY = "apexbike-control-hints";
const NIGHT_MODE_STORAGE_KEY = "apexbike-night-mode";
const ARROW_LAYOUT_STORAGE_KEY = "apexbike-arrow-layout";
const GLASSES_SPLASH_MS = 3450;
const GLASSES_SPLASH_FRAME_MS = 90;
const GLASSES_SPLASH_TRAVEL_FRAMES = 32;
const GLASSES_SPLASH_SETTLE_FRAMES = 9;
const GLASSES_SPLASH_MAX_SETTLE_MS = 900;
const GLASSES_HOME_TRANSITION_MS = 650;
const GLASSES_HOME_TRANSITION_FRAME_MS = 90;
const GLASSES_POST_SPLASH_INPUT_GUARD_MS = 450;
const EVEN_STORAGE_TIMEOUT_MS = 1800;

const state: AppState = {
  mode: "sport",
  unitSystem: loadUnitSystem(),
  guidanceView: "arrows",
  showSideRoads: loadSideRoadsEnabled(),
  showSpeed: loadSpeedDisplayEnabled(),
  showControlHints: loadControlHintsEnabled(),
  nightMode: loadNightModeEnabled(),
  arrowLayout: loadArrowLayout(),
  activeSearchField: null,
  bridgeConnected: false,
  locating: false,
  locatingFor: null,
  searching: false,
  originSearching: false,
  routing: false,
  navigating: false,
  devDriving: false,
  devDriveSpeedMetersPerSecond: defaultDevDriveSpeed("sport"),
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
  glassesHomeSelectionIndex: 0,
  glassesScreen: "splash",
  glassesSelectedOrigin: null,
  devToolsEnabled: false,
  selectedPlace: null,
  route: null,
  position: null,
  locationSource: null,
  locationStatus: "No location yet",
  lastLocationError: null,
  favoriteStorageStatus: "Favorites saved on this phone.",
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
let glassesSplashTimer: number | null = null;
let glassesSplashAnimationTimer: number | null = null;
let glassesHomeTransitionTimer: number | null = null;
let glassesHomeTransitionAnimationTimer: number | null = null;
let glassesSplashFrame = 0;
let glassesHomeTransitionFrame = 0;
let glassesSplashDurationMs = GLASSES_SPLASH_MS;
let ignoreGlassInputUntil = 0;
let screenWakeLock: WakeLockSentinelLike | null = null;

void boot();

async function boot(): Promise<void> {
  applyLaunchOptions();
  installDevGlassHarness();
  installRuntimeKeepAliveHandlers();
  render();
  state.bridgeConnected = await glassDisplay.connect(handleGlassInput);
  void hydrateFavoritesFromEvenStorage();
  await updateGlass();
  scheduleGlassesSplashTransition();
  if (shouldAutoRunDevRoute()) {
    await buildDevTestRoute();
    if (shouldAutoStartDevDriving()) {
      startDevDriving();
    }
  }
  render();
}

function scheduleGlassesSplashTransition(): void {
  stopGlassesSplashTimers();
  glassesSplashFrame = 0;
  const splashDurationMs = effectiveSplashDurationMs();

  glassesSplashAnimationTimer = window.setInterval(() => {
    if (state.glassesScreen !== "splash") {
      stopGlassesSplashTimers();
      return;
    }

    glassesSplashFrame += 1;
    void updateGlass();
  }, GLASSES_SPLASH_FRAME_MS);

  glassesSplashTimer = window.setTimeout(() => {
    stopGlassesSplashTimers();
    if (state.glassesScreen !== "splash") {
      return;
    }

    startGlassesHomeTransition();
  }, splashDurationMs);
}

function dismissGlassesSplash(): void {
  stopGlassesStartupTimers();

  if (state.glassesScreen === "splash" || state.glassesScreen === "homeTransition") {
    state.glassesScreen = "home";
    ignoreGlassInputUntil = performance.now() + GLASSES_POST_SPLASH_INPUT_GUARD_MS;
  }
}

function startGlassesHomeTransition(): void {
  stopGlassesStartupTimers();
  glassesHomeTransitionFrame = 0;
  state.glassesScreen = "homeTransition";
  void updateGlass();
  render();

  glassesHomeTransitionAnimationTimer = window.setInterval(() => {
    if (state.glassesScreen !== "homeTransition") {
      stopGlassesStartupTimers();
      return;
    }

    glassesHomeTransitionFrame += 1;
    void updateGlass();
  }, GLASSES_HOME_TRANSITION_FRAME_MS);

  glassesHomeTransitionTimer = window.setTimeout(() => {
    stopGlassesStartupTimers();
    if (state.glassesScreen !== "homeTransition") {
      return;
    }

    state.glassesScreen = "home";
    void updateGlass();
    render();
  }, GLASSES_HOME_TRANSITION_MS);
}

function stopGlassesStartupTimers(): void {
  stopGlassesSplashTimers();
  stopGlassesHomeTransitionTimers();
}

function stopGlassesSplashTimers(): void {
  if (glassesSplashTimer != null) {
    window.clearTimeout(glassesSplashTimer);
    glassesSplashTimer = null;
  }

  if (glassesSplashAnimationTimer != null) {
    window.clearInterval(glassesSplashAnimationTimer);
    glassesSplashAnimationTimer = null;
  }
}

function stopGlassesHomeTransitionTimers(): void {
  if (glassesHomeTransitionTimer != null) {
    window.clearTimeout(glassesHomeTransitionTimer);
    glassesHomeTransitionTimer = null;
  }

  if (glassesHomeTransitionAnimationTimer != null) {
    window.clearInterval(glassesHomeTransitionAnimationTimer);
    glassesHomeTransitionAnimationTimer = null;
  }
}

function installDevGlassHarness(): void {
  const devWindow = window as Window & {
    __apexbikeDevGlassInput?: (action: GlassAction) => void;
    __apexbikeDebugState?: () => Record<string, unknown>;
  };

  devWindow.__apexbikeDevGlassInput = (action) => {
    if (!state.devToolsEnabled) {
      return;
    }

    runDevGlassInput(action);
  };
  devWindow.__apexbikeDebugState = devDebugSnapshot;
  document.addEventListener("apexbike-dev-glass-input", (event) => {
    const action = (event as CustomEvent<unknown>).detail;
    if (!state.devToolsEnabled || !isGlassAction(action)) {
      return;
    }

    runDevGlassInput(action);
  });
}

function installRuntimeKeepAliveHandlers(): void {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void updateRuntimeKeepAlive();
    }
  });
}

async function updateRuntimeKeepAlive(): Promise<void> {
  if (!shouldKeepRuntimeAwake() || document.visibilityState !== "visible") {
    await releaseScreenWakeLock();
    return;
  }

  if (screenWakeLock != null) {
    return;
  }

  const wakeLock = (navigator as WakeLockNavigator).wakeLock;
  if (!wakeLock) {
    return;
  }

  try {
    screenWakeLock = await wakeLock.request("screen");
    screenWakeLock.addEventListener("release", () => {
      screenWakeLock = null;
    });
  } catch {
    screenWakeLock = null;
  }
}

function shouldKeepRuntimeAwake(): boolean {
  return state.navigating || state.routing || state.startWhenRouteReady || state.devDriving;
}

async function releaseScreenWakeLock(): Promise<void> {
  if (screenWakeLock == null) {
    return;
  }

  const lock = screenWakeLock;
  screenWakeLock = null;

  try {
    await lock.release();
  } catch {
    // The browser may release the lock before our cleanup runs.
  }
}

function devDebugSnapshot(): Record<string, unknown> {
  return {
    devToolsEnabled: state.devToolsEnabled,
    glassesScreen: state.glassesScreen,
    guidanceView: state.guidanceView,
    mode: state.mode,
    unitSystem: state.unitSystem,
    showSideRoads: state.showSideRoads,
    showSpeed: state.showSpeed,
    showControlHints: state.showControlHints,
    arrowLayout: state.arrowLayout,
    settingsIndex: state.glassesSettingsIndex,
    homeSelectionIndex: state.glassesHomeSelectionIndex,
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
    document.body.dataset.apexbikeDebugState = JSON.stringify(devDebugSnapshot());
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
  const params = new URLSearchParams(window.location.search);
  return params.has("autoRide") || params.has("autoDrive");
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

  if (params.has("speed")) {
    state.showSpeed = params.get("speed") !== "0";
    saveSpeedDisplayEnabled();
  }

  if (params.has("hints")) {
    state.showControlHints = params.get("hints") !== "0";
    saveControlHintsEnabled();
  }

  if (params.has("night")) {
    state.nightMode = params.get("night") !== "0";
    saveNightModeEnabled();
  }

  const arrowLayout = params.get("arrowLayout");
  if (arrowLayout === "left" || arrowLayout === "bottom") {
    state.arrowLayout = arrowLayout;
    saveArrowLayout();
  }

  if (params.has("devTools")) {
    state.devToolsEnabled = params.get("devTools") !== "0";
  }

  const devSplashMs = Number(params.get("devSplashMs"));
  if (Number.isFinite(devSplashMs) && devSplashMs >= 1000) {
    glassesSplashDurationMs = Math.min(30000, devSplashMs);
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
          <h1 id="app-title">ApexBike</h1>
          <p class="tagline">Ride the line. Find the quiet way.</p>
        </div>
        <div class="topbar-actions">
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
          <button class="mode ${state.mode === "sport" ? "active" : ""}" data-mode="sport" type="button">Sport</button>
          <button class="mode ${state.mode === "city" ? "active" : ""}" data-mode="city" type="button">City</button>
        </div>
        <p class="mode-note">
          Sport gives earlier turn prep and a wider off-route buffer; City keeps prompts tighter for slower urban riding.
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

        <div class="actions" id="route-actions">
          ${renderRouteActions()}
        </div>

        ${state.devToolsEnabled ? `
          <div class="dev-tools" aria-label="Developer tools">
            <button class="dev-route" id="dev-route" type="button">
              Dev test route: Hulftegg to Schwaegalp
            </button>
            <button class="dev-route secondary" id="dev-gps" type="button">
              Simulate GPS at Hulftegg
            </button>
            <button class="dev-route" id="dev-drive" type="button">
              ${state.devDriving ? "Pause simulated ride" : "Simulate riding"}
            </button>
            ${state.devDriving ? renderDevSpeedControl() : ""}
          </div>
        ` : ""}

        <div id="error-slot">${renderErrorPanel()}</div>
        <p class="location-note" id="location-note">${escapeHtml(state.locationStatus)}</p>
      </section>

      <section class="panel favorites-panel" aria-label="Favorite places">
        ${renderFavoritesManager()}
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

function updateRouteActions(): void {
  const actions = document.querySelector<HTMLElement>("#route-actions");
  if (!actions) {
    return;
  }

  actions.innerHTML = renderRouteActions();
  document.querySelector<HTMLButtonElement>("#start-nav")?.addEventListener("click", () => {
    void startNavigation();
  });
  document.querySelector<HTMLButtonElement>("#cancel-route")?.addEventListener("click", () => {
    cancelNavigation(state.routing ? "Route request cancelled." : "Navigation stopped.");
  });
}

function updateStatusPanel(): void {
  const errorSlot = document.querySelector<HTMLElement>("#error-slot");
  if (errorSlot) {
    errorSlot.innerHTML = renderErrorPanel();
  }

  const locationNote = document.querySelector<HTMLElement>("#location-note");
  if (locationNote) {
    locationNote.textContent = state.locationStatus;
  }
}

function updatePlannerUiAfterPositionChange(): void {
  const originInput = document.querySelector<HTMLInputElement>("#origin");
  if (originInput && document.activeElement !== originInput) {
    originInput.value = originInputValue();
  }

  updateOriginResultsSlot();
  updateResultsSlot();
  updateStatsCard();
  updateRouteActions();
  updateStatusPanel();
  if (map) {
    syncCurrentMarker();
    syncDestinationMarker();
    syncRouteLine();
  } else {
    syncMap();
  }
}

function renderRouteActions(): string {
  return `
    <button class="primary" id="start-nav" type="button" ${canStartNavigation() ? "" : "disabled"}>
      ${state.autoRerouting ? "Recalculating..." : state.navigating ? "Navigation running" : state.routing && state.startWhenRouteReady ? "Starting..." : "Start navigation"}
    </button>
    ${canCancelNavigation() ? `<button class="danger" id="cancel-route" type="button">${state.routing ? "Cancel route" : "Stop navigation"}</button>` : ""}
  `;
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
        <label class="setting-toggle">
          <input type="checkbox" data-speed-display ${state.showSpeed ? "checked" : ""} />
          <span>Speed on glasses</span>
        </label>
        <label class="setting-toggle">
          <input type="checkbox" data-night-mode ${state.nightMode ? "checked" : ""} />
          <span>Night HUD</span>
        </label>
        <div class="setting-group">
          <span>Arrow position</span>
          <div class="segmented-row" role="group" aria-label="Arrow position">
            <button class="view-mode ${state.arrowLayout === "left" ? "active" : ""}" data-arrow-layout="left" type="button">Left</button>
            <button class="view-mode ${state.arrowLayout === "bottom" ? "active" : ""}" data-arrow-layout="bottom" type="button">Bottom</button>
          </div>
        </div>
        <label class="setting-toggle">
          <input type="checkbox" data-control-hints ${state.showControlHints ? "checked" : ""} />
          <span>Glasses control hints</span>
        </label>
      </div>
    </div>
  `;
}

function renderFavoritesManager(): string {
  return `
    <div class="favorites-header">
      <div>
        <span>Favorites</span>
        <strong>Saved places</strong>
      </div>
      <p>One shared list for start and destination. ${escapeHtml(state.favoriteStorageStatus)}</p>
    </div>
    ${state.favorites.length === 0 ? `
      <p class="favorites-empty">Save a start or destination to route from the phone or glasses.</p>
    ` : `
      <div class="favorites-manager-list">
        ${state.favorites.map((favorite) => `
          <article class="favorite-manager-item">
            <div>
              <strong>${escapeHtml(favorite.label)}</strong>
              <span>${favorite.coordinate.lat.toFixed(5)}, ${favorite.coordinate.lon.toFixed(5)}</span>
            </div>
            <div class="favorite-manager-actions">
              <button type="button" data-favorite-origin-id="${favorite.id}">Start</button>
              <button type="button" data-favorite-destination-id="${favorite.id}">Destination</button>
              <button class="danger-text" type="button" data-favorite-remove-id="${favorite.id}">Remove</button>
            </div>
          </article>
        `).join("")}
      </div>
    `}
  `;
}

function renderErrorPanel(): string {
  if (!state.error) {
    return "";
  }

  const diagnostic = state.lastLocationError;
  return `
    <div class="error-row">
      <p class="error">${escapeHtml(state.error)}</p>
      ${diagnostic ? `
        <details class="error-help">
          <summary aria-label="Location troubleshooting" title="Location troubleshooting">?</summary>
          <div>
            <strong>${escapeHtml(diagnostic.codeName)}</strong>
            <span>Source: ${escapeHtml(diagnostic.source)} / ${escapeHtml(diagnostic.target)}</span>
            <span>Code: ${diagnostic.code ?? "n/a"}</span>
            <span>Message: ${escapeHtml(diagnostic.message || "No platform message")}</span>
            <span>Secure: ${diagnostic.secureContext ? "yes" : "no"} · Geolocation API: ${diagnostic.hasGeolocation ? "yes" : "no"}</span>
            <p>${escapeHtml(locationTroubleshootingHint(diagnostic))}</p>
          </div>
        </details>
      ` : ""}
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
    const hint = state.query.trim().length >= 3 ? "No address matches yet. Try a more specific place, city, or street." : "Type a destination, use current location, or tap the map.";
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
  const speedLabel = formatCurrentSpeed();
  if (!state.route) {
    return `
      <div class="stat"><span>Status</span><strong>${state.position ? "Location ready" : "No location"}</strong></div>
      <div class="stat"><span>Source</span><strong>${locationSourceLabel()}</strong></div>
      <div class="stat"><span>Mode</span><strong>${state.mode === "sport" ? "Sport" : "City"}</strong></div>
      <div class="stat"><span>${state.navigating ? "Speed" : "Route"}</span><strong>${state.navigating ? speedLabel : "Not built"}</strong></div>
    `;
  }

  const nextStep = state.route.steps[state.nextStepIndex];
  return `
    <div class="stat"><span>Total</span><strong>${formatDistance(state.route.distanceMeters, state.unitSystem)}</strong></div>
    <div class="stat"><span>ETA</span><strong>${formatEta(state.route.durationSeconds)}</strong></div>
    <div class="stat"><span>${state.navigating ? "Speed" : "Source"}</span><strong>${state.navigating ? speedLabel : locationSourceLabel()}</strong></div>
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
        <p>${escapeHtml(state.showSpeed ? `${snapshot.speedLabel ?? formatCurrentSpeed()} | ${snapshot.tertiary}` : snapshot.tertiary)}</p>
      </div>
    `;
  }

  return `
    <div class="guidance-visual">${escapeHtml(snapshot.arrow)}</div>
    <div>
      <span>Arrow view</span>
      <strong>${escapeHtml(snapshot.primary)}</strong>
      <p>${escapeHtml(state.showSpeed ? `${snapshot.speedLabel ?? formatCurrentSpeed()} | ${snapshot.secondary}` : snapshot.secondary)}</p>
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

  document.querySelector<HTMLInputElement>("[data-speed-display]")?.addEventListener("change", (event) => {
    state.showSpeed = (event.target as HTMLInputElement).checked;
    saveSpeedDisplayEnabled();
    void updateGlass();
    render();
  });

  document.querySelector<HTMLInputElement>("[data-night-mode]")?.addEventListener("change", (event) => {
    state.nightMode = (event.target as HTMLInputElement).checked;
    saveNightModeEnabled();
    void updateGlass();
    render();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-arrow-layout]").forEach((button) => {
    button.addEventListener("click", () => {
      const layout = button.dataset.arrowLayout;
      if (layout === "left" || layout === "bottom") {
        state.arrowLayout = layout;
        saveArrowLayout();
        void updateGlass();
        render();
      }
    });
  });

  document.querySelector<HTMLInputElement>("[data-control-hints]")?.addEventListener("change", (event) => {
    state.showControlHints = (event.target as HTMLInputElement).checked;
    saveControlHintsEnabled();
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
    updateRouteActions();
    updateStatusPanel();
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
    updateRouteActions();
    updateStatusPanel();
    syncRouteLine();
  });

  bindResultEvents();
  bindOriginResultEvents();
  bindFavoriteEvents();
  bindDevGlassesKeyboard();

  document.querySelector<HTMLButtonElement>("#start-nav")?.addEventListener("click", () => {
    void startNavigation();
  });

  document.querySelector<HTMLButtonElement>("#cancel-route")?.addEventListener("click", () => {
    cancelNavigation(state.routing ? "Route request cancelled." : "Navigation stopped.");
  });

  document.querySelector<HTMLButtonElement>("#dev-route")?.addEventListener("click", () => {
    void buildDevTestRoute();
  });

  document.querySelector<HTMLButtonElement>("#dev-gps")?.addEventListener("click", () => {
    simulateDevGpsLocation();
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
      ? `Simulated ride running at ${formatDevDriveSpeed()}.`
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

  document.querySelectorAll<HTMLButtonElement>("[data-favorite-remove-id]").forEach((button) => {
    button.addEventListener("click", () => {
      removeFavorite(button.dataset.favoriteRemoveId);
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
    state.favorites = dedupeFavorites([normalizeFavorite(place), ...state.favorites]).slice(0, 20);
  }

  normalizeFavoriteIndexes();
  saveFavorites();
}

function removeFavorite(id: string | undefined): void {
  if (!id) {
    return;
  }

  state.favorites = state.favorites.filter((favorite) => favorite.id !== id);
  normalizeFavoriteIndexes();
  saveFavorites();
}

function normalizeFavoriteIndexes(): void {
  if (state.glassesFavoriteIndex >= state.favorites.length) {
    state.glassesFavoriteIndex = Math.max(0, state.favorites.length - 1);
  }
  if (state.glassesStartFavoriteIndex >= state.favorites.length) {
    state.glassesStartFavoriteIndex = Math.max(0, state.favorites.length - 1);
  }
  if (state.glassesDestinationFavoriteIndex >= state.favorites.length) {
    state.glassesDestinationFavoriteIndex = Math.max(0, state.favorites.length - 1);
  }
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
    const envelope = parseFavoritesEnvelope(window.localStorage.getItem(FAVORITES_ENVELOPE_STORAGE_KEY));
    if (envelope) {
      return envelope.favorites;
    }

    return parseFavoritesArray(window.localStorage.getItem(FAVORITES_STORAGE_KEY));
  } catch {
    return [];
  }
}

function saveFavorites(): void {
  state.favorites = dedupeFavorites(state.favorites).slice(0, 20);
  const envelope = makeFavoritesEnvelope(state.favorites);
  try {
    window.localStorage.setItem(FAVORITES_ENVELOPE_STORAGE_KEY, JSON.stringify(envelope));
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(envelope.favorites));
    state.favoriteStorageStatus = "Saved on phone.";
  } catch (error) {
    state.favoriteStorageStatus = `Phone save failed: ${toMessage(error)}`;
  }

  void saveFavoritesToEvenStorage(envelope);
}

async function hydrateFavoritesFromEvenStorage(): Promise<void> {
  const bridge = await evenStorageBridge();
  if (!bridge) {
    state.favoriteStorageStatus = "Saved on phone. Even storage unavailable.";
    render();
    return;
  }

  try {
    const remoteEnvelope = parseFavoritesEnvelope(await bridge.getLocalStorage(FAVORITES_ENVELOPE_STORAGE_KEY));
    const remoteLegacy = remoteEnvelope ? [] : parseFavoritesArray(await bridge.getLocalStorage(FAVORITES_STORAGE_KEY));
    const localEnvelope = parseFavoritesEnvelope(window.localStorage.getItem(FAVORITES_ENVELOPE_STORAGE_KEY));
    const localFavorites = localEnvelope?.favorites ?? state.favorites;
    const remoteFavorites = remoteEnvelope?.favorites ?? remoteLegacy;

    if (remoteEnvelope && (!localEnvelope || remoteEnvelope.updatedAt > localEnvelope.updatedAt)) {
      state.favorites = remoteFavorites;
    } else if (!remoteEnvelope && localFavorites.length === 0 && remoteFavorites.length > 0) {
      state.favorites = remoteFavorites;
    } else {
      state.favorites = dedupeFavorites([...localFavorites, ...remoteFavorites]).slice(0, 20);
    }

    normalizeFavoriteIndexes();
    state.favoriteStorageStatus = "Saved on phone and Even app.";
    writeFavoritesLocally(makeFavoritesEnvelope(state.favorites));
    render();
    void updateGlass();
  } catch (error) {
    state.favoriteStorageStatus = `Even storage load failed: ${toMessage(error)}`;
    render();
  }
}

async function saveFavoritesToEvenStorage(envelope: StoredFavoritesEnvelope): Promise<void> {
  const bridge = await evenStorageBridge();
  if (!bridge) {
    state.favoriteStorageStatus = "Saved on phone. Even storage unavailable.";
    render();
    return;
  }

  try {
    const savedEnvelope = await bridge.setLocalStorage(FAVORITES_ENVELOPE_STORAGE_KEY, JSON.stringify(envelope));
    const savedLegacy = await bridge.setLocalStorage(FAVORITES_STORAGE_KEY, JSON.stringify(envelope.favorites));
    state.favoriteStorageStatus = savedEnvelope && savedLegacy
      ? "Saved on phone and Even app."
      : "Saved on phone. Even storage returned false.";
  } catch (error) {
    state.favoriteStorageStatus = `Saved on phone. Even storage failed: ${toMessage(error)}`;
  }

  render();
}

function writeFavoritesLocally(envelope: StoredFavoritesEnvelope): void {
  window.localStorage.setItem(FAVORITES_ENVELOPE_STORAGE_KEY, JSON.stringify(envelope));
  window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(envelope.favorites));
}

function makeFavoritesEnvelope(favorites: PlaceResult[]): StoredFavoritesEnvelope {
  return {
    version: 1,
    updatedAt: Date.now(),
    favorites: dedupeFavorites(favorites).slice(0, 20)
  };
}

function parseFavoritesEnvelope(raw: string | null): StoredFavoritesEnvelope | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredFavoritesEnvelope>;
    if (parsed.version !== 1 || typeof parsed.updatedAt !== "number" || !Array.isArray(parsed.favorites)) {
      return null;
    }

    return {
      version: 1,
      updatedAt: parsed.updatedAt,
      favorites: validFavorites(parsed.favorites)
    };
  } catch {
    return null;
  }
}

function parseFavoritesArray(raw: string | null): PlaceResult[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? validFavorites(parsed) : [];
  } catch {
    return [];
  }
}

function validFavorites(values: unknown[]): PlaceResult[] {
  return dedupeFavorites(values.filter((favorite): favorite is PlaceResult =>
    isObjectRecord(favorite) &&
    typeof favorite.id === "string" &&
    typeof favorite.label === "string" &&
    isObjectRecord(favorite.coordinate) &&
    typeof favorite.coordinate.lat === "number" &&
    typeof favorite.coordinate.lon === "number"
  )).slice(0, 20);
}

async function evenStorageBridge(): Promise<Awaited<ReturnType<typeof waitForEvenAppBridge>> | null> {
  try {
    return await withTimeout(waitForEvenAppBridge(), EVEN_STORAGE_TIMEOUT_MS);
  } catch {
    return null;
  }
}

function dedupeFavorites(favorites: PlaceResult[]): PlaceResult[] {
  return favorites.reduce<PlaceResult[]>((uniqueFavorites, favorite) => {
    if (!uniqueFavorites.some((existingFavorite) => samePlace(existingFavorite, favorite))) {
      uniqueFavorites.push(normalizeFavorite(favorite));
    }
    return uniqueFavorites;
  }, []);
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

function loadSpeedDisplayEnabled(): boolean {
  return window.localStorage.getItem(SPEED_DISPLAY_STORAGE_KEY) !== "0";
}

function saveSpeedDisplayEnabled(): void {
  window.localStorage.setItem(SPEED_DISPLAY_STORAGE_KEY, state.showSpeed ? "1" : "0");
}

function loadControlHintsEnabled(): boolean {
  return window.localStorage.getItem(CONTROL_HINTS_STORAGE_KEY) === "1";
}

function saveControlHintsEnabled(): void {
  window.localStorage.setItem(CONTROL_HINTS_STORAGE_KEY, state.showControlHints ? "1" : "0");
}

function loadNightModeEnabled(): boolean {
  return window.localStorage.getItem(NIGHT_MODE_STORAGE_KEY) === "1";
}

function saveNightModeEnabled(): void {
  window.localStorage.setItem(NIGHT_MODE_STORAGE_KEY, state.nightMode ? "1" : "0");
}

function loadArrowLayout(): AppState["arrowLayout"] {
  return window.localStorage.getItem(ARROW_LAYOUT_STORAGE_KEY) === "bottom" ? "bottom" : "left";
}

function saveArrowLayout(): void {
  window.localStorage.setItem(ARROW_LAYOUT_STORAGE_KEY, state.arrowLayout);
}

function formatCurrentSpeed(): string {
  return formatSpeed(state.position?.speedMetersPerSecond ?? null, state.unitSystem);
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
    updateStatusPanel();
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
    updateStatusPanel();
  }
}

function startLocationWatch(target: "origin" | "destination" = "origin"): void {
  if (!("geolocation" in navigator)) {
    state.error = "This WebView does not expose location services.";
    state.lastLocationError = makeLocationDiagnostic("feature-check", target, null, "navigator.geolocation is missing");
    state.locationStatus = target === "origin"
      ? "Tap the Start field, then tap the map as a fallback."
      : "Tap the Destination field, then tap the map as a fallback.";
    render();
    return;
  }

  if (!window.isSecureContext) {
    state.error = "Location requires a secure WebView or localhost.";
    state.lastLocationError = makeLocationDiagnostic("secure-context", target, null, "window.isSecureContext is false");
    state.locationStatus = target === "origin"
      ? "Tap the Start field, then tap the map for local testing."
      : "Tap the Destination field, then tap the map for local testing.";
    render();
    return;
  }

  state.locating = true;
  state.locatingFor = target;
  state.error = null;
  state.lastLocationError = null;
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
      updatePlannerUiAfterPositionChange();
      void updateGlass();
    },
    (error) => {
      state.locating = false;
      state.locatingFor = null;
      state.lastLocationError = makeLocationDiagnostic("getCurrentPosition", target, error, error.message);
      state.error = geolocationErrorMessage(error);
      state.locationStatus = geolocationFallbackStatus(error, target);
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
      updatePlannerUiAfterPositionChange();
    },
    (error) => {
      state.locating = false;
      state.locatingFor = null;
      state.lastLocationError = makeLocationDiagnostic("watchPosition", "origin", error, error.message);
      if (clearErrors) {
        state.error = geolocationErrorMessage(error);
      }
      state.locationStatus = geolocationFallbackStatus(error, "origin");
      updatePlannerUiAfterPositionChange();
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
  state.lastLocationError = null;
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
  state.lastLocationError = null;
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
  void updateRuntimeKeepAlive();
  updateStatsCard();
  render();

  try {
    const route = await fetchBicycleRoute(
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
      void updateRuntimeKeepAlive();
      await updateGlass();
    }
  } catch (error) {
    if (state.routeRequestId === requestId) {
      state.error = toMessage(error);
    }
  } finally {
    if (state.routeRequestId === requestId) {
      state.routing = false;
      void updateRuntimeKeepAlive();
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
  void updateRuntimeKeepAlive();
  render();

  try {
    const route = await fetchBicycleRoute(
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
    void updateRuntimeKeepAlive();
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
      void updateRuntimeKeepAlive();
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
  void updateRuntimeKeepAlive();
  await ensureRouteReady();
  if (state.route) {
    state.navigating = true;
    state.nextStepIndex = 0;
    state.locationStatus = "Dev test route running with simulated GPS at Hulftegg Passhoehe.";
    void updateRuntimeKeepAlive();
    await updateGlass();
    render();
  }
}

function simulateDevGpsLocation(): void {
  applySimulatedOrigin(DEV_TEST_ORIGIN, DEV_TEST_DESTINATION);
  state.activeSearchField = "destination";
  state.locationStatus = "Dev simulated GPS at Hulftegg Passhoehe. Type a destination or tap the map.";
  render();
  void updateGlass();
  if (state.selectedPlace) {
    void ensureRouteReady();
  }
}

async function toggleDevDriving(): Promise<void> {
  if (state.devDriving) {
    stopDevDriving("Simulated ride paused.");
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
    state.error = "No route geometry available for ride simulation.";
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
  void updateRuntimeKeepAlive();
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
    void updateRuntimeKeepAlive();
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
  void updateRuntimeKeepAlive();
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
    stopDevDriving("Simulated ride arrived.");
  }

  const sample = sampleRouteAtDistance(state.route.geometry, devDriveDistanceMeters);
  state.position = {
    coordinate: sample.coordinate,
    speedMetersPerSecond: state.devDriving ? devDriveSpeedMetersPerSecond() : 0,
    headingDegrees: sample.headingDegrees
  };
  state.locationStatus = state.devDriving
    ? `Simulated ride running at ${formatDevDriveSpeed()}.`
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
  return mode === "sport" ? 7.8 : 5.6;
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

async function startNavigation(): Promise<void> {
  if (state.navigating || state.routing) {
    return;
  }

  if (!state.position) {
    state.error = "Choose a start point or use current location first.";
    state.locationStatus = "Start is missing. Use current location, pick a favorite, or tap the map.";
    render();
    return;
  }

  if (!state.selectedPlace) {
    await resolveTypedDestinationForNavigation();
  }

  if (!state.selectedPlace) {
    return;
  }

  if (!state.route) {
    state.startWhenRouteReady = true;
    void updateRuntimeKeepAlive();
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
  void updateRuntimeKeepAlive();
  void updateGlass();
  render();
}

async function resolveTypedDestinationForNavigation(): Promise<void> {
  const query = state.query.trim();
  if (query.length < 3) {
    state.error = "Choose a destination first.";
    state.locationStatus = "Destination is missing. Search, pick a favorite, or tap the map.";
    render();
    return;
  }

  state.searching = true;
  state.error = null;
  state.locationStatus = "Searching destination...";
  updateResultsSlot();
  updateStatusPanel();
  updateRouteActions();

  try {
    const results = await searchPlaces(query);
    if (state.query.trim() !== query) {
      return;
    }

    state.results = results;
    const destination = results[0];
    if (!destination) {
      state.error = `No addresses found for "${query}". Try a more specific place, city, or street.`;
      state.locationStatus = "Destination search returned no matches.";
      return;
    }

    applyDestination(destination);
    state.activeSearchField = null;
    state.locationStatus = `Destination set: ${destination.label}`;
  } catch (error) {
    if (state.query.trim() === query) {
      state.error = `Address search failed: ${toMessage(error)}`;
      state.locationStatus = "Destination search failed. Check network access or try a simpler address.";
      state.results = [];
    }
  } finally {
    if (state.query.trim() === query) {
      state.searching = false;
    }
    updateResultsSlot();
    updateStatusPanel();
    updateRouteActions();
    syncDestinationMarker();
  }
}

async function updateGlass(): Promise<void> {
  const snapshot = currentSnapshot();
  await glassDisplay.render(snapshot);
}

function currentSnapshot(): GuidanceSnapshot {
  if (state.glassesScreen === "splash") {
    return splashGlassesSnapshot();
  }

  if (state.glassesScreen === "settings") {
    return glassesSettingsSnapshot();
  }

  if (!state.navigating) {
    if (state.glassesScreen === "home" || state.glassesScreen === "homeMenu" || state.glassesScreen === "homeTransition") {
      return homeMenuGlassesSnapshot();
    }

    if (state.glassesScreen === "favoriteOrigin") {
      return favoriteGlassesSnapshot("origin");
    }

    if (state.glassesScreen === "favoriteDestination") {
      return favoriteGlassesSnapshot("destination");
    }

    if (state.glassesScreen === "routeReady") {
      return routeReadyGlassesSnapshot();
    }

    if (state.glassesScreen === "speed") {
      return speedGlassesSnapshot();
    }

    return homeMenuGlassesSnapshot();
  }

  if (!state.route || !state.position) {
    return homeMenuGlassesSnapshot();
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
    hint: state.showControlHints
      ? state.guidanceView === "map" ? "Click arrows | Double stop" : "Click map | Double stop"
      : "",
    showSideRoads: state.showSideRoads,
    showSpeed: state.showSpeed,
    showControlHints: state.showControlHints,
    nightMode: state.nightMode,
    arrowLayout: state.arrowLayout
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
    tertiary: state.route ? "Start" : "Building",
    hint: state.showControlHints ? "Click start | Double back" : "",
    arrow: "--",
    nextStepIndex: 0,
    distanceToStepMeters: 0,
    offRoute: false,
    showControlHints: state.showControlHints
  };
}

function splashGlassesSnapshot(): GuidanceSnapshot {
  return {
    active: false,
    title: "ApexBike",
    primary: "Ride the line",
    secondary: "Find the quiet way",
    tertiary: "",
    hint: "",
    arrow: "--",
    nextStepIndex: 0,
    distanceToStepMeters: 0,
    offRoute: false,
    homeVariant: "splash",
    splashFrame: glassesSplashFrame,
    splashTravelFrames: splashTravelFrames()
  };
}

function splashTravelFrames(): number {
  return GLASSES_SPLASH_TRAVEL_FRAMES;
}

function effectiveSplashDurationMs(): number {
  const travelMs = GLASSES_SPLASH_TRAVEL_FRAMES * GLASSES_SPLASH_FRAME_MS;
  const settleMs = Math.min(
    GLASSES_SPLASH_MAX_SETTLE_MS,
    Math.max(GLASSES_SPLASH_SETTLE_FRAMES * GLASSES_SPLASH_FRAME_MS, glassesSplashDurationMs - travelMs)
  );
  return travelMs + settleMs;
}

function homeMenuGlassesSnapshot(): GuidanceSnapshot {
  const hasFavorites = glassesPickerOptions("destination").length > 0;
  const hasRoute = Boolean(state.position && state.selectedPlace);
  const homeVariant = state.glassesScreen === "homeTransition" ? "transition" : "menu";
  return {
    active: false,
    title: "Choose Mode",
    primary: "ApexBike",
    secondary: hasRoute ? "Phone route ready" : hasFavorites ? "Favorites ready" : state.position ? "GPS ready" : "No GPS",
    tertiary: "",
    hint: state.showControlHints ? "Swipe move | Click select" : "",
    arrow: "--",
    nextStepIndex: 0,
    distanceToStepMeters: 0,
    offRoute: false,
    showControlHints: state.showControlHints,
    homeVariant,
    transitionFrame: homeVariant === "transition" ? glassesHomeTransitionFrame : undefined,
    pickerItems: [
      { label: "Navigation", badge: hasRoute ? "READY" : hasFavorites ? "FAV" : state.position ? "GPS" : "WAIT", selected: state.glassesHomeSelectionIndex === 0 },
      { label: "Speed", badge: state.position ? "LIVE" : "WAIT", selected: state.glassesHomeSelectionIndex === 1 },
      { label: "Settings", selected: state.glassesHomeSelectionIndex === 2 }
    ]
  };
}

function speedGlassesSnapshot(): GuidanceSnapshot {
  return {
    active: false,
    title: "Speed",
    primary: formatCurrentSpeed(),
    secondary: state.locationSource ? locationSourceLabel() : "Waiting for GPS",
    tertiary: state.mode === "sport" ? "Sport" : "City",
    hint: state.showControlHints ? "Double back | Long settings" : "",
    arrow: "--",
    nextStepIndex: 0,
    distanceToStepMeters: 0,
    offRoute: false,
    showControlHints: state.showControlHints,
    showSpeed: true,
    speedLabel: formatCurrentSpeed()
  };
}

function favoriteGlassesSnapshot(target: GlassPickerTarget): GuidanceSnapshot {
  const option = selectedGlassesFavorite(target);
  const options = glassesPickerOptions(target);
  const phoneStartHint = "Start on phone or pick favorite";
  if (!option) {
    return {
      ...makeIdleSnapshot(target === "origin" ? "No start options" : "No destinations"),
      title: target === "origin" ? "Choose Start" : "Choose Finish",
      primary: target === "origin" ? "Start on phone" : "Save favorites",
      secondary: target === "origin" ? "or save favorites" : "Use the phone app",
      tertiary: target === "origin" ? "" : "No destinations",
      hint: state.showControlHints ? "Double back" : "",
      pickerItems: visibleGlassPickerItems(target)
    };
  }

  const index = favoriteIndex(target) + 1;
  const count = options.length;
  return {
    active: false,
    title: target === "origin" ? "Choose Start" : "Choose Finish",
    primary: option.label,
    secondary: target === "origin" ? phoneStartHint : `${index}/${count}`,
    tertiary: target === "origin" ? `${index}/${count}` : "",
    hint: state.showControlHints ? "Swipe scroll | Click select | Double back" : "",
    arrow: "--",
    nextStepIndex: 0,
    distanceToStepMeters: 0,
    offRoute: false,
    showControlHints: state.showControlHints,
    pickerItems: visibleGlassPickerItems(target)
  };
}

function glassesSettingsSnapshot(): GuidanceSnapshot {
  const setting = glassesSettings()[state.glassesSettingsIndex] ?? glassesSettings()[0];
  return {
    active: false,
    title: "Settings",
    primary: `${state.glassesSettingsIndex + 1}/${glassesSettings().length} ${setting.label}`,
    secondary: setting.value(),
    tertiary: "",
    hint: state.showControlHints ? "Swipe move | Click change | Double back" : "",
    arrow: "--",
    nextStepIndex: 0,
    distanceToStepMeters: 0,
    offRoute: false,
    showControlHints: state.showControlHints
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
    hint: state.showControlHints ? "Click arrows | Double stop" : ""
  };
}

function handleGlassInput(action: GlassAction): void {
  if (performance.now() < ignoreGlassInputUntil) {
    return;
  }

  if (state.glassesScreen === "splash" || state.glassesScreen === "homeTransition") {
    dismissGlassesSplash();
    void updateGlass();
    render();
    return;
  }

  if (state.glassesScreen === "settings") {
    handleGlassesSettingsInput(action);
    return;
  }

  if (state.glassesScreen === "speed") {
    handleSpeedDisplayInput(action);
    return;
  }

  if (state.navigating) {
    if (action === "double") {
      state.glassesScreen = "home";
      cancelNavigation("Navigation stopped.");
      return;
    }

    if (action === "press") {
      state.guidanceView = state.guidanceView === "map" ? "arrows" : "map";
      void updateGlass();
      render();
      return;
    }

    if (action === "long") {
      state.glassesScreen = "settings";
      void updateGlass();
      render();
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

  if (state.glassesScreen === "home" || state.glassesScreen === "homeMenu") {
    handleHomeMenuInput(action);
    return;
  }

  if (action === "up") {
    state.glassesScreen = "settings";
    void updateGlass();
    render();
    return;
  }

  if (action === "press") {
    if (state.position && state.selectedPlace) {
      startGlassesNavigation();
      return;
    }

    if (glassesPickerOptions("origin").length > 0) {
      state.glassesScreen = "favoriteOrigin";
      void updateGlass();
      render();
      return;
    }
  }

  if (action === "down" && glassesPickerOptions("origin").length > 0) {
    state.glassesScreen = "favoriteOrigin";
    void updateGlass();
    render();
    return;
  }

  void updateGlass();
  render();
}

function requestGlassExit(): void {
  void glassDisplay.shutdown();
}

function handleHomeMenuInput(action: GlassAction): void {
  if (action === "double") {
    requestGlassExit();
    return;
  }

  if (action === "up" || action === "down") {
    const direction = action === "up" ? -1 : 1;
    state.glassesHomeSelectionIndex = (state.glassesHomeSelectionIndex + direction + homeMenuItemCount()) % homeMenuItemCount();
    void updateGlass();
    return;
  }

  if (action !== "press") {
    return;
  }

  if (state.glassesHomeSelectionIndex === 1) {
    state.glassesScreen = "speed";
    void updateGlass();
    render();
    return;
  }

  if (state.glassesHomeSelectionIndex === 2) {
    state.glassesScreen = "settings";
    void updateGlass();
    render();
    return;
  }

  if (state.position && state.selectedPlace) {
    startGlassesNavigation();
    return;
  }

  state.glassesScreen = "favoriteOrigin";
  void updateGlass();
  render();
}

function homeMenuItemCount(): number {
  return 3;
}

function handleSpeedDisplayInput(action: GlassAction): void {
  if (action === "double") {
    state.glassesScreen = "home";
    void updateGlass();
    render();
    return;
  }

  if (action === "long") {
    state.glassesScreen = "settings";
    void updateGlass();
    render();
    return;
  }

  void updateGlass();
}

function handleFavoritePickerInput(target: GlassPickerTarget, action: GlassAction): void {
  if (action === "double") {
    state.glassesScreen = target === "origin" ? "home" : "favoriteOrigin";
    void updateGlass();
    render();
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

function handleRouteReadyInput(action: GlassAction): void {
  if (action === "double") {
    state.glassesScreen = "favoriteDestination";
    state.startWhenRouteReady = false;
    void updateGlass();
    render();
    return;
  }

  if (action === "press") {
    startGlassesNavigation();
    return;
  }

}

function handleGlassesSettingsInput(action: GlassAction): void {
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

function selectedGlassesFavorite(target: GlassPickerTarget = "destination"): GlassPickerOption | null {
  const options = glassesPickerOptions(target);
  if (options.length === 0) {
    return null;
  }

  const index = Math.min(Math.max(favoriteIndex(target), 0), options.length - 1);
  return options[index] ?? null;
}

function cycleGlassesFavorite(target: GlassPickerTarget, delta: number): void {
  const options = glassesPickerOptions(target);
  if (options.length === 0) {
    setFavoriteIndex(target, 0);
    return;
  }

  setFavoriteIndex(target, (favoriteIndex(target) + delta + options.length) % options.length);
}

function favoriteIndex(target: GlassPickerTarget): number {
  return target === "origin" ? state.glassesStartFavoriteIndex : state.glassesDestinationFavoriteIndex;
}

function setFavoriteIndex(target: GlassPickerTarget, index: number): void {
  if (target === "origin") {
    state.glassesStartFavoriteIndex = index;
  } else {
    state.glassesDestinationFavoriteIndex = index;
  }
  state.glassesFavoriteIndex = index;
}

function primeDestinationFavoriteIndex(origin: PlaceResult): void {
  const options = glassesPickerOptions("destination", origin);
  if (options.length === 0) {
    state.glassesDestinationFavoriteIndex = 0;
    return;
  }

  state.glassesDestinationFavoriteIndex = Math.min(state.glassesDestinationFavoriteIndex, options.length - 1);
  state.glassesFavoriteIndex = state.glassesDestinationFavoriteIndex;
}

function selectGlassesDestination(destination: PlaceResult): void {
  const origin = state.glassesSelectedOrigin;
  if (origin) {
    if (state.devToolsEnabled && origin.id !== "glass-current-location") {
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

  void startNavigation();
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
      value: () => state.mode === "sport" ? "Sport" : "City",
      toggle: () => {
        setTravelMode(state.mode === "city" ? "sport" : "city");
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
    },
    {
      label: "Speed",
      value: () => state.showSpeed ? "Shown while riding" : "Hidden",
      toggle: () => {
        state.showSpeed = !state.showSpeed;
        saveSpeedDisplayEnabled();
      }
    },
    {
      label: "Night HUD",
      value: () => state.nightMode ? "Minimal outline" : "Day contrast",
      toggle: () => {
        state.nightMode = !state.nightMode;
        saveNightModeEnabled();
      }
    },
    {
      label: "Arrow position",
      value: () => state.arrowLayout === "bottom" ? "Bottom center" : "Left side",
      toggle: () => {
        state.arrowLayout = state.arrowLayout === "bottom" ? "left" : "bottom";
        saveArrowLayout();
      }
    }
  ];
}

function glassesFavoriteOptions(): PlaceResult[] {
  if (!state.devToolsEnabled) {
    return dedupeFavorites(state.favorites);
  }

  return dedupeFavorites([DEV_TEST_ORIGIN, DEV_TEST_DESTINATION, ...state.favorites]);
}

function glassesPickerOptions(target: GlassPickerTarget, selectedOrigin = state.glassesSelectedOrigin): GlassPickerOption[] {
  const options: GlassPickerOption[] = target === "origin"
    ? [currentLocationGlassOption(), ...glassesFavoriteOptions()].filter(isGlassPickerOption)
    : glassesFavoriteOptions();

  const filteredOptions = target === "destination" && selectedOrigin
    ? options.filter((option) => !samePlace(option, selectedOrigin))
    : options;

  return dedupePickerOptions(filteredOptions);
}

function currentLocationGlassOption(): GlassPickerOption | null {
  if (!state.position) {
    return null;
  }

  return {
    id: "glass-current-location",
    label: state.locationSource === "simulated" ? "Simulated GPS Start" : "Current Location",
    coordinate: state.position.coordinate,
    badge: state.locationSource === "simulated" ? "SIM" : "GPS"
  };
}

function isGlassPickerOption(option: GlassPickerOption | null): option is GlassPickerOption {
  return Boolean(option);
}

function dedupePickerOptions(options: GlassPickerOption[]): GlassPickerOption[] {
  return options.reduce<GlassPickerOption[]>((uniqueOptions, option) => {
    if (!uniqueOptions.some((existingOption) => samePlace(existingOption, option))) {
      uniqueOptions.push(option);
    }
    return uniqueOptions;
  }, []);
}

function visibleGlassPickerItems(target: GlassPickerTarget): GuidanceSnapshot["pickerItems"] {
  const options = glassesPickerOptions(target);
  if (options.length === 0) {
    return [{ label: "No saved places", selected: true, disabled: true }];
  }

  const selectedIndex = Math.min(Math.max(favoriteIndex(target), 0), options.length - 1);
  const visibleCount = 4;
  const firstIndex = Math.min(
    Math.max(selectedIndex - 1, 0),
    Math.max(options.length - visibleCount, 0)
  );

  return options.slice(firstIndex, firstIndex + visibleCount).map((option, offset) => ({
    label: option.label,
    badge: option.badge,
    selected: firstIndex + offset === selectedIndex,
    disabled: option.disabled
  }));
}

function shortGlassLabel(label: string): string {
  return label.length > 24 ? `${label.slice(0, 21)}...` : label;
}

function canStartNavigation(): boolean {
  return Boolean(state.position && !state.navigating && !state.routing && (state.selectedPlace || state.query.trim().length >= 3));
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
  state.locationStatus = "Simulated GPS snapped to the start of the bicycle route.";
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
    return "The Even WebView did not grant GPS access. iOS may still show Location as allowed; reopen Even and retry location.";
  }

  if (error.code === error.POSITION_UNAVAILABLE) {
    return "The phone could not provide a GPS fix right now.";
  }

  if (error.code === error.TIMEOUT) {
    return "Location timed out before the phone returned a fix.";
  }

  return error.message || "Location failed.";
}

function makeLocationDiagnostic(
  source: LocationDiagnostic["source"],
  target: "origin" | "destination",
  error: GeolocationPositionError | null,
  message: string
): LocationDiagnostic {
  return {
    source,
    target,
    code: error?.code ?? null,
    codeName: error ? geolocationCodeName(error.code) : source === "feature-check" ? "GEOLOCATION_API_MISSING" : "INSECURE_CONTEXT",
    message,
    at: Date.now(),
    secureContext: window.isSecureContext,
    hasGeolocation: "geolocation" in navigator
  };
}

function geolocationCodeName(code: number): string {
  if (code === 1) {
    return "PERMISSION_DENIED";
  }

  if (code === 2) {
    return "POSITION_UNAVAILABLE";
  }

  if (code === 3) {
    return "TIMEOUT";
  }

  return `UNKNOWN_${code}`;
}

function geolocationFallbackStatus(error: GeolocationPositionError, target: "origin" | "destination"): string {
  const fallback = target === "origin"
    ? "Tap the Start field, then tap the map to choose a starting point."
    : "Tap the Destination field, then tap the map to choose a destination.";

  if (error.code === error.PERMISSION_DENIED) {
    return `GPS blocked by the app WebView. Restart Even/phone, confirm Precise Location, then retry. ${fallback}`;
  }

  if (error.code === error.POSITION_UNAVAILABLE) {
    return `Waiting for a phone GPS fix. Try outdoors or reopen Even, then retry. ${fallback}`;
  }

  if (error.code === error.TIMEOUT) {
    return `GPS request timed out. Keep Even open on screen and retry. ${fallback}`;
  }

  return `Phone GPS unavailable. ${fallback}`;
}

function locationTroubleshootingHint(diagnostic: LocationDiagnostic): string {
  if (diagnostic.codeName === "PERMISSION_DENIED") {
    return "Check iOS Settings > Apps > Even Realities > Location, enable Precise Location, fully quit and reopen Even, then try Use current location again.";
  }

  if (diagnostic.codeName === "POSITION_UNAVAILABLE") {
    return "The phone accepted the request but did not return a fix. Try outdoors, disable Low Power Mode temporarily, reopen Even, then retry.";
  }

  if (diagnostic.codeName === "TIMEOUT") {
    return "The request took too long. Keep Even open in the foreground for 15 seconds and retry, or select a start point on the map.";
  }

  if (diagnostic.codeName === "GEOLOCATION_API_MISSING") {
    return "The host WebView did not expose the browser geolocation API. Reopen the app from Even Hub, update Even, or use a map start point.";
  }

  if (diagnostic.codeName === "INSECURE_CONTEXT") {
    return "The page is not running in a secure WebView context. This should not happen in Even Hub; use the map start fallback for now.";
  }

  return "Restart Even, phone, and glasses, then retry. If it repeats, send the code/source shown here.";
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("Timed out"));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
