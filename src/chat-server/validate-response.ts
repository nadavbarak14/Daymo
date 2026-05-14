import type { ChatResponse, IndexedChunk } from "../types.js";

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

const MAX_PARTS = 6;
const MAX_VIDEO_PARTS = 3;

export function validateChatResponse(
  resp: ChatResponse,
  stepLookup: Map<string, IndexedChunk>,
): ValidationResult {
  if (resp.kind === "no_match") return { ok: true };

  const parts = resp.parts;
  if (parts.length === 0 || parts.length > MAX_PARTS) {
    return { ok: false, reason: `parts count out of range: ${parts.length}` };
  }

  let videoCount = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.kind === "video") {
      videoCount += 1;
      if (i > 0 && parts[i - 1].kind === "video") {
        return { ok: false, reason: `two consecutive video parts at index ${i}` };
      }
      const idx = stepLookup.get(p.stepId);
      if (!idx) return { ok: false, reason: `unknown stepId: ${p.stepId}` };
      if (idx.globalStartMs !== p.startMs || idx.globalEndMs !== p.endMs) {
        return { ok: false, reason: `timestamp mismatch for ${p.stepId}` };
      }
      if (idx.demoId !== p.demoId) {
        return { ok: false, reason: `demoId mismatch for ${p.stepId}` };
      }
    }
  }
  if (videoCount > MAX_VIDEO_PARTS) {
    return { ok: false, reason: `too many video parts: ${videoCount}` };
  }
  return { ok: true };
}
