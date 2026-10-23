import type { MLCEngine } from "@mlc-ai/web-llm";
import {
  LOCAL_CONTEXT_TOKENS,
  LOCAL_OUTPUT_TOKENS,
  LOCAL_MODEL_CACHE,
  getLocalModel,
  tokenizerUrl,
} from "./models";
import { contextForInput, START_CONTEXT_TOKENS } from "./startup-state";
import { buildLocalResponseFormat } from "./response-format";
import { countTokensInIsolatedWorker } from "./token-counter";

let engine: MLCEngine | null = null;
let cancelled = false;
let activeModelId = "";
let contextTokens = START_CONTEXT_TOKENS;
let currentRequestId = 0;
let resizing = false;
let counterController: AbortController | null = null;

function send(id: number, type: string, fields: Record<string, unknown> = {}) {
  self.postMessage({ id, type, ...fields });
}

async function ensureTokenizerFile(modelId: string) {
  const url = tokenizerUrl(modelId);
  const cache = await caches.open(LOCAL_MODEL_CACHE);
  if (!await cache.match(url)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Не удалось скачать токенизатор модели.");
    await cache.put(url, response);
  }
}

async function countInputTokens(modelId: string, text: string) {
  const response = await (await caches.open(LOCAL_MODEL_CACHE)).match(tokenizerUrl(modelId));
  if (!response) throw new Error("Файл токенизатора удалён из кэша. Подготовьте модель заново.");
  const controller = new AbortController();
  counterController = controller;
  try {
    return await countTokensInIsolatedWorker(await response.arrayBuffer(), text, { signal: controller.signal }) + 512;
  } finally {
    if (counterController === controller) counterController = null;
  }
}

self.onmessage = async (event: MessageEvent) => {
  const { id, type, modelId, systemPrompt, userPrompt, selectedCards } = event.data;
  if (type === "cancel") {
    cancelled = true;
    counterController?.abort();
    engine?.interruptGenerate();
    return;
  }
  try {
    currentRequestId = id;
    if (type === "init") {
      getLocalModel(modelId);
      send(id, "progress", { progress: 0, stage: "worker", text: "Процесс ИИ запущен. Подготовка файлов…" });
      await engine?.unload();
      engine = null;
      send(id, "progress", { progress: 0, stage: "tokenizer", text: "Сохраняем токенизатор. Это ещё не загрузка весов модели…" });
      await ensureTokenizerFile(modelId);
      send(id, "progress", { progress: 0, stage: "runtime", text: "Загружаем библиотеку локального ИИ…" });
      const { CreateMLCEngine, prebuiltAppConfig } = await import("@mlc-ai/web-llm");
      activeModelId = modelId;
      contextTokens = START_CONTEXT_TOKENS;
      resizing = false;
      send(id, "progress", { progress: 0, stage: "model", contextTokens, text: `Загружаем модель. Начальное окно — ${contextTokens} токенов; оно расширится только при необходимости.` });
      engine = await CreateMLCEngine(modelId, {
        appConfig: { ...prebuiltAppConfig, cacheBackend: "indexeddb" },
        initProgressCallback: (report) => send(currentRequestId, "progress", {
          progress: report.progress,
          text: report.text,
          stage: resizing ? "resize" : "model",
          contextTokens,
        }),
      }, {
        context_window_size: contextTokens,
      });
      send(id, "done", { contextTokens });
      return;
    }
    if (type !== "generate" || !engine) {
      throw new Error("Сначала загрузите и запустите локальную модель.");
    }
    cancelled = false;
    const responseFormat = buildLocalResponseFormat(selectedCards);
    // Use the model's real tokenizer. Reserve an additional 512 tokens for
    // Qwen's message framing; never truncate cards, the question, or sources.
    send(id, "progress", { progress: 0, stage: "context", text: "Токенизатор проверяет весь вопрос, все карты и источники…" });
    // The temporary counter's whole worker is terminated before allocation
    // or grammar compilation, not merely its tokenizer object disposed.
    const inputTokens = await countInputTokens(activeModelId, systemPrompt + userPrompt);
    if (cancelled) throw new Error("Разбор остановлен.");
    const needed = contextForInput(inputTokens, LOCAL_OUTPUT_TOKENS, LOCAL_CONTEXT_TOKENS);
    if (needed > contextTokens) {
      contextTokens = needed;
      resizing = true;
      send(id, "progress", { progress: 0, stage: "resize", contextTokens, text: `Для полного расклада нужно окно ${needed} токенов. Расширяем память без обрезания источников…` });
      try { await engine.reload(activeModelId, { context_window_size: needed }); }
      finally { resizing = false; }
    }
    if (cancelled) throw new Error("Разбор остановлен.");
    await engine.resetChat();
    send(id, "progress", { progress: 0, stage: "response", contextTokens, text: `Контекст проверен: ${inputTokens} токенов. Подготавливаем формат ответа и обрабатываем полный расклад…` });
    let content = "";
    let finished = false;
    let lastProgressAt = 0;
    const stream = await engine.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.35,
      max_tokens: LOCAL_OUTPUT_TOKENS,
      response_format: responseFormat,
      stream: true,
    });
    for await (const chunk of stream) {
      if (cancelled) throw new Error("Разбор остановлен. Вопрос и карты остались в форме.");
      content += chunk.choices[0]?.delta?.content ?? "";
      const reason = chunk.choices[0]?.finish_reason;
      if (reason === "length") {
        throw new Error("Модель не завершила разбор в пределах длины ответа. Неполный результат не показан; вопрос и карты остались в форме.");
      }
      if (reason === "stop") finished = true;
      // Do not rerender the entire card catalogue for every generated token.
      const now = Date.now();
      if (content && (lastProgressAt === 0 || now - lastProgressAt >= 750 || finished)) {
        send(id, "progress", { progress: 0, stage: "generate", text: `Локальный ИИ составляет разбор · ${content.length} знаков. Держите приложение открытым.` });
        lastProgressAt = now;
      }
    }
    if (cancelled || !finished || !content) {
      throw new Error("Локальная модель не завершила ответ. Вопрос и карты остались в форме.");
    }
    send(id, "done", { content });
  } catch (error) {
    send(id, "error", { message: error instanceof Error ? error.message : "Ошибка локальной модели." });
  }
};
