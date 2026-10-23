import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transformWithEsbuild } from "vite";
const source = await readFile(new URL("../src/lib/reading-draft.ts", import.meta.url), "utf8");
const { code } = await transformWithEsbuild(source, "reading-draft.ts", { format: "esm", target: "es2022" });
const api = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const values = new Map();
const store = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
};
const ids = ["a","b","c","d","e","f","g"];
const draft = {
  question: "Тестовый вопрос для восстановления", gender: "woman",
  mode: "detailed", selectionMode: "random", randomQuantity: 7, cardIds: [...ids].reverse(),
};
assert.equal(api.readDraftEnabled(store), true);
assert.equal(api.loadReadingDraft(store, ids), null);
assert.equal(api.saveReadingDraft(store, {...draft, answer:"DO-NOT-SAVE-ANSWER",secret:"EXTRA-FIELD"}), true);
assert.deepEqual(api.loadReadingDraft(store, ids), draft);
assert(!store.getItem(api.DRAFT_KEY).includes("DO-NOT-SAVE"));
assert(!store.getItem(api.DRAFT_KEY).includes("EXTRA-FIELD"));
assert.equal(api.loadReadingDraft(store, ids.slice(1)), null);
for (const update of [
  {cardIds:["a","a"]}, {cardIds:["a",null]}, {question:"x".repeat(3001)},
  {randomQuantity:13}, {randomQuantity:1.5}, {gender:"unknown"}, {mode:"unknown"},
]) assert.equal(api.saveReadingDraft(store,{...draft,...update}), false);
assert.equal(api.clearReadingDraft(store), true);
assert.equal(api.loadReadingDraft(store, ids), null);
assert.equal(api.saveReadingDraft(store, draft), true);
assert.equal(api.writeDraftEnabled(store, false), true);
assert.equal(store.getItem(api.DRAFT_KEY), null);
assert.equal(api.readDraftEnabled(store), false);
assert.equal(api.saveReadingDraft(store, draft), false);
assert.equal(api.loadReadingDraft(store, ids), null);
assert.equal(api.writeDraftEnabled(store, true), true);
assert.equal(api.saveReadingDraft(store, draft), true);
assert.deepEqual(api.loadReadingDraft(store, ids).cardIds, draft.cardIds);
assert.equal(api.saveReadingDraft(store, {...draft,question:"",cardIds:[]}),true);
assert.equal(store.getItem(api.DRAFT_KEY),null);
for (const invalid of ["{broken","null",JSON.stringify({...draft,version:2}),JSON.stringify({...draft,version:1,cardIds:["missing"]})]) {
 store.setItem(api.DRAFT_KEY,invalid);
 assert.equal(api.loadReadingDraft(store,ids),null);
}
const blocked = {
 getItem(){throw Error("blocked");}, setItem(){throw Error("blocked");}, removeItem(){throw Error("blocked");},
};
assert.equal(api.loadReadingDraft(blocked,ids),null);
assert.equal(api.saveReadingDraft(blocked,draft),false);
assert.equal(api.clearReadingDraft(blocked),false);
assert.equal(api.writeDraftEnabled(blocked,false),false);
assert.equal(api.saveReadingDraft(undefined,draft),false);
console.info("Private local draft verified: question + exact seven-card order restored; generated answers/extra fields excluded; corrupt/invalid/blocked storage safe; deletion and durable opt-out prevent recreation.");
