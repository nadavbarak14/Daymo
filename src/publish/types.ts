export interface ManifestStep {
  stepId: string;
  label: string;
  startMs: number;
}

export interface ManifestDemo {
  demoId: string;
  title: string;
  description: string;
  durationMs: number;
  videoUrl: string;
  posterUrl: string;
  steps: ManifestStep[];
}

export interface HelpManifest {
  version: string;
  videoBaseUrl: string;
  demos: ManifestDemo[];
}

/** Pluggable artifact sink. The default writes to a local directory; an S3/R2
 *  implementation is a drop-in replacement. */
export interface Uploader {
  put(key: string, body: Uint8Array | string, contentType: string): Promise<void>;
}
