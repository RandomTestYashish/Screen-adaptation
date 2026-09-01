import { create } from 'zustand';
import type {
  AdaptationOptions,
  DesignDocument,
  Project,
  RenderResponseT,
  SourceDocument,
  ValidationReport,
} from '@dae/shared';

/**
 * Which of the renderer's independent layers are drawn.
 *
 * Every one of these is a *layer* toggle, never a change to the design: the
 * user's artwork lives in its own layer that none of these affect
 * (spec sections 9 and 12).
 */
export interface ChromeToggles {
  deviceShell: boolean;
  statusBar: boolean;
  cutout: boolean;
  homeIndicator: boolean;
  androidNavigation: boolean;
  safeAreaOverlay: boolean;
  keyboard: boolean;
  darkChrome: boolean;
  inspectionOverlays: boolean;
}

export interface OverlayToggles {
  /** Viewport bounds and content bounds. */
  bounds: boolean;
  /** Safe-area bands with their measurements. */
  safeArea: boolean;
  /** Horizontal margin guides and a spacing ruler. */
  rulers: boolean;
  /** Device geometry read-out pinned to the frame. */
  geometry: boolean;
  opacity: number;
}

export const DEFAULT_OVERLAY: OverlayToggles = {
  bounds: true,
  safeArea: true,
  rulers: true,
  geometry: true,
  opacity: 0.85,
};

export const DEFAULT_CHROME: ChromeToggles = {
  deviceShell: true,
  statusBar: true,
  cutout: true,
  homeIndicator: true,
  androidNavigation: true,
  safeAreaOverlay: false,
  keyboard: false,
  darkChrome: false,
  inspectionOverlays: true,
};

export interface PreviewPane {
  id: string;
  deviceId: string;
  orientation: AdaptationOptions['orientation'];
  chrome: ChromeToggles;
  /** Latest render for this pane, or undefined while loading. */
  render?: RenderResponseT;
  validation?: ValidationReport;
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Which stage of the pipeline is running, for the progress list. */
  stage?: 'analysing' | 'adapting' | 'rendering' | 'validating';
  error?: string;
  scrollTop: number;
  /** 0..1 position through the scrollable extent, for linked scrolling. */
  scrollProgress: number;
}

interface WorkspaceState {
  project?: Project;
  source?: SourceDocument;
  design?: DesignDocument;
  sourceAssetUrl?: string;
  panes: PreviewPane[];
  /**
   * The pane the right panel is editing.
   *
   * Undefined is the *neutral* state, and it is the default in compare mode:
   * two devices being compared are equal until one is chosen, and clicking the
   * empty canvas returns them to equal (spec sections 24 and 47).
   */
  activePaneId?: string;
  /** Pane the device explorer is currently choosing a device for, if any. */
  pickingForPaneId?: string;
  syncScroll: boolean;
  devMode: boolean;
  /** Reconstruction confidence and reasoning, distinct from Dev Mode. */
  aiMode: boolean;
  /** Transparent viewport / safe-area / ruler overlay. Off by default. */
  overlayMode: boolean;
  overlay: OverlayToggles;
  /** Editor chrome hidden for presenting. */
  presentMode: boolean;
  sidebarOpen: boolean;
  /** Design system measured from the source, when it was reconstructed. */
  dna?: unknown;
  selectedNodeId?: string;
  /** Node used as the second endpoint when measuring a distance. */
  measureFromNodeId?: string;
  inspectorOpen: boolean;
  validationExpanded: boolean;
  zoom: number;
  favourites: string[];
  recents: string[];

  setProject(project: Project): void;
  setSource(input: { source: SourceDocument; design: DesignDocument; dna?: unknown }): void;
  reset(): void;

  addPane(deviceId: string): string;
  removePane(id: string): void;
  setPaneDevice(id: string, deviceId: string): void;
  updatePane(id: string, patch: Partial<PreviewPane>): void;
  setChrome(id: string, patch: Partial<ChromeToggles>): void;
  setAllChrome(patch: Partial<ChromeToggles>): void;
  setActivePane(id: string | undefined): void;
  setPickingFor(id: string | undefined): void;
  setScroll(id: string, scrollTop: number, scrollProgress: number): void;

  setSyncScroll(value: boolean): void;
  setDevMode(value: boolean): void;
  setAiMode(value: boolean): void;
  setOverlayMode(value: boolean): void;
  setOverlay(patch: Partial<OverlayToggles>): void;
  setPresentMode(value: boolean): void;
  setSidebarOpen(value: boolean): void;
  /** Return every pane to equal weight. */
  clearActivePane(): void;
  selectNode(nodeId: string | undefined): void;
  setMeasureFrom(nodeId: string | undefined): void;
  setInspectorOpen(value: boolean): void;
  setValidationExpanded(value: boolean): void;
  setZoom(value: number): void;
  toggleFavourite(deviceId: string): void;
  noteRecent(deviceId: string): void;
}

let paneCounter = 0;
const nextPaneId = () => `pane-${++paneCounter}`;

const FAVOURITES_KEY = 'dae.favourites';
const RECENTS_KEY = 'dae.recents';

function readList(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeList(key: string, value: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); favourites
    // are a convenience, so failing to persist them must not break anything.
  }
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  panes: [],
  syncScroll: false,
  devMode: false,
  aiMode: false,
  overlayMode: false,
  overlay: { ...DEFAULT_OVERLAY },
  presentMode: false,
  sidebarOpen: true,
  inspectorOpen: false,
  validationExpanded: false,
  zoom: 0.8,
  favourites: readList(FAVOURITES_KEY),
  recents: readList(RECENTS_KEY),

  setProject: (project) => set({ project }),

  setSource: ({ source, design, dna }) =>
    set({ source, design, dna, selectedNodeId: undefined, measureFromNodeId: undefined }),

  reset: () =>
    set({
      source: undefined,
      design: undefined,
      dna: undefined,
      panes: [],
      activePaneId: undefined,
      pickingForPaneId: undefined,
      selectedNodeId: undefined,
      measureFromNodeId: undefined,
      inspectorOpen: false,
    }),

  addPane: (deviceId) => {
    const id = nextPaneId();
    // A new pane inherits the active pane's layer toggles, so adding a second
    // device compares like with like.
    const template = get().panes.find((p) => p.id === get().activePaneId);
    set((state) => ({
      panes: [
        ...state.panes,
        {
          id,
          deviceId,
          orientation: 'portrait',
          chrome: { ...(template?.chrome ?? DEFAULT_CHROME) },
          status: 'idle',
          scrollTop: 0,
          scrollProgress: 0,
        },
      ],
      // A second device joins as an equal. Making it active would tell the
      // designer the new one matters more, which is the opposite of comparing.
      activePaneId: state.panes.length === 0 ? id : state.activePaneId,
      pickingForPaneId: undefined,
    }));
    get().noteRecent(deviceId);
    return id;
  },

  removePane: (id) =>
    set((state) => {
      const panes = state.panes.filter((p) => p.id !== id);
      return {
        panes,
        activePaneId: state.activePaneId === id ? panes[0]?.id : state.activePaneId,
        pickingForPaneId: state.pickingForPaneId === id ? undefined : state.pickingForPaneId,
      };
    }),

  setPaneDevice: (id, deviceId) => {
    set((state) => ({
      panes: state.panes.map((p) =>
        p.id === id ? { ...p, deviceId, render: undefined, validation: undefined, status: 'loading' } : p,
      ),
      pickingForPaneId: undefined,
    }));
    get().noteRecent(deviceId);
  },

  updatePane: (id, patch) =>
    set((state) => ({ panes: state.panes.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),

  setChrome: (id, patch) =>
    set((state) => ({
      panes: state.panes.map((p) => (p.id === id ? { ...p, chrome: { ...p.chrome, ...patch } } : p)),
    })),

  setAllChrome: (patch) =>
    set((state) => ({ panes: state.panes.map((p) => ({ ...p, chrome: { ...p.chrome, ...patch } })) })),

  setActivePane: (id) => set({ activePaneId: id }),
  clearActivePane: () => set({ activePaneId: undefined }),
  setPickingFor: (id) => set({ pickingForPaneId: id }),

  setScroll: (id, scrollTop, scrollProgress) =>
    set((state) => ({
      panes: state.panes.map((pane) => {
        if (pane.id === id) return { ...pane, scrollTop, scrollProgress };
        if (!state.syncScroll) return pane;

        /*
         * Linked scrolling matches *progress*, not pixels.
         *
         * Two devices reflow to different document heights, so copying a raw
         * scroll offset would drift further apart the further down you go, and
         * the bottom of one would never line up with the bottom of the other.
         */
        const extent = Math.max(0, (pane.render?.adaptation.plan.targetScrollHeight ?? 0) - (pane.render?.adaptation.plan.usableViewport.height ?? 0));
        return { ...pane, scrollProgress, scrollTop: extent * scrollProgress };
      }),
    })),

  setSyncScroll: (value) => set({ syncScroll: value }),
  setAiMode: (value) => set({ aiMode: value }),
  setOverlayMode: (value) => set({ overlayMode: value }),
  setOverlay: (patch) => set((state) => ({ overlay: { ...state.overlay, ...patch } })),
  setPresentMode: (value) =>
    // Presenting hides the editor, so the inspection modes go with it.
    set(value ? { presentMode: true, devMode: false, aiMode: false, inspectorOpen: false } : { presentMode: false }),
  setSidebarOpen: (value) => set({ sidebarOpen: value }),
  setDevMode: (value) =>
    set({ devMode: value, ...(value ? {} : { selectedNodeId: undefined, measureFromNodeId: undefined, inspectorOpen: false }) }),
  selectNode: (nodeId) => set({ selectedNodeId: nodeId, inspectorOpen: nodeId !== undefined }),
  setMeasureFrom: (nodeId) => set({ measureFromNodeId: nodeId }),
  setInspectorOpen: (value) => set({ inspectorOpen: value }),
  setValidationExpanded: (value) => set({ validationExpanded: value }),
  // Snapped to 10% steps: free-form zoom makes it impossible to return to a
  // known scale, and two panes at 83% and 84% are not comparable.
  setZoom: (value) => set({ zoom: Math.min(1.5, Math.max(0.3, Math.round(value * 10) / 10)) }),

  toggleFavourite: (deviceId) =>
    set((state) => {
      const favourites = state.favourites.includes(deviceId)
        ? state.favourites.filter((f) => f !== deviceId)
        : [...state.favourites, deviceId];
      writeList(FAVOURITES_KEY, favourites);
      return { favourites };
    }),

  noteRecent: (deviceId) =>
    set((state) => {
      const recents = [deviceId, ...state.recents.filter((r) => r !== deviceId)].slice(0, 8);
      writeList(RECENTS_KEY, recents);
      return { recents };
    }),
}));
