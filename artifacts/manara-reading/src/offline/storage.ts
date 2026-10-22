import { LOCAL_MODEL_CACHE, MODEL_CACHE_MARKER, tokenizerUrl } from "./models";

export function readFlag(key: string) {
  try { return localStorage.getItem(key) === "yes"; } catch { return false; }
}

export function writeFlag(key: string, value: boolean) {
  try {
    if (value) localStorage.setItem(key, "yes");
    else localStorage.removeItem(key);
  } catch { /* Private browsing may block persistence; never claim it succeeded. */ }
}

export async function modelWasCached(modelId: string) {
  if (!readFlag(MODEL_CACHE_MARKER + modelId)) return false;
  const { hasModelInCache, prebuiltAppConfig } = await import("@mlc-ai/web-llm");
  return Boolean(
    await hasModelInCache(modelId, { ...prebuiltAppConfig, cacheBackend: "indexeddb" }) &&
    await (await caches.open(LOCAL_MODEL_CACHE)).match(tokenizerUrl(modelId)),
  );
}

export async function appWasCached() {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller || !("caches" in window)) return false;
  const base = new URL(import.meta.env.BASE_URL, location.origin);
  const home = await caches.match(new URL("index.html", base), { ignoreSearch: true });
  if (!home) return false;
  const { getManaraCardsWithImages } = await import("@/generated/manara-core");
  const cards = getManaraCardsWithImages();
  const matches = await Promise.all(cards.map((card) =>
    caches.match(new URL(`cards/${card.id}.jpg`, base), { ignoreSearch: true })));
  return cards.length === 78 && matches.every(Boolean);
}
