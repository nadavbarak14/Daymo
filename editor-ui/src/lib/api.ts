import type { EditorState } from "./types";

async function jsonOrThrow<T>(p: Promise<Response>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const api = {
  state: (): Promise<EditorState> => jsonOrThrow(fetch("/api/state")),
  capture: (i: number) => jsonOrThrow(fetch(`/api/capture/${i}`, { method: "POST" })),
  approve: (i: number, approved: boolean) =>
    jsonOrThrow(
      fetch(`/api/approve/${i}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved }),
      }),
    ),
  setProse: (i: number, prose: string) =>
    jsonOrThrow(
      fetch(`/api/script/${i}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prose }),
      }),
    ),
  stitch: () => jsonOrThrow<{ output: string }>(fetch("/api/stitch", { method: "POST" })),
};
