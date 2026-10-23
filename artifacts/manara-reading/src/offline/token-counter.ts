type CounterOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  createWorker?: () => Worker;
};

// A short-lived worker releases the tokenizer's entire WASM heap. Calling
// tokenizer.dispose() alone does not release a module's linear memory.
export function countTokensInIsolatedWorker(buffer: ArrayBuffer, text: string, options: CounterOptions = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("Разбор остановлен."));
      return;
    }
    const worker = options.createWorker?.() ??
      new Worker(new URL("./token-count.worker.ts", import.meta.url), { type: "module" });
    let settled = false;
    const finish = (error?: Error, count?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(count!);
    };
    const abort = () => finish(new Error("Разбор остановлен."));
    const timer = setTimeout(() => finish(new Error("Подсчёт контекста не завершился вовремя. Вопрос и карты не сокращались.")), options.timeoutMs ?? 120_000);
    worker.onmessage = ({ data }: MessageEvent) => {
      if (Number.isSafeInteger(data?.count) && data.count >= 0) finish(undefined, data.count);
      else finish(new Error(data?.error || "Не удалось проверить размер полного расклада."));
    };
    worker.onerror = () => finish(new Error("Браузер прервал подсчёт контекста. Вопрос и карты не сокращались."));
    worker.onmessageerror = () => finish(new Error("Не удалось получить размер полного расклада."));
    options.signal?.addEventListener("abort", abort, { once: true });
    try { worker.postMessage({ buffer, text }, [buffer]); }
    catch { finish(new Error("Не удалось передать полный расклад токенизатору.")); }
  });
}
