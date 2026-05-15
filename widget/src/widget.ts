import { mount } from "./mount.js";

function init() {
  const script = document.currentScript as HTMLScriptElement | null
    ?? document.querySelector<HTMLScriptElement>("script[data-widget-id]");
  if (!script) {
    // eslint-disable-next-line no-console
    console.warn("[daymo-widget] script tag with data-widget-id not found");
    return;
  }
  const widgetId = script.getAttribute("data-widget-id");
  const baseUrl = script.getAttribute("data-base-url")
    ?? new URL(script.src).origin;
  const locale = script.getAttribute("data-locale") ?? undefined;
  if (!widgetId) {
    // eslint-disable-next-line no-console
    console.warn("[daymo-widget] data-widget-id is required");
    return;
  }
  mount({ widgetId, baseUrl, localeOverride: locale ?? undefined }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[daymo-widget] mount failed:", err);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
