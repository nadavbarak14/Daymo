import type { EditorState } from "./types";

async function jsonOrThrow<T>(p: Promise<Response>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const api = {
  state: (): Promise<EditorState> => jsonOrThrow(fetch("/api/state")),
  capture: (i: number) => jsonOrThrow(fetch(`/api/capture/${i}`, { method: "POST" })),
  setProse: (i: number, prose: string) =>
    jsonOrThrow(
      fetch(`/api/script/${i}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prose }),
      }),
    ),
  setStep: (
    sceneIndex: number,
    stepIndex: number,
    kind: "description" | "say" | "banner" | "type",
    text: string,
    typeIndex?: number,
  ) =>
    jsonOrThrow(
      fetch(`/api/step`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sceneIndex, stepIndex, kind, text, typeIndex }),
      }),
    ),
  stitch: () => jsonOrThrow<{ output: string }>(fetch("/api/stitch", { method: "POST" })),
};
