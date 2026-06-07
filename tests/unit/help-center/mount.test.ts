// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
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

beforeAll(() => {
  // jsdom media stubs (same approach as player.test.ts)
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = vi.fn();
});

beforeEach(() => {
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

interface FetchOpts {
  chat?: ChatResponse;
  manifestData?: HelpManifest | null; // null => manifest fetch rejects
}

/** Records chat request bodies in `calls`. */
function makeFetch(opts: FetchOpts, calls: unknown[] = []): typeof fetch {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("manifest.json")) {
      if (opts.manifestData === null) throw new Error("network down");
      return new Response(JSON.stringify(opts.manifestData ?? manifest), { status: 200 });
    }
    expect(init?.method).toBe("POST");
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(opts.chat ?? { kind: "no_match", text: "no" }), { status: 200 });
  }) as unknown as typeof fetch;
}

function mount(extra: Record<string, unknown> = {}, fetchImpl?: typeof fetch) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const unmount = mountHelpCenter(container, {
    manifestUrl: "/help/manifest.json",
    chatEndpoint: "/api/help/chat",
    fetchImpl: fetchImpl ?? makeFetch({}),
    ...extra,
  });
  return { container, unmount };
}

async function askQuestion(container: HTMLElement, text: string) {
  const input = container.querySelector<HTMLInputElement>(".daymo-help-input")!;
  const form = container.querySelector("form")!;
  input.value = text;
  form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
}

describe("mountHelpCenter — page & options", () => {
  it("renders chrome (appbar, hero, footer, FAB) with defaults", async () => {
    const { container } = mount();
    expect(container.querySelector(".daymo-help-appbar")).toBeTruthy();
    expect(container.querySelector(".daymo-help-nm")?.textContent).toBe("Help");
    expect(container.querySelector(".daymo-help-h1")?.textContent).toBe("How can we help?");
    expect(container.querySelector(".daymo-help-footer")?.textContent).toContain("Built with");
    expect(container.querySelector(".daymo-help-fab")).toBeTruthy();
    // contact hidden without contactHref
    expect(container.querySelector<HTMLElement>(".daymo-help-contact")?.hidden).toBe(true);
    await vi.waitFor(() => {
      expect(container.querySelector(".daymo-help-card")).toBeTruthy();
    });
  });

  it("wires options through: name, title, brandColor, contactHref, suggestedQuestions", () => {
    const { container } = mount({
      name: "Acme",
      title: "Need a hand?",
      brandColor: "#ff0066",
      contactHref: "mailto:help@acme.io",
      suggestedQuestions: ["How do I start?", "How do I share?"],
    });
    const nm = container.querySelector(".daymo-help-nm")!;
    expect(nm.textContent).toContain("Acme");
    expect(nm.querySelector("span")?.textContent).toBe("Help");
    expect(container.querySelector(".daymo-help-h1")?.textContent).toBe("Need a hand?");
    const root = container.querySelector<HTMLElement>(".daymo-help")!;
    expect(root.style.getPropertyValue("--daymo-accent")).toBe("#ff0066");
    // modal (body-appended) gets the accent too
    const modal = document.body.querySelector<HTMLElement>(".daymo-help-modal")!;
    expect(modal.style.getPropertyValue("--daymo-accent")).toBe("#ff0066");
    const contact = container.querySelector<HTMLAnchorElement>(".daymo-help-contact")!;
    expect(contact.hidden).toBe(false);
    expect(contact.href).toContain("mailto:help@acme.io");
    expect(container.querySelectorAll(".daymo-help-suggest .daymo-help-chip")).toHaveLength(2);
  });

  it("chrome:false drops appbar, footer and FAB but keeps hero + gallery", async () => {
    const { container } = mount({ chrome: false });
    expect(container.querySelector(".daymo-help-appbar")).toBeNull();
    expect(container.querySelector(".daymo-help-footer")).toBeNull();
    expect(container.querySelector(".daymo-help-fab")).toBeNull();
    expect(container.querySelector(".daymo-help-hero")).toBeTruthy();
    await vi.waitFor(() => expect(container.querySelector(".daymo-help-card")).toBeTruthy());
  });

  it("strings overrides replace visible copy", () => {
    const { container } = mount({
      strings: { galleryHeading: "Tutorials", askPlaceholder: "Frag mich…", lede: "Kurze Videos." },
    });
    expect(container.querySelector(".daymo-help-section h2")?.textContent).toBe("Tutorials");
    expect(container.querySelector<HTMLInputElement>(".daymo-help-input")?.placeholder).toBe("Frag mich…");
    expect(container.querySelector(".daymo-help-lede")?.textContent).toBe("Kurze Videos.");
  });

  it("logoUrl replaces the appbar mark and the assistant avatar", async () => {
    const { container } = mount({ logoUrl: "https://acme.io/logo.png" });
    const mk = container.querySelector(".daymo-help-mk img") as HTMLImageElement;
    expect(mk?.src).toContain("logo.png");
    await askQuestion(container, "hi");
    await vi.waitFor(() => {
      const av = container.querySelector(".daymo-help-a-av img") as HTMLImageElement;
      expect(av?.src).toContain("logo.png");
    });
  });
});

describe("mountHelpCenter — gallery", () => {
  it("renders card buttons from the manifest; click opens the player", async () => {
    const { container } = mount();
    await vi.waitFor(() => expect(container.querySelector(".daymo-help-card")).toBeTruthy());
    const card = container.querySelector<HTMLButtonElement>(".daymo-help-card")!;
    expect(card.tagName).toBe("BUTTON");
    expect(card.getAttribute("data-demo-id")).toBe("d");
    expect(card.textContent).toContain("Create a note");
    expect(card.textContent).toContain("1:30"); // durationLabel
    expect(card.textContent).toContain("1 steps");
    card.click();
    const modal = document.body.querySelector(".daymo-help-modal")!;
    expect(modal.classList.contains("open")).toBe(true);
    expect(modal.textContent).toContain("Create a note");
  });

  it("hides the gallery section (and jump links) when the manifest is empty", async () => {
    const empty: HelpManifest = { version: "v1", videoBaseUrl: "x", demos: [] };
    const { container } = mount({}, makeFetch({ manifestData: empty }));
    await Promise.resolve();
    await vi.waitFor(() => {
      expect(container.querySelector<HTMLElement>(".daymo-help-section")?.hidden).toBe(true);
    });
  });

  it("hides the gallery section when the manifest fetch fails", async () => {
    const { container } = mount({}, makeFetch({ manifestData: null }));
    await vi.waitFor(() => {
      expect(container.querySelector<HTMLElement>(".daymo-help-section")?.hidden).toBe(true);
    });
  });
});

describe("mountHelpCenter — chat", () => {
  it("shows a typing indicator, then renders text + a clip card that opens the player cued", async () => {
    const chat: ChatResponse = {
      kind: "answer",
      parts: [
        { kind: "text", text: "Here is how." },
        { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1000, endMs: 5000, caption: "click new", mp4Url: "https://cdn/help/v1/d/output.mp4" },
      ],
    };
    const { container } = mount({}, makeFetch({ chat }));
    await vi.waitFor(() => expect(container.querySelector(".daymo-help-card")).toBeTruthy());
    await askQuestion(container, "how do I create a note");
    expect(container.querySelector(".daymo-help-typing")).toBeTruthy();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Here is how.");
    });
    const thread = container.querySelector(".daymo-help-thread")!;
    expect(thread.getAttribute("aria-live")).toBe("polite");
    const clip = container.querySelector<HTMLButtonElement>(".daymo-help-clip")!;
    expect(clip.textContent).toContain("click new");
    expect(clip.textContent).toContain("0:01–0:05");
    expect(clip.textContent).toContain("Create a note");
    clip.click();
    expect(document.body.querySelector(".daymo-help-modal")?.classList.contains("open")).toBe(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("falls back to an inline video for an unknown demoId", async () => {
    const chat: ChatResponse = {
      kind: "answer",
      parts: [
        { kind: "video", stepId: "x:0:1", demoId: "unknown", startMs: 1000, endMs: 5000, caption: "cap", mp4Url: "https://cdn/x.mp4" },
      ],
    };
    const { container } = mount({}, makeFetch({ chat }));
    await askQuestion(container, "q");
    await vi.waitFor(() => {
      const video = container.querySelector<HTMLVideoElement>(".daymo-help-thread video");
      expect(video?.src).toContain("x.mp4#t=1,5");
    });
  });

  it("no_match renders server suggestions as chips that re-ask", async () => {
    const chat: ChatResponse = { kind: "no_match", text: "Nothing found.", suggestions: ["Try this"] };
    const calls: unknown[] = [];
    const { container } = mount({ suggestedQuestions: ["Opt A"] }, makeFetch({ chat }, calls));
    await askQuestion(container, "zzz");
    await vi.waitFor(() => expect(container.textContent).toContain("Nothing found."));
    const chips = container.querySelectorAll<HTMLButtonElement>(".daymo-help-a-chips .daymo-help-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe("Try this"); // server suggestions win over the option
    chips[0].click();
    await vi.waitFor(() => {
      const bubbles = container.querySelectorAll(".daymo-help-q-bubble");
      expect(bubbles[bubbles.length - 1].textContent).toBe("Try this");
    });
  });

  it("no_match falls back to the suggestedQuestions option when the server sends none", async () => {
    const chat: ChatResponse = { kind: "no_match", text: "Nothing found." };
    const { container } = mount({ suggestedQuestions: ["Opt A", "Opt B"] }, makeFetch({ chat }));
    await askQuestion(container, "zzz");
    await vi.waitFor(() => {
      expect(container.querySelectorAll(".daymo-help-a-chips .daymo-help-chip")).toHaveLength(2);
    });
  });

  it("history excludes the current message and truncates to the last 2 turns", async () => {
    const calls: { message: string; history: unknown[] }[] = [];
    const chat: ChatResponse = { kind: "answer", parts: [{ kind: "text", text: "A1" }] };
    const { container } = mount({}, makeFetch({ chat }, calls));
    await askQuestion(container, "q1");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].history).toEqual([]);
    await vi.waitFor(() => expect(container.textContent).toContain("A1"));
    await askQuestion(container, "q2");
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].history).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "A1" },
    ]);
    await vi.waitFor(() => expect(container.querySelectorAll(".daymo-help-qa")).toHaveLength(2));
    await askQuestion(container, "q3");
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    // last 2 of [q1,A1,q2,A2] => [q2, A2]
    expect(calls[2].history).toEqual([
      { role: "user", content: "q2" },
      { role: "assistant", content: "A1" }, // NOTE: second answer is also "A1" (same mock)
    ]);
  });

  it("renders the error string when the chat endpoint fails", async () => {
    const failing = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("manifest.json")) {
        return new Response(JSON.stringify(manifest), { status: 200 });
      }
      throw new Error("down");
    }) as unknown as typeof fetch;
    const { container } = mount({}, failing);
    await askQuestion(container, "q");
    await vi.waitFor(() => {
      expect(container.querySelector(".daymo-help-error")?.textContent).toBe(
        "Couldn't reach the assistant. Try again.",
      );
    });
  });
});

describe("mountHelpCenter — unmount hygiene", () => {
  it("unmount removes the UI and the body-appended modal, restoring scroll", async () => {
    const { container, unmount } = mount();
    await vi.waitFor(() => expect(container.querySelector(".daymo-help-card")).toBeTruthy());
    container.querySelector<HTMLButtonElement>(".daymo-help-card")!.click();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(container.querySelector(".daymo-help")).toBeNull();
    expect(document.body.querySelector(".daymo-help-modal")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("two mounts coexist (no ids, no shared state)", async () => {
    const a = mount();
    const b = mount();
    await vi.waitFor(() => {
      expect(a.container.querySelector(".daymo-help-card")).toBeTruthy();
      expect(b.container.querySelector(".daymo-help-card")).toBeTruthy();
    });
    a.unmount();
    expect(b.container.querySelector(".daymo-help")).toBeTruthy();
    expect(document.body.querySelectorAll(".daymo-help-modal")).toHaveLength(1);
    b.unmount();
  });
});
