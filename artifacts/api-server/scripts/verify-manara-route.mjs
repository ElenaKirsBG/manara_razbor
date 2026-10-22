import assert from "node:assert/strict";
import { loadManaraVerification } from "./load-manara-verification.mjs";

process.on("uncaughtException", (error) => {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exit(1);
});
// Route-level unit test: no socket or model, only a clearly marked transport stub.
// Force Ollama so an accidental provider fallback cannot incur a cloud request.
process.env.MANARA_AI_PROVIDER = "ollama";
const { manaraRouter, buildManaraPrompts, MANARA_LOCAL_CONTEXT_TOKENS,
  MANARA_LOCAL_OUTPUT_TOKENS } = await loadManaraVerification({ includeRouter: true });
const handler = manaraRouter.stack.find((layer) =>
  layer.route?.path === "/manara/readings" && layer.route.methods.post).route.stack[0].handle;
const input = {
  question: "Какие альтернативы стоит проверить?",
  querentGender: "not_specified", mode: "psychological",
  cardIds: ["earth-5", "chariot", "water-8", "air-8"],
};
const expected = buildManaraPrompts(input);
const output = {
  overview: "Транспортная заглушка, не ответ модели.",
  cardAnalysis: expected.selectedCards.map((card, i) => ({
    cardId: card.id, cardName: card.name, position: i + 1,
    interpretation: "Заглушка.", connectionToQuestion: "Заглушка.",
  })),
  cardDynamics: "Заглушка.", likelyAnswer: "Заглушка.",
  alternativeReadings: ["Заглушка."], reflectionQuestions: ["Заглушка."],
};
let calls = 0;
let mockOutput = output;
globalThis.fetch = async (url, options) => {
  calls++;
  assert.ok(String(url).endsWith("/api/chat"));
  const body = JSON.parse(options.body);
  assert.deepEqual(body.messages, [
    { role: "system", content: expected.systemPrompt },
    { role: "user", content: expected.userPrompt },
  ]);
  assert.equal(body.options.num_ctx, MANARA_LOCAL_CONTEXT_TOKENS);
  assert.equal(body.options.num_predict, MANARA_LOCAL_OUTPUT_TOKENS);
  return { ok: true, json: async () => ({ message: { content: JSON.stringify(mockOutput) } }) };
};
async function request(body) {
  const result = { statusCode: 200, body: null };
  const res = {
    status(status) { result.statusCode = status; return this; },
    json(payload) { result.body = payload; return this; },
  };
  await handler({ body, log: { error() {} } }, res);
  return result;
}
assert.deepEqual(await request(input), { statusCode: 200, body: output });
for (const cardIds of [
  [], ["missing"], ["chariot", "chariot"], Array(13).fill("chariot"),
]) {
  const before = calls;
  assert.equal((await request({ ...input, cardIds })).statusCode, 400);
  assert.equal(calls, before, "Invalid input must not call a provider");
}
for (const cardAnalysis of [
  output.cardAnalysis.slice(0, -1),
  [...output.cardAnalysis].reverse(),
  output.cardAnalysis.map((card, i) => i === 0 ? { ...card, cardId: "fool" } : card),
  output.cardAnalysis.map((card, i) => i === 0 ? { ...card, position: 7 } : card),
]) {
  mockOutput = { ...output, cardAnalysis };
  assert.equal((await request(input)).statusCode, 502);
}
mockOutput = { ...output, cardAnalysis: null };
assert.equal((await request(input)).statusCode, 502);
process.stdout.write("Verified route wiring with transport stub: exact prompts/options, invalid input before provider, incomplete/reordered/invalid responses rejected. No real model response or semantic assessment.\n");
