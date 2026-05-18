export interface PublishBeginRequest {
  companyId: string;
  name?: string;
  brandColor?: string;
  locale?: string;
  allowedOrigins?: string[];
  files: Array<{
    relPath: string;         // e.g. "demos/loomly-tour/output.mp4"
    sizeBytes: number;
    contentType: string;
  }>;
}

export interface PublishBeginResponse {
  uploadId: string;          // opaque, used by finalize
  uploads: Array<{
    relPath: string;
    /** Vercel Blob client-direct-upload token (one per file). */
    clientToken: string;
    /** Resolved blob URL the file will land at. */
    targetBlobUrl: string;
  }>;
  /** Token for uploading index.json (last). */
  indexUpload: { clientToken: string; targetBlobUrl: string };
}

export interface PublishFinalizeRequest {
  uploadId: string;
  /** Sizes/sha256s the server validates against what landed in Blob. */
  uploaded: Array<{ relPath: string; sizeBytes: number; sha256?: string }>;
  indexUploaded: { sizeBytes: number; sha256?: string };
}

export interface PublishFinalizeResponse {
  hostedUrl: string;
  uploadedAt: string;
}

export interface PublishHealthResponse {
  ok: boolean;
  endpoint: string;
}
