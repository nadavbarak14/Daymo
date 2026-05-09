import { create } from "zustand";
import type { EditorState, SceneRow } from "./lib/types";

export interface Draft {
  id: string;
  sceneIndex: number;
  targetKind: "caption" | "overlay";
  targetIndex?: number;
  text: string;
}

interface UiStore {
  state: EditorState | null;
  selectedSceneIndex: number | null;
  drafts: Draft[];
  setState: (s: EditorState) => void;
  patchScene: (i: number, patch: Partial<SceneRow>) => void;
  setSelected: (i: number | null) => void;
  addDraft: (d: Omit<Draft, "id">) => void;
  removeDraft: (id: string) => void;
  clearDrafts: () => void;
}

export const useUi = create<UiStore>((set) => ({
  state: null,
  selectedSceneIndex: null,
  drafts: [],
  setState: (s) => set({ state: s }),
  patchScene: (i, patch) =>
    set((u) => {
      if (!u.state) return u;
      const scenes = u.state.scenes.map((row, idx) => (idx === i ? { ...row, ...patch } : row));
      return { state: { ...u.state, scenes, allApproved: scenes.every((r) => r.state === "approved") } };
    }),
  setSelected: (i) => set({ selectedSceneIndex: i }),
  addDraft: (d) =>
    set((u) => ({ drafts: [...u.drafts, { ...d, id: Math.random().toString(36).slice(2) }] })),
  removeDraft: (id) => set((u) => ({ drafts: u.drafts.filter((x) => x.id !== id) })),
  clearDrafts: () => set({ drafts: [] }),
}));
