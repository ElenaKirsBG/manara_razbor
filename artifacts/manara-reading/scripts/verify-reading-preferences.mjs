import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transformWithEsbuild } from "vite";

const source = await readFile(new URL("../src/lib/reading-preferences.ts", import.meta.url), "utf8");
const { code } = await transformWithEsbuild(source, "reading-preferences.ts", { format: "esm", target: "es2022" });
const preferences = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const { READING_PREFERENCES_KEY: key, DEFAULT_READING_PREFERENCES: defaults } = preferences;
const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
assert.deepEqual(preferences.readReadingPreferences(storage), defaults);
assert.equal(defaults.size, "large");
for (const size of preferences.TEXT_SIZES) for (const color of preferences.TEXT_COLORS) {
  const selected = { size: size.id, color: color.id };
  assert.equal(preferences.saveReadingPreferences(storage, { ...selected, question: "PRIVATE-QUESTION", cardIds: ["PRIVATE-CARD"] }), true);
  assert.deepEqual(preferences.readReadingPreferences(storage), selected);
  assert(!storage.getItem(key).includes("PRIVATE"));
}
for (const invalid of ['{broken', 'null', '{"size":"tiny","color":"white"}']) {
  storage.setItem(key, invalid);
  assert.deepEqual(preferences.readReadingPreferences(storage), defaults);
}
const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
assert.deepEqual(preferences.readReadingPreferences(blocked), defaults);
assert.equal(preferences.saveReadingPreferences(blocked, defaults), false);
assert.equal(preferences.saveReadingPreferences(undefined, defaults), false);
assert.deepEqual(preferences.TEXT_SIZES.map(item => item.pixels), [16, 20, 24]);
console.info("Reading preferences verified: all nine size/color combinations persist; readable 20px default; invalid/blocked storage safe; no private reading data serialized.");
