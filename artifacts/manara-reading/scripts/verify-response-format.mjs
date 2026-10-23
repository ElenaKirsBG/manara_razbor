import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transformWithEsbuild } from "vite";

const source = await readFile(new URL("../src/offline/response-format.ts", import.meta.url), "utf8");
const { code } = await transformWithEsbuild(source, "response-format.ts", { format: "esm", target: "es2022" });
const { LOCAL_RESPONSE_FORMAT } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
assert.equal(LOCAL_RESPONSE_FORMAT.type, "json_object");
assert.equal(typeof LOCAL_RESPONSE_FORMAT.schema, "string");
assert.deepEqual(JSON.parse(LOCAL_RESPONSE_FORMAT.schema), { type: "object", additionalProperties: true });
// Reproduce the string boundary required by WebLLM's WASM grammar compiler.
function schemaStringBoundary(schema) {
  if (typeof schema !== "string") throw new TypeError("Cannot pass non string to std::string");
  return JSON.parse(schema);
}
assert.throws(() => schemaStringBoundary(undefined), /Cannot pass non string/);
assert.doesNotThrow(() => schemaStringBoundary(LOCAL_RESPONSE_FORMAT.schema));
const worker = await readFile(new URL("../src/offline/llm.worker.ts", import.meta.url), "utf8");
assert(worker.includes("response_format: LOCAL_RESPONSE_FORMAT"));
assert(!worker.includes('response_format: { type: "json_object" }'));
const hook = await readFile(new URL("../src/hooks/use-offline-reading.ts", import.meta.url), "utf8");
assert(hook.includes('validateOfflineReading(JSON.parse(result.content ?? ""), input.cardIds)'));
console.info("JSON request regression verified: explicit serialized object schema reaches the generation request; strict response/card-order validation retained. Not a real model inference test.");
