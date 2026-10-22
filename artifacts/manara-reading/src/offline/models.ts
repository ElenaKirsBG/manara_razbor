export const LOCAL_CONTEXT_TOKENS = 32768;
export const LOCAL_OUTPUT_TOKENS = 4096;
export const LOCAL_MODEL_CACHE = "manara-tokenizers-v1";
export const MODEL_CACHE_MARKER = "manara-model-complete-v1:";
export const OFFLINE_VERIFIED_MARKER = "manara-offline-verified-v1:";

export const LOCAL_MODELS = [
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    label: "Компактная · Qwen 1.5B",
    downloadLabel: "Около 1 ГБ загрузки; более слабые и короткие трактовки",
    expectedBytes: 1_100_000_000,
  },
  {
    id: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    label: "Более крупная · Qwen 3B",
    downloadLabel: "Около 2 ГБ загрузки; выше риск нехватки памяти на iPhone",
    expectedBytes: 2_100_000_000,
  },
] as const;

export function getLocalModel(id: string) {
  const model = LOCAL_MODELS.find((item) => item.id === id);
  if (!model) throw new Error("Выбрана неизвестная локальная модель.");
  return model;
}

export function tokenizerUrl(modelId: string) {
  getLocalModel(modelId);
  return `https://huggingface.co/mlc-ai/${modelId}/resolve/main/tokenizer.json`;
}
