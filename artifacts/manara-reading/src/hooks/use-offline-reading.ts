import { useCallback, useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import type { ManaraCard, ManaraReading } from "@workspace/api-client-react";
import {
  buildManaraPrompts,
  getManaraCardsWithImages,
  OFFLINE_CORE_REVISION,
  validateOfflineReading,
} from "@/generated/manara-core";
import {
  LOCAL_MODELS,
  MODEL_CACHE_MARKER,
  OFFLINE_VERIFIED_MARKER,
  LOCAL_MODEL_CACHE,
  getLocalModel,
  tokenizerUrl,
} from "@/offline/models";
import { appWasCached, modelWasCached, readFlag, writeFlag } from "@/offline/storage";

type ReadingInput = {
  question: string;
  querentGender: "woman" | "man" | "not_specified";
  mode: "detailed" | "psychological";
  cardIds: string[];
};
type Phase = "checking" | "unsupported" | "idle" | "loading" | "ready" | "generating" | "error";
type WorkerResult = { content?: string };
type Pending = { resolve: (value: WorkerResult) => void; reject: (error: Error) => void; timer: number };
const initialModel = LOCAL_MODELS[0].id;
const cards: ManaraCard[] = getManaraCardsWithImages().map((card) => ({
  ...card,
  imageUrl: `${import.meta.env.BASE_URL}cards/${card.id}.jpg`,
}));
const errorText = (error: unknown) => error instanceof Error ? error.message : "Не удалось запустить локальный ИИ.";
const verifiedKey = (id: string) => `${OFFLINE_VERIFIED_MARKER}${OFFLINE_CORE_REVISION}:${id}`;

export function useOfflineReading() {
  const [modelId, setModelState] = useState<string>(initialModel);
  const modelRef = useRef<string>(initialModel);
  const [phase, setPhase] = useState<Phase>("checking");
  const [isSupported, setSupported] = useState(false);
  const [capabilityMessage, setCapabilityMessage] = useState("Проверяем поддержку локального ИИ…");
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [error, setError] = useState("");
  const [isReady, setReady] = useState(false);
  const [isCached, setCached] = useState(false);
  const [appCached, setAppCached] = useState(false);
  const [offlineVerified, setOfflineVerified] = useState(false);
  const [isOnline, setOnline] = useState(navigator.onLine);
  const [isStandalone] = useState(() => matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<number, Pending>());
  const serialRef = useRef(0);
  const operationRef = useRef<"init" | "generate" | null>(null);
  useRegisterSW({
    immediate: true,
    onOfflineReady: () => { void appWasCached().then(setAppCached); },
    onRegisterError: () => setAppCached(false),
    // No automatic reload: a worker update must not discard the active question.
  });

  const refreshStorage = useCallback(async () => {
    const id = modelRef.current;
    const [app, model] = await Promise.all([
      appWasCached().catch(() => false),
      modelWasCached(id).catch(() => false),
    ]);
    setAppCached(app);
    if (id === modelRef.current) {
      setCached(model);
      setOfflineVerified(model && readFlag(verifiedKey(id)));
    }
  }, []);

  const stopWorker = useCallback((message = "Операция остановлена. Вопрос и карты остались в форме.") => {
    workerRef.current?.terminate();
    workerRef.current = null;
    for (const pending of pendingRef.current.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    pendingRef.current.clear();
    setReady(false);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (!isSecureContext) throw new Error("Для локального ИИ нужен HTTPS или localhost. Откройте опубликованное приложение через Safari.");
        const gpu = (navigator as Navigator & {
          gpu?: { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> };
        }).gpu;
        if (!gpu) throw new Error("WebGPU недоступен. На iPhone нужна совместимая версия Safari/iOS 26 и обычный режим, не приватная вкладка.");
        const adapter = await gpu.requestAdapter();
        if (!adapter) throw new Error("Браузер не предоставил доступ к GPU. Закройте тяжёлые вкладки и откройте приложение снова.");
        if (!adapter.features.has("shader-f16")) {
          throw new Error("В этом браузере недоступен GPU-формат shader-f16, необходимый выбранным компактным моделям.");
        }
        if (alive) {
          setSupported(true);
          setPhase("idle");
          setCapabilityMessage("WebGPU доступен. Это проверка возможностей, не подтверждение качества или устойчивости модели на iPhone.");
        }
      } catch (reason) {
        if (alive) {
          setSupported(false);
          setPhase("unsupported");
          setCapabilityMessage(errorText(reason));
        }
      }
    })();
    void refreshStorage();
    const refresh = () => { setOnline(navigator.onLine); void refreshStorage(); };
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    navigator.serviceWorker?.addEventListener("controllerchange", refresh);
    return () => {
      alive = false;
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      navigator.serviceWorker?.removeEventListener("controllerchange", refresh);
      stopWorker();
    };
  }, [refreshStorage, stopWorker]);

  const request = useCallback((fields: Record<string, unknown>) => {
    const worker = workerRef.current;
    if (!worker) return Promise.reject(new Error("Локальная модель не запущена."));
    const id = ++serialRef.current;
    return new Promise<WorkerResult>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        stopWorker("Локальная модель не ответила вовремя. Возможно, iOS приостановила вкладку или не хватило памяти. Вопрос и карты остались в форме.");
      }, fields.type === "init" ? 900_000 : 600_000);
      pendingRef.current.set(id, { resolve, reject, timer });
      worker.postMessage({ id, ...fields });
    });
  }, [stopWorker]);

  const prepare = useCallback(async () => {
    if (operationRef.current || !isSupported) return;
    operationRef.current = "init";
    setError("");
    setProgress(0);
    setProgressText("Подготавливаем файлы модели. Первой загрузке нужен интернет.");
    setPhase("loading");
    stopWorker();
    try {
      const model = getLocalModel(modelRef.current);
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.quota && !isCached &&
          estimate.quota - (estimate.usage ?? 0) < model.expectedBytes) {
        throw new Error("Браузер сообщает о недостатке места для модели. Освободите место или выберите компактную модель.");
      }
      await navigator.storage?.persist?.().catch(() => false);
      const worker = new Worker(new URL("../offline/llm.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent) => {
        const message = event.data;
        const pending = pendingRef.current.get(message.id);
        if (!pending) return;
        if (message.type === "progress") {
          setProgress(Math.max(0, Math.min(1, message.progress ?? 0)));
          setProgressText(message.text ?? "");
          return;
        }
        clearTimeout(pending.timer);
        pendingRef.current.delete(message.id);
        if (message.type === "error") pending.reject(new Error(message.message));
        else pending.resolve(message);
      };
      worker.onerror = () => {
        const message = "Локальный ИИ остановлен браузером. Возможна нехватка памяти или сбой GPU; попробуйте компактную модель. Вопрос и карты не удалены.";
        stopWorker(message);
        setError(message);
        setPhase("error");
      };
      await request({ type: "init", modelId: model.id });
      writeFlag(MODEL_CACHE_MARKER + model.id, true);
      setReady(true);
      setPhase("ready");
      setProgress(1);
      setProgressText("Модель запущена на этом устройстве. Качество ответов нужно проверять отдельно.");
      await refreshStorage();
    } catch (reason) {
      stopWorker();
      setError(errorText(reason));
      setPhase("error");
    } finally {
      operationRef.current = null;
    }
  }, [isSupported, isCached, refreshStorage, request, stopWorker]);

  const generate = useCallback(async (input: ReadingInput): Promise<ManaraReading> => {
    if (operationRef.current) throw new Error("Дождитесь завершения текущей операции.");
    if (!isReady) throw new Error("Сначала запустите локальную модель.");
    operationRef.current = "generate";
    setPhase("generating");
    setError("");
    setProgressText("Проверяем весь контекст расклада без обрезания источников…");
    try {
      const { systemPrompt, userPrompt } = buildManaraPrompts(input);
      const result = await request({ type: "generate", systemPrompt, userPrompt });
      const reading = validateOfflineReading(JSON.parse(result.content ?? ""), input.cardIds);
      if (!navigator.onLine && await appWasCached()) {
        writeFlag(verifiedKey(modelRef.current), true);
        setOfflineVerified(readFlag(verifiedKey(modelRef.current)));
      }
      setPhase("ready");
      setProgressText("Локальный разбор завершён.");
      return reading;
    } catch (reason) {
      const message = errorText(reason);
      setError(message);
      setPhase("error");
      throw new Error(message);
    } finally {
      operationRef.current = null;
    }
  }, [isReady, request]);

  const setModelId = useCallback((id: string) => {
    if (operationRef.current || id === modelRef.current) return;
    getLocalModel(id);
    stopWorker();
    modelRef.current = id;
    setModelState(id);
    setCached(false);
    setError("");
    setPhase(isSupported ? "idle" : "unsupported");
    void refreshStorage();
  }, [isSupported, refreshStorage, stopWorker]);

  const cancel = useCallback(() => {
    if (operationRef.current === "init") stopWorker("Загрузка остановлена. Уже скачанные файлы могут остаться в кеше.");
    else if (operationRef.current === "generate") workerRef.current?.postMessage({ type: "cancel" });
  }, [stopWorker]);

  const removeModel = useCallback(async () => {
    if (operationRef.current) return;
    stopWorker();
    try {
      const id = modelRef.current;
      const { deleteModelAllInfoInCache, prebuiltAppConfig } = await import("@mlc-ai/web-llm");
      await deleteModelAllInfoInCache(id, { ...prebuiltAppConfig, cacheBackend: "indexeddb" });
      await (await caches.open(LOCAL_MODEL_CACHE)).delete(tokenizerUrl(id));
      writeFlag(MODEL_CACHE_MARKER + id, false);
      writeFlag(verifiedKey(id), false);
      setPhase(isSupported ? "idle" : "unsupported");
      setError("");
      await refreshStorage();
    } catch (reason) { setError(errorText(reason)); }
  }, [isSupported, refreshStorage, stopWorker]);

  return {
    cards, phase, capabilityMessage, isSupported, progress, progressText, error,
    isPending: phase === "generating", busy: phase === "loading" || phase === "generating",
    isReady, isCached, appCached, offlineVerified, isOnline, isStandalone,
    models: LOCAL_MODELS, modelId, setModelId, prepare, generate, cancel, removeModel, refreshStorage,
  };
}
