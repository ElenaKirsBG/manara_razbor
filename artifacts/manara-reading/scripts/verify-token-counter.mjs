import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transformWithEsbuild } from "vite";

const source = await readFile(new URL("../src/offline/token-counter.ts", import.meta.url), "utf8");
const { code } = await transformWithEsbuild(source, "token-counter.ts", { format: "esm", target: "es2022" });
const { countTokensInIsolatedWorker: count } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const completeText = "Вопрос целиком.\nСистема.\nВсе семь карт и все источники: " + "Манара · ".repeat(2500);

function fakeWorker(reply) {
  return {
    terminated: 0,
    postMessage(data, transfer) {
      this.sent = data;
      assert.equal(data.text, completeText);
      assert.deepEqual(transfer, [data.buffer]);
      queueMicrotask(() => reply?.(this));
    },
    terminate() { this.terminated++; },
  };
}
const successful = fakeWorker(w => w.onmessage({ data: { count: 12345 } }));
assert.equal(await count(new ArrayBuffer(4), completeText, { createWorker: () => successful }), 12345);
assert.equal(successful.terminated, 1);
for (const data of [{ count: -1 }, { count: 1.5 }, { count: NaN }, { count: Infinity }, { error: "count failed" }, {}]) {
  const worker = fakeWorker(w => w.onmessage({ data }));
  await assert.rejects(count(new ArrayBuffer(4), completeText, { createWorker: () => worker }));
  assert.equal(worker.terminated, 1);
}
for (const kind of ["onerror", "onmessageerror"]) {
  const worker = fakeWorker(w => w[kind]({}));
  await assert.rejects(count(new ArrayBuffer(4), completeText, { createWorker: () => worker }));
  assert.equal(worker.terminated, 1);
}
const timedOut = fakeWorker();
await assert.rejects(count(new ArrayBuffer(4), completeText, { createWorker: () => timedOut, timeoutMs: 5 }), /вовремя/);
assert.equal(timedOut.terminated, 1);
const aborted = fakeWorker();
const controller = new AbortController();
const pending = count(new ArrayBuffer(4), completeText, { createWorker: () => aborted, signal: controller.signal });
controller.abort();
await assert.rejects(pending, /остановлен/);
assert.equal(aborted.terminated, 1);
await assert.rejects(count(new ArrayBuffer(4), completeText, {
  signal: controller.signal, createWorker() { assert.fail("Already cancelled must not create a worker"); },
}), /остановлен/);
const sendFailed = fakeWorker();
sendFailed.postMessage = () => { throw new Error("DataCloneError"); };
await assert.rejects(count(new ArrayBuffer(4), completeText, { createWorker: () => sendFailed }), /передать/);
assert.equal(sendFailed.terminated, 1);

// Execute the actual counter-worker handler with an in-memory tokenizer double.
// This verifies full-text delivery and disposal/close, not real GPU inference.
const workerSource = await readFile(new URL("../src/offline/token-count.worker.ts", import.meta.url), "utf8");
const workerCode = (await transformWithEsbuild(workerSource.replace(/^import .*;\n/, ""), "token-count.worker.ts", { target: "es2022" })).code;
for (const failEncoding of [false, true]) {
  const calls = [];
  const scope = { postMessage(data) { calls.push(["message", data]); }, close() { calls.push(["close"]); } };
  const tokenizer = {
    encode(text) { assert.equal(text, completeText); if (failEncoding) throw new Error("encode failed"); return [1, 2, 3]; },
    dispose() { calls.push(["dispose"]); },
  };
  new Function("self", "Tokenizer", workerCode)(scope, { async fromJSON(buffer) { assert(buffer instanceof ArrayBuffer); return tokenizer; } });
  await scope.onmessage({ data: { buffer: new ArrayBuffer(4), text: completeText } });
  assert.equal(calls[0][0], "dispose");
  assert.equal(calls[1][0], "message");
  if (failEncoding) assert.equal(typeof calls[1][1].error, "string");
  else assert.equal(calls[1][1].count, 3);
  assert.equal(calls[2][0], "close");
}
const worker = await readFile(new URL("../src/offline/llm.worker.ts", import.meta.url), "utf8");
assert(worker.includes('stage: "response"'));
assert(worker.includes("now - lastProgressAt >= 750"));
assert(worker.includes("counterController?.abort()"));
console.info("Isolated token counter verified: complete input transferred, termination on success/error/timeout/cancel, tokenizer disposed and worker closes, progress throttled. Real Safari memory and inference not verified.");
