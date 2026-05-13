import { create } from "zustand";
import type { EditorState, SceneRow } from "./lib/types";

export interface Draft {
  id: string;
  sceneIndex: number;
  /** Target of the comment. New step.* kinds carry a stepIndex. */
  targetKind:
    | "caption"
    | "overlay"
    | "step.description"
    | "step.say"
    | "step.banner";
  targetIndex?: number;
  stepIndex?: number;
  text: string;
}

export interface SeekRequest {
  sceneIndex: number;
  seconds: number;
  /** Bumped on every request so identical {sceneIndex, seconds} still trigger
   *  a seek when the user clicks the same step row twice. */
  nonce: number;
}

export interface PendingStepEdit {
  sceneIndex: number;
  stepIndex: number;
  kind: "description" | "say" | "banner" | "type";
  /** Only meaningful when kind === "type". Defaults to 0. */
  typeIndex?: number;
  text: string;
}

function editKey(e: { sceneIndex: number; stepIndex: number; kind: PendingStepEdit["kind"]; typeIndex?: number }): string {
  return `${e.sceneIndex}:${e.stepIndex}:${e.kind}:${e.typeIndex ?? 0}`;
}

interface UiStore {
  state: EditorState | null;
  selectedSceneIndex: number | null;
  /** When non-null, the right-side Script panel renders only this step in
   *  focused/detail mode (set by clicking a step row in the Rail). */
  focusedStepIndex: number | null;
  drafts: Draft[];
  capturing: number[];
  panelOpen: boolean;
  seekRequest: SeekRequest | null;
  /** In-memory edits not yet persisted to the demo file. The Script panel's
   *  Save button POSTs these and then clears them for the affected scene. */
  pendingEdits: PendingStepEdit[];
  /** Latest JPEG-base64 frame from an in-flight capture, keyed by sceneIndex.
   *  Cleared when capture-done arrives. */
  liveFrames: Record<number, string>;
  /** Truthy while a stitch is running. Cleared on stitch-done or stitch-error. */
  stitching: boolean;
  /** Latest ffmpeg stderr line during stitch — used as a one-line progress
   *  display. Cleared when stitch-done/error fires. */
  stitchLine: string | null;
  /** When non-null, the stitch failed with this message. */
  stitchError: string | null;
  setState: (s: EditorState) => void;
  patchScene: (i: number, patch: Partial<SceneRow>) => void;
  setSelected: (i: number | null) => void;
  setFocusedStep: (i: number | null) => void;
  addDraft: (d: Omit<Draft, "id">) => void;
  removeDraft: (id: string) => void;
  clearDrafts: () => void;
  markCapturing: (i: number) => void;
  clearCapturing: (i: number) => void;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  requestSeek: (sceneIndex: number, seconds: number) => void;
  setLiveFrame: (sceneIndex: number, jpeg: string) => void;
  clearLiveFrame: (sceneIndex: number) => void;
  stitchStart: () => void;
  setStitchLine: (line: string) => void;
  stitchDone: () => void;
  stitchFailed: (message: string) => void;
  setPendingEdit: (e: PendingStepEdit) => void;
  removePendingEdit: (
    sceneIndex: number,
    stepIndex: number,
    kind: PendingStepEdit["kind"],
    typeIndex?: number,
  ) => void;
  clearPendingEdits: (sceneIndex?: number) => void;
}

export const useUi = create<UiStore>((set) => ({
  state: null,
  selectedSceneIndex: null,
  focusedStepIndex: null,
  drafts: [],
  capturing: [],
  panelOpen: false,
  seekRequest: null,
  pendingEdits: [],
  liveFrames: {},
  stitching: false,
  stitchLine: null,
  stitchError: null,
  setState: (s) => set({ state: s }),
  patchScene: (i, patch) =>
    set((u) => {
      if (!u.state) return u;
      const scenes = u.state.scenes.map((row, idx) => (idx === i ? { ...row, ...patch } : row));
      return { state: { ...u.state, scenes } };
    }),
  setSelected: (i) =>
    set((u) => (u.selectedSceneIndex === i ? u : { selectedSceneIndex: i, focusedStepIndex: null })),
  setFocusedStep: (i) => set({ focusedStepIndex: i }),
  addDraft: (d) =>
    set((u) => ({ drafts: [...u.drafts, { ...d, id: Math.random().toString(36).slice(2) }] })),
  removeDraft: (id) => set((u) => ({ drafts: u.drafts.filter((x) => x.id !== id) })),
  clearDrafts: () => set({ drafts: [] }),
  markCapturing: (i) =>
    set((u) => (u.capturing.includes(i) ? u : { capturing: [...u.capturing, i] })),
  clearCapturing: (i) => set((u) => ({ capturing: u.capturing.filter((x) => x !== i) })),
  togglePanel: () => set((u) => ({ panelOpen: !u.panelOpen })),
  setPanelOpen: (open) => set({ panelOpen: open }),
  requestSeek: (sceneIndex, seconds) =>
    set((u) => ({
      selectedSceneIndex: sceneIndex,
      seekRequest: { sceneIndex, seconds, nonce: (u.seekRequest?.nonce ?? 0) + 1 },
    })),
  setLiveFrame: (sceneIndex, jpeg) =>
    set((u) => ({ liveFrames: { ...u.liveFrames, [sceneIndex]: jpeg } })),
  clearLiveFrame: (sceneIndex) =>
    set((u) => {
      if (!(sceneIndex in u.liveFrames)) return u;
      const next = { ...u.liveFrames };
      delete next[sceneIndex];
      return { liveFrames: next };
    }),
  stitchStart: () => set({ stitching: true, stitchLine: null, stitchError: null }),
  setStitchLine: (line) => set({ stitchLine: line }),
  stitchDone: () => set({ stitching: false, stitchLine: null }),
  stitchFailed: (message) => set({ stitching: false, stitchLine: null, stitchError: message }),
  setPendingEdit: (e) =>
    set((u) => {
      const k = editKey(e);
      const others = u.pendingEdits.filter((p) => editKey(p) !== k);
      return { pendingEdits: [...others, e] };
    }),
  removePendingEdit: (sceneIndex, stepIndex, kind, typeIndex) =>
    set((u) => {
      const k = editKey({ sceneIndex, stepIndex, kind, typeIndex });
      return { pendingEdits: u.pendingEdits.filter((p) => editKey(p) !== k) };
    }),
  clearPendingEdits: (sceneIndex) =>
    set((u) => ({
      pendingEdits:
        sceneIndex === undefined
          ? []
          : u.pendingEdits.filter((p) => p.sceneIndex !== sceneIndex),
    })),
}));
