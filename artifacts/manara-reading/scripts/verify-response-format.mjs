import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transformWithEsbuild } from "vite";
import { getManaraCardsWithImages, validateOfflineReading } from "../src/generated/manara-core.js";

const source = await readFile(new URL("../src/offline/response-format.ts", import.meta.url), "utf8");
const { code } = await transformWithEsbuild(source, "response-format.ts", { format: "esm", target: "es2022" });
const { buildLocalResponseFormat } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const deck = getManaraCardsWithImages();
for (const cards of [[], Array(13).fill(deck[0]), [deck[0], deck[0]], [{id:"bad"}], null]) {
  assert.throws(() => buildLocalResponseFormat(cards));
}

// Test the installed WebLLM bundle's actual embedded XGrammar WASM compiler.
// Only the temporary copy exposes its otherwise-private test API; production
// never depends on private engine internals, a GPU, model weights or a network.
const temp = await mkdtemp(join(tmpdir(), "manara-response-grammar-"));
let tokenizerInfo, compiler;
try {
  const bundle = await readFile(new URL(import.meta.resolve("@mlc-ai/web-llm")), "utf8");
  assert(bundle.includes("var libExports$1 = requireLib$1()"));
  const modulePath = join(temp, "grammar-test.mjs");
  const nodeBundle = bundle.replaceAll("MLC_DUMMY_PATH", pathToFileURL(modulePath).href);
  await writeFile(modulePath, 'import { createRequire } from "node:module";\n' + nodeBundle + "\nexport const grammarTestApi = libExports$1;\n");
  const { grammarTestApi: api } = await import(pathToFileURL(modulePath).href);
  tokenizerInfo = await api.TokenizerInfo.createTokenizerInfo([]);
  compiler = await api.GrammarCompiler.createGrammarCompiler(tokenizerInfo, false);
  async function accepts(compiled, value) {
    const matcher = await api.GrammarMatcher.createGrammarMatcher(compiled, undefined, true);
    try { return matcher._acceptString(JSON.stringify(value)) && matcher.isTerminated(); }
    finally { matcher.dispose(); }
  }
  const oldGrammar = await compiler.compileJSONSchema(JSON.stringify({ type:"object", additionalProperties:true }));
  try { assert(await accepts(oldGrammar, {}), "Old generic grammar reproduces the empty-object defect"); }
  finally { oldGrammar.dispose(); }
  for (const count of [1, 3, 7, 12]) {
    const cards = deck.slice(0, count);
    const format = buildLocalResponseFormat(cards);
    assert.equal(format.type, "json_object");
    assert.equal(typeof format.schema, "string");
    const grammar = await compiler.compileJSONSchema(format.schema);
    const valid = {
      overview:"Целостная гипотеза.",
      cardAnalysis:cards.map((card,i) => ({
        cardId:card.id, cardName:card.name, position:i+1,
        interpretation:"Вклад карты в сочетание.", connectionToQuestion:"Связь с вопросом.",
      })),
      cardDynamics:cards.map(card=>card.name).join(" и ") + ": тестовая совместная динамика.",
      likelyAnswer:"Осторожный ответ.",
      alternativeReadings:["Другая возможная гипотеза."],
      reflectionQuestions:["Что известно?", "Что нужно проверить?"],
    };
    try {
      assert(await accepts(grammar, valid), `Actual WASM must accept complete ${count}-card reading`);
      assert.equal(validateOfflineReading(valid, cards.map(card => card.id)).cardAnalysis.length, count);
      assert(!await accepts(grammar, {}));
      for (const key of Object.keys(valid)) {
        const incomplete = {...valid}; delete incomplete[key];
        assert(!await accepts(grammar, incomplete), `Missing ${key} must not be a complete response`);
      }
      for (const invalid of [
        {...valid, overview:""},
        {...valid, cardDynamics:""},
        {...valid, alternativeReadings:[]},
        {...valid, reflectionQuestions:["One"]},
        {...valid, cardAnalysis:valid.cardAnalysis.slice(1)},
        {...valid, cardAnalysis:[{...valid.cardAnalysis[0],cardId:"unknown"},...valid.cardAnalysis.slice(1)]},
        {...valid, cardAnalysis:[{...valid.cardAnalysis[0],position:0},...valid.cardAnalysis.slice(1)]},
        {...valid, cardAnalysis:[{...valid.cardAnalysis[0],cardName:"Другая карта"},...valid.cardAnalysis.slice(1)]},
        {...valid, extra:"not allowed"},
      ]) assert(!await accepts(grammar, invalid));
      if(count>1) assert(!await accepts(grammar, {...valid, cardAnalysis:[...valid.cardAnalysis].reverse()}));
    } finally { grammar.dispose(); }
  }
} finally {
  compiler?.dispose();
  tokenizerInfo?.dispose();
  await rm(temp, {recursive:true,force:true});
}
const worker = await readFile(new URL("../src/offline/llm.worker.ts", import.meta.url), "utf8");
assert(worker.includes("response_format: responseFormat"));
assert(worker.includes("buildLocalResponseFormat(selectedCards)"));
assert(!worker.includes('response_format: { type: "json_object" }'));
const hook = await readFile(new URL("../src/hooks/use-offline-reading.ts", import.meta.url), "utf8");
assert(hook.includes('validateOfflineReading(JSON.parse(result.content ?? ""), input.cardIds)'));
assert(hook.includes('systemPrompt, userPrompt, selectedCards'));
console.info("Actual WebLLM WASM grammar verified for 1/3/7/12 cards: old schema accepts {}; new schema accepts complete readings and rejects missing fields, wrong card identities/order, empty strings and short arrays. Strict response validation retained. No real model/GPU inference tested.");
