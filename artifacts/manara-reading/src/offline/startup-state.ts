export const STARTUP_ATTEMPT_KEY = "manara-startup-attempt-v1";
export const MODEL_SELECTION_KEY = "manara-selected-model-v1";
export const START_CONTEXT_TOKENS = 8192;

export const STARTUP_STAGES = {
  storage: "Проверка свободного места",
  worker: "Запуск отдельного процесса ИИ",
  tokenizer: "Сохранение токенизатора",
  runtime: "Загрузка библиотеки локального ИИ",
  model: "Загрузка модели и выделение памяти GPU",
  context: "Подсчёт полного контекста расклада",
  resize: "Расширение памяти под полный расклад",
  response: "Подготовка формата ответа и обработка полного расклада",
  generate: "Составление ответа",
  ready: "Модель запущена",
  complete: "Разбор завершён",
} as const;
export type StartupStage = keyof typeof STARTUP_STAGES;
export type AttemptStatus = "running" | "interrupted" | "complete" | "error" | "cancelled";
export type StartupAttempt = {
  modelId: string;
  phase: "init" | "generate";
  stage: StartupStage;
  status: AttemptStatus;
  startedAt: number;
  updatedAt: number;
  contextTokens: number;
};
type Store = Pick<Storage, "getItem" | "setItem"> | undefined;

export function browserStore(): Store {
  try { return window.localStorage; } catch { return undefined; }
}
export function isStartupStage(stage: unknown): stage is StartupStage {
  return typeof stage === "string" && Object.hasOwn(STARTUP_STAGES, stage);
}
export function readSelectedModel(store: Store, allowed: readonly string[], fallback: string) {
  try {
    const id = store?.getItem(MODEL_SELECTION_KEY);
    return id && allowed.includes(id) ? id : fallback;
  } catch { return fallback; }
}
export function saveSelectedModel(store: Store, id: string) {
  try { store?.setItem(MODEL_SELECTION_KEY, id); } catch { /* Technical settings only. */ }
}
export function readStartupAttempt(store: Store, allowed: readonly string[]): StartupAttempt | null {
  try {
    const raw = store?.getItem(STARTUP_ATTEMPT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || !allowed.includes(value.modelId) || !isStartupStage(value.stage) ||
        !["init", "generate"].includes(value.phase) ||
        !["running", "interrupted", "complete", "error", "cancelled"].includes(value.status) ||
        !Number.isFinite(value.startedAt) || !Number.isFinite(value.updatedAt) ||
        !Number.isSafeInteger(value.contextTokens) || value.contextTokens < 0) return null;
    return value as StartupAttempt;
  } catch { return null; }
}
export function saveStartupAttempt(store: Store, attempt: StartupAttempt) {
  try {
    // Deliberately whitelist fields. Never serialize questions, cards, answers,
    // raw provider errors or worker messages into this diagnostic record.
    store?.setItem(STARTUP_ATTEMPT_KEY, JSON.stringify({
      modelId: attempt.modelId, phase: attempt.phase, stage: attempt.stage,
      status: attempt.status, startedAt: attempt.startedAt,
      updatedAt: attempt.updatedAt, contextTokens: attempt.contextTokens,
    }));
  } catch { /* Some browsers block storage; the operation must still report errors. */ }
}
export function contextForInput(inputTokens: number, outputTokens: number, maximum: number) {
  if (![inputTokens, outputTokens, maximum].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("Не удалось проверить размер контекста модели.");
  }
  const required = inputTokens + outputTokens;
  if (required > maximum) {
    throw new Error(`Весь расклад не помещается в контекст: ${inputTokens} входных токенов и ${outputTokens} для ответа, предел ${maximum}. Карты и источники не обрезались. Уменьшите расклад или сократите вопрос.`);
  }
  // Avoid almost doubling GPU KV-cache allocation just above 8k/16k.
  // Keep the complete input and the same output reserve, rounded to 1k pages.
  return Math.min(maximum, Math.max(START_CONTEXT_TOKENS, Math.ceil(required / 1024) * 1024));
}
