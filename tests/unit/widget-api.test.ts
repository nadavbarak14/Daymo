import { describe, it, expect, vi } from "vitest";
import { createApi } from "../../widget/src/api.js";

describe("widget Api.chat", () => {
  it("POSTs to /chat with the request body and returns the parsed ChatResponse", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ kind: "no_match", text: "x" }),
    });
    const api = createApi({ baseUrl: "https://daymo.dev", fetchFn: fetchMock });
    const resp = await api.chat({ widgetId: "w", message: "hi", history: [] });
    expect(resp).toEqual({ kind: "no_match", text: "x" });
    const url = fetchMock.mock.calls[0][0];
    const init = fetchMock.mock.calls[0][1];
    expect(url).toBe("https://daymo.dev/chat");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ widgetId: "w", message: "hi", history: [] });
  });

  it("throws ApiError(429) with retryAfterSec on rate-limit response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 429,
      headers: { get: (k: string) => k.toLowerCase() === "retry-after" ? "5" : null },
      text: async () => "",
      json: async () => ({}),
    });
    const api = createApi({ baseUrl: "https://daymo.dev", fetchFn: fetchMock });
    await expect(api.chat({ widgetId: "w", message: "hi", history: [] })).rejects.toMatchObject({
      status: 429,
      retryAfterSec: 5,
    });
  });

  it("retries 502 once before succeeding", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 502, headers: { get: () => null }, text: async () => "" })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ kind: "no_match", text: "ok" }) });
    const api = createApi({ baseUrl: "https://daymo.dev", fetchFn: fetchMock });
    const r = await api.chat({ widgetId: "w", message: "hi", history: [] });
    expect(r.kind).toBe("no_match");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("widget Api.getConfig", () => {
  it("GETs /widget-config/<id> and returns the parsed config", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ widgetId: "w", name: "T", locale: "en", suggestedQuestions: [] }),
    });
    const api = createApi({ baseUrl: "https://daymo.dev", fetchFn: fetchMock });
    const cfg = await api.getConfig("w");
    expect(cfg.name).toBe("T");
    expect(fetchMock.mock.calls[0][0]).toBe("https://daymo.dev/widget-config/w");
  });
});
