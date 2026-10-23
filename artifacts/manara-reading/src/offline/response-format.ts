// WebLLM 0.2.86 routes explicit json_object requests through compileJSONSchema.
// Its WASM binding requires a string even though the public type makes it optional.
// Field completeness and card order remain enforced by validateOfflineReading.
export const LOCAL_RESPONSE_FORMAT = {
  type: "json_object" as const,
  schema: JSON.stringify({ type: "object", additionalProperties: true }),
};
