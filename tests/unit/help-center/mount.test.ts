// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mountHelpCenter } from "../../../src/help-center/mount.js";
import type { HelpManifest } from "../../../src/publish/types.js";
import type { ChatResponse } from "../../../src/types.js";

const manifest: HelpManifest = {
  version: "v1",
  videoBaseUrl: "https://cdn/help/v1",
  demos: [
    {
      demoId: "d",
      title: "Create a note",
      description: "How to create",
      durationMs: 90000,
      videoUrl: "https://cdn/help/v1/d/output.mp4",
      posterUrl: "https://cdn/help/v1/d/poster.jpg",
      steps: [{ stepId: "d:0:1", label: "click", startMs: 0 }],
    },
  ],
};

function makeFetch(chat: ChatResponse): typeof fetch {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("manifest.json")) {
      return new Response(JSON.stringify(manifest), { status: 200 });
    }
    // chat endpoint
    expect(init?.method).toBe("POST");
    return new Response(JSON.stringify(chat), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("mountHelpCenter", () => {
  it("renders gallery cards from the manifest", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountHelpCenter(container, {
      manifestUrl: "/help/manifest.json",
      chatEndpoint: "/api/help/chat",
      title: "typenote Help",
      fetchImpl: makeFetch({ kind: "no_match", text: "no" }),
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("typenote Help");
      expect(container.textContent).toContain("Create a note");
      expect(container.querySelector("[data-demo-id='d']")).toBeTruthy();
    });
  });

  it("sends a chat message and renders an assistant answer", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const chat: ChatResponse = {
      kind: "answer",
      parts: [
        { kind: "text", text: "Here is how." },
        { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1000, endMs: 5000, caption: "click new", mp4Url: "https://cdn/help/v1/d/output.mp4" },
      ],
    };
    mountHelpCenter(container, {
      manifestUrl: "/help/manifest.json",
      chatEndpoint: "/api/help/chat",
      fetchImpl: makeFetch(chat),
    });
    const input = container.querySelector<HTMLInputElement>("input.daymo-help-input")!;
    const form = container.querySelector("form")!;
    input.value = "how do I create a note";
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Here is how.");
      const video = container.querySelector<HTMLVideoElement>(".daymo-help-thread video");
      expect(video?.src).toContain("/d/output.mp4#t=1,5");
    });
  });

  it("unmount removes the UI", () => {
    const container = document.createElement("div");
    const unmount = mountHelpCenter(container, {
      manifestUrl: "/help/manifest.json",
      chatEndpoint: "/api/help/chat",
      fetchImpl: makeFetch({ kind: "no_match", text: "no" }),
    });
    expect(container.querySelector(".daymo-help")).toBeTruthy();
    unmount();
    expect(container.querySelector(".daymo-help")).toBeNull();
  });
});
