// Private draft storage is separate from the technical startup journal.
// The user explicitly requested local recovery; never send this record to an API.
export const DRAFT_KEY = "manara-private-draft-v1";
export const DRAFT_ENABLED_KEY = "manara-private-draft-enabled-v1";
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ReadingDraft = {
  question: string;
  gender: "woman" | "man" | "not_specified";
  mode: "detailed" | "psychological";
  selectionMode: "manual" | "random";
  randomQuantity: number;
  cardIds: string[];
};

function validDraft(value: unknown, validIds?: readonly string[]): value is ReadingDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.question === "string" && item.question.length <= 3000 &&
    ["woman", "man", "not_specified"].includes(item.gender as string) &&
    ["detailed", "psychological"].includes(item.mode as string) &&
    ["manual", "random"].includes(item.selectionMode as string) &&
    Number.isInteger(item.randomQuantity) && Number(item.randomQuantity) >= 1 &&
    Number(item.randomQuantity) <= 12 &&
    Array.isArray(item.cardIds) && item.cardIds.length <= 12 &&
    item.cardIds.every(id => typeof id === "string" && id.length > 0 &&
      (!validIds || validIds.includes(id))) &&
    new Set(item.cardIds).size === item.cardIds.length;
}

export function readDraftEnabled(storage: DraftStorage | undefined): boolean {
  try { return storage?.getItem(DRAFT_ENABLED_KEY) !== "false"; }
  catch { return true; }
}

export function writeDraftEnabled(storage: DraftStorage | undefined, enabled: boolean): boolean {
  try {
    if (!storage) return false;
    if (!enabled) storage.removeItem(DRAFT_KEY);
    storage.setItem(DRAFT_ENABLED_KEY, String(enabled));
    return true;
  } catch { return false; }
}

export function loadReadingDraft(storage: DraftStorage | undefined, validCardIds: readonly string[]): ReadingDraft | null {
  try {
    if (!storage || !readDraftEnabled(storage)) return null;
    const value = JSON.parse(storage.getItem(DRAFT_KEY) ?? "null");
    if (value?.version !== 1 || !validDraft(value, validCardIds)) return null;
    return {
      question: value.question, gender: value.gender, mode: value.mode,
      selectionMode: value.selectionMode, randomQuantity: value.randomQuantity,
      cardIds: [...value.cardIds],
    };
  } catch { return null; }
}

export function saveReadingDraft(storage: DraftStorage | undefined, draft: ReadingDraft): boolean {
  try {
    if (!storage || !readDraftEnabled(storage) || !validDraft(draft)) return false;
    if (!draft.question && draft.cardIds.length === 0) {
      storage.removeItem(DRAFT_KEY);
      return true;
    }
    storage.setItem(DRAFT_KEY, JSON.stringify({
      version: 1, question: draft.question, gender: draft.gender, mode: draft.mode,
      selectionMode: draft.selectionMode, randomQuantity: draft.randomQuantity,
      cardIds: [...draft.cardIds],
    }));
    return true;
  } catch { return false; }
}

export function clearReadingDraft(storage: DraftStorage | undefined): boolean {
  try {
    if (!storage) return false;
    storage.removeItem(DRAFT_KEY);
    return true;
  } catch { return false; }
}
