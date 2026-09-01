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
  error?: string;
  scrollTop: number;
}

interface WorkspaceState {
  project?: Project;
  source?: SourceDocument;
  design?: DesignDocument;
  sourceAssetUrl?: string;
  panes: PreviewPane[];
  /** Pane whose device picker / controls the right panel is editing. */
  activePaneId?: string;
  /** Pane the device explorer is currently choosing a device for, if any. */
  pickingForPaneId?: string;
  syncScroll: boolean;
  devMode: boolean;
  selectedNodeId?: string;
  /** Node used as the second endpoint when measuring a distance. */
  measureFromNodeId?: string;
  inspectorOpen: boolean;
  validationExpanded: boolean;
  zoom: number;
  favourites: string[];
  recents: string[];

  setProject(project: Project): void;
  setSource(input: { source: SourceDocument; design: DesignDocument }): void;
  reset(): void;

  addPane(deviceId: string): string;
  removePane(id: string): void;
  setPaneDevice(id: string, deviceId: string): void;
  updatePane(id: string, patch: Partial<PreviewPane>): void;
  setChrome(id: string, patch: Partial<ChromeToggles>): void;
  setAllChrome(patch: Partial<ChromeToggles>): void;
  setActivePane(id: string): void;
  setPickingFor(id: string | undefined): void;
  setScroll(id: string, scrollTop: number): void;

  setSyncScroll(value: boolean): void;
  setDevMode(value: boolean): void;
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
  syncScroll: true,
  devMode: false,
  inspectorOpen: false,
  validationExpanded: false,
  zoom: 0.8,
  favourites: readList(FAVOURITES_KEY),
  recents: readList(RECENTS_KEY),

  setProject: (project) => set({ project }),

  setSource: ({ source, design }) =>
    set({ source, design, selectedNodeId: undefined, measureFromNodeId: undefined }),

  reset: () =>
    set({
      source: undefined,
      design: undefined,
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
        },
      ],
      activePaneId: id,
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
  setPickingFor: (id) => set({ pickingForPaneId: id }),

  setScroll: (id, scrollTop) =>
    set((state) =>
      state.syncScroll
        ? { panes: state.panes.map((p) => ({ ...p, scrollTop })) }
        : { panes: state.panes.map((p) => (p.id === id ? { ...p, scrollTop } : p)) },
    ),

  setSyncScroll: (value) => set({ syncScroll: value }),
  setDevMode: (value) =>
    set({ devMode: value, ...(value ? {} : { selectedNodeId: undefined, measureFromNodeId: undefined, inspectorOpen: false }) }),
  selectNode: (nodeId) => set({ selectedNodeId: nodeId, inspectorOpen: nodeId !== undefined }),
  setMeasureFrom: (nodeId) => set({ measureFromNodeId: nodeId }),
  setInspectorOpen: (value) => set({ inspectorOpen: value }),
  setValidationExpanded: (value) => set({ validationExpanded: value }),
  setZoom: (value) => set({ zoom: Math.min(1.5, Math.max(0.25, value)) }),

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
