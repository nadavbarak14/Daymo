export interface Chunk {
  stepId: string;            // "<demoId>:<sceneIndex>:<stepIndex>"
  demoId: string;
  sceneIndex: number;
  stepIndex: number;
  globalStartMs: number;
  globalEndMs: number;
  text: string;              // canonical chunk text (headers + narration + prose)
  embedding: number[];       // 768 floats
  keywords: string[];        // for future BM25; computed at index time
}

export interface IndexJsonDemo {
  demoId: string;
  title: string;
  description: string;
  durationMs: number;
}

export interface IndexJson {
  schemaVersion: 1;
  companyId: string;
  embeddingModel: "gemini-embedding-001";
  embeddingDims: 768;
  createdAt: string;         // ISO 8601
  etag: string;              // sha256 of source artifacts
  demos: IndexJsonDemo[];
  chunks: Chunk[];
}

export interface CompanyConfig {
  companyId: string;
  name: string;
  brandColor?: string;
  locale: string;            // BCP-47, default "en"
  allowedOrigins: string[];
  suggestedQuestions: string[];
  createdAt: string;
}

// --- Chat API contract ---

export interface ChatHistoryTurn { role: "user" | "assistant"; content: string }

export interface ChatRequest {
  companyId: string;
  message: string;
  history: ChatHistoryTurn[];
  locale?: string;
}

export interface TextPart { kind: "text"; text: string }

export interface VideoPart {
  kind: "video";
  stepId: string;
  demoId: string;
  startMs: number;
  endMs: number;
  caption: string;
  mp4Url: string;
}

export type Part = TextPart | VideoPart;

export type ChatResponse =
  | { kind: "answer"; parts: Part[] }
  | { kind: "no_match"; text: string; suggestions?: string[] };

export interface WidgetConfigResponse {
  name: string;
  brandColor?: string;
  locale: string;
  suggestedQuestions: string[];
}
