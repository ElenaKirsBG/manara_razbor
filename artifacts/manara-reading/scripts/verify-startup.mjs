import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transformWithEsbuild } from "vite";

const source = await readFile(new URL("../src/offline/startup-state.ts", import.meta.url), "utf8");
const { code } = await transformWithEsbuild(source, "startup-state.ts", { format: "esm", target: "es2022" });
const state = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const ids = ["Qwen2.5-1.5B-Instruct-q4f16_1-MLC", "Qwen2.5-3B-Instruct-q4f16_1-MLC"];
const values = new Map();
const store = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
state.saveSelectedModel(store, ids[1]);
assert.equal(state.readSelectedModel(store, ids, ids[0]), ids[1]);
state.saveSelectedModel(store, "unknown");
assert.equal(state.readSelectedModel(store, ids, ids[0]), ids[0]);
const running = {
  modelId: ids[1], phase: "init", stage: "model", status: "running",
  startedAt: 100, updatedAt: 200, contextTokens: 8192,
};
state.saveStartupAttempt(store, { ...running, question: "PRIVATE-QUESTION-SENTINEL", cardIds: ["PRIVATE-CARD"], answer: "PRIVATE-ANSWER" });
assert.deepEqual(state.readStartupAttempt(store, ids), running);
const saved = store.getItem(state.STARTUP_ATTEMPT_KEY);
assert(!saved.includes("PRIVATE"));
assert(!saved.includes("question"));
state.saveStartupAttempt(store, { ...running, status: "interrupted" });
assert.equal(state.readStartupAttempt(store, ids).status, "interrupted");
values.set(state.STARTUP_ATTEMPT_KEY, "{broken");
assert.equal(state.readStartupAttempt(store, ids), null);
for (const invalid of [{...running,modelId:"unknown"},{...running,stage:"unknown"},{...running,contextTokens:-1}]) {
  values.set(state.STARTUP_ATTEMPT_KEY, JSON.stringify(invalid));
  assert.equal(state.readStartupAttempt(store, ids), null);
}
const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
assert.equal(state.readSelectedModel(blocked, ids, ids[0]), ids[0]);
assert.equal(state.readStartupAttempt(blocked, ids), null);
assert.doesNotThrow(() => state.saveStartupAttempt(blocked, running));
for (const [input, expected] of [[0,8192],[4096,8192],[4097,9216],[12288,16384],[12289,17408],[28672,32768]]) {
  const actual = state.contextForInput(input,4096,32768);
  assert.equal(actual, expected);
  assert(actual >= input+4096);
}
for (const input of [28673,NaN,-1,1.5]) assert.throws(() => state.contextForInput(input,4096,32768));
for (let input = 0; input <= 28672; input += 29) {
  const actual = state.contextForInput(input,4096,32768);
  assert(actual >= input + 4096 && actual <= 32768);
  if (input + 4096 > 8192) assert(actual - input - 4096 < 1024);
}
const worker = await readFile(new URL("../src/offline/llm.worker.ts", import.meta.url),"utf8");
assert(worker.includes('await import("@mlc-ai/web-llm")'));
assert(!worker.includes('import { CreateMLCEngine'));
assert(worker.includes("context_window_size: contextTokens"));
assert(worker.includes("countTokensInIsolatedWorker"));
assert(!worker.includes('import("@mlc-ai/web-tokenizers")'));
assert(state.isStartupStage("response"));
const counterWorker = await readFile(new URL("../src/offline/token-count.worker.ts", import.meta.url), "utf8");
assert(counterWorker.includes("finally { tokenizer.dispose(); }"));
assert(counterWorker.includes("self.close()"));
console.info("Startup safety verified: model selection survives reload; technical-only journal; blocked/corrupt storage safe; context rounded to 1k retains full input and 4096-token answer reserve; isolated temporary tokenizer. No real iPhone/GPU inference evaluated.");
