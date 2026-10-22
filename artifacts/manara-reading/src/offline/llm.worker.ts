import { CreateMLCEngine, prebuiltAppConfig, type MLCEngine } from "@mlc-ai/web-llm";
import { Tokenizer } from "@mlc-ai/web-tokenizers";
import {
  LOCAL_CONTEXT_TOKENS,
  LOCAL_OUTPUT_TOKENS,
  LOCAL_MODEL_CACHE,
  getLocalModel,
  tokenizerUrl,
} from "./models";

let engine: MLCEngine | null = null;
let tokenizer: Tokenizer | null = null;
let cancelled = false;

function send(id: number, type: string, fields: Record<string, unknown> = {}) {
  self.postMessage({ id, type, ...fields });
}

async function loadTokenizer(modelId: string) {
  const url = tokenizerUrl(modelId);
  const cache = await caches.open(LOCAL_MODEL_CACHE);
  let response = await cache.match(url);
  if (!response) {
    response = await fetch(url);
    if (!response.ok) throw new Error("Не удалось скачать токенизатор модели.");
    await cache.put(url, response.clone());
  }
  return Tokenizer.fromJSON(await response.arrayBuffer());
}

self.onmessage = async (event: MessageEvent) => {
  const { id, type, modelId, systemPrompt, userPrompt } = event.data;
  if (type === "cancel") {
    cancelled = true;
    engine?.interruptGenerate();
    return;
  }
  try {
    if (type === "init") {
      getLocalModel(modelId);
      await engine?.unload();
      tokenizer?.dispose();
      engine = null;
      tokenizer = await loadTokenizer(modelId);
      engine = await CreateMLCEngine(modelId, {
        appConfig: { ...prebuiltAppConfig, cacheBackend: "indexeddb" },
        initProgressCallback: (report) => send(id, "progress", {
          progress: report.progress,
          text: report.text,
        }),
      }, {
        context_window_size: LOCAL_CONTEXT_TOKENS,
      });
      send(id, "done");
      return;
    }
    if (type !== "generate" || !engine || !tokenizer) {
      throw new Error("Сначала загрузите и запустите локальную модель.");
    }
    cancelled = false;
    // Use the model's real tokenizer. Reserve an additional 512 tokens for
    // Qwen's message framing; never truncate cards, the question, or sources.
    const inputTokens = tokenizer.encode(systemPrompt + userPrompt).length + 512;
    if (inputTokens + LOCAL_OUTPUT_TOKENS > LOCAL_CONTEXT_TOKENS) {
      throw new Error(`Весь расклад не помещается в память контекста: ${inputTokens} входных токенов и ${LOCAL_OUTPUT_TOKENS} для ответа, предел ${LOCAL_CONTEXT_TOKENS}. Карты и источники не обрезались. Уменьшите расклад или сократите вопрос.`);
    }
    send(id, "progress", { progress: 0, text: `Контекст проверен: ${inputTokens} токенов. ИИ читает сочетание карт…` });
    await engine.resetChat();
    let content = "";
    let finished = false;
    const stream = await engine.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.35,
      max_tokens: LOCAL_OUTPUT_TOKENS,
      response_format: { type: "json_object" },
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
      send(id, "progress", { progress: 0, text: `Локальный ИИ составляет разбор · ${content.length} знаков. Держите приложение открытым.` });
    }
    if (cancelled || !finished || !content) {
      throw new Error("Локальная модель не завершила ответ. Вопрос и карты остались в форме.");
    }
    send(id, "done", { content });
  } catch (error) {
    send(id, "error", { message: error instanceof Error ? error.message : "Ошибка локальной модели." });
  }
};
