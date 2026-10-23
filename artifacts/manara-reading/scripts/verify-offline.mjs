import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildManaraPrompts, getManaraCardsWithImages, validateOfflineReading,
} from "../src/generated/manara-core.js";

const cards = getManaraCardsWithImages();
assert.equal(cards.length, 78);
assert.equal(new Set(cards.map(c => c.id)).size, 78);
for (const count of [1,3,12]) {
  const cardIds = cards.slice(0,count).map(c => c.id);
  const prompts = buildManaraPrompts({
    question:"Как проверить взаимные ожидания и безопасно обсудить границы?",
    querentGender:"not_specified", mode:"psychological", cardIds,
  });
  const input = JSON.parse(prompts.userPrompt);
  assert.deepEqual(input.orderedCards.map(c=>c.id),cardIds);
  assert.equal(input.spreadContext.adjacentPairs.length,count-1);
  assert(input.orderedCards.every(c=>c.sourceNotes.length>=2));
  assert(prompts.systemPrompt.includes("ГЛАВНЫЙ ПРИОРИТЕТ"));
  assert(prompts.systemPrompt.includes("Принуждение, давление"));
  const fixture = {
    overview:"Общий смысл.", cardDynamics:cards.slice(0,count).map(c=>c.name).join(" и ") + ": тестовая связь.", likelyAnswer:"Ответ-гипотеза.",
    cardAnalysis:cards.slice(0,count).map((c,i)=>({
      cardId:c.id,cardName:c.name,position:i+1,interpretation:"Вклад в сочетание.",connectionToQuestion:"Связь с вопросом.",
    })), alternativeReadings:["Альтернативное совместное чтение."],reflectionQuestions:["Что известно?","Что нужно уточнить?"],
  };
  assert.equal(validateOfflineReading(fixture,cardIds).cardAnalysis.length,count);
  assert.throws(()=>validateOfflineReading({...fixture,alternativeReadings:[]},cardIds));
  assert.throws(()=>validateOfflineReading({...fixture,cardDynamics:""},cardIds));
  assert.throws(()=>validateOfflineReading({...fixture,cardAnalysis:[]},cardIds));
  if(count>1)assert.throws(()=>validateOfflineReading({...fixture,cardAnalysis:[...fixture.cardAnalysis].reverse()},cardIds));
}
const worker = await readFile(new URL("../src/offline/llm.worker.ts",import.meta.url),"utf8");
const counterWorker = await readFile(new URL("../src/offline/token-count.worker.ts",import.meta.url),"utf8");
assert(worker.includes("countTokensInIsolatedWorker"));
assert(counterWorker.includes("tokenizer.encode"));
assert(worker.includes('reason === "length"'));
assert(worker.includes("contextForInput(inputTokens, LOCAL_OUTPUT_TOKENS, LOCAL_CONTEXT_TOKENS)"));
console.info("Offline core verified: 78 cards, complete source angles, combination/safety prompts, 1/3/12-card order, empty and partial response rejection. This does not test real GPU inference or iPhone behavior.");
