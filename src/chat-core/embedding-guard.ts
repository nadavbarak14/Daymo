export function assertEmbeddingModel(indexModel: string, configuredModel: string): void {
  if (indexModel !== configuredModel) {
    throw new Error(
      `embedding model mismatch: the index was built with "${indexModel}" but the route is ` +
        `configured with "${configuredModel}". Query and index embeddings must use the same model, ` +
        `or retrieval is silently wrong. Re-publish the index or fix the route's embeddingModelId.`,
    );
  }
}
