export const READING_PREFERENCES_KEY = "manara-reading-preferences-v1";
export const TEXT_SIZES = [
  { id: "normal", label: "Обычный", pixels: 16 },
  { id: "large", label: "Крупный", pixels: 20 },
  { id: "extra", label: "Очень крупный", pixels: 24 },
] as const;
export const TEXT_COLORS = [
  { id: "black", label: "Чёрный", hsl: "0 0% 9%" },
  { id: "brown", label: "Тёмно-коричневый", hsl: "22 48% 20%" },
  { id: "blue", label: "Тёмно-синий", hsl: "216 65% 24%" },
] as const;
export type ReadingPreferences = {
  size: typeof TEXT_SIZES[number]["id"];
  color: typeof TEXT_COLORS[number]["id"];
};
export const DEFAULT_READING_PREFERENCES: ReadingPreferences = { size: "large", color: "black" };
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function readReadingPreferences(storage?: PreferenceStorage): ReadingPreferences {
  try {
    const value = JSON.parse(storage?.getItem(READING_PREFERENCES_KEY) ?? "null");
    return {
      size: TEXT_SIZES.some(item => item.id === value?.size) ? value.size : DEFAULT_READING_PREFERENCES.size,
      color: TEXT_COLORS.some(item => item.id === value?.color) ? value.color : DEFAULT_READING_PREFERENCES.color,
    };
  } catch { return { ...DEFAULT_READING_PREFERENCES }; }
}
export function saveReadingPreferences(storage: PreferenceStorage | undefined, value: ReadingPreferences): boolean {
  try {
    if (!storage) return false;
    // Store only display preferences, never the question, cards or generated answer.
    storage.setItem(READING_PREFERENCES_KEY, JSON.stringify({ size: value.size, color: value.color }));
    return true;
  } catch { return false; }
}
