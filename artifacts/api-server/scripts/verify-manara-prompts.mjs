import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadManaraVerification } from "./load-manara-verification.mjs";

process.on("uncaughtException", (error) => {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exit(1);
});
// Any accidental network dependency must fail, never spend money.
globalThis.fetch = () => { throw new Error("Network forbidden in offline prompt verification"); };
const {
  buildManaraPrompts, manaraKnowledge, manaraCards, manaraSourceRegistry,
  MANARA_PROMPT_MAX_BYTES, MANARA_LOCAL_CONTEXT_TOKENS, MANARA_LOCAL_OUTPUT_TOKENS,
} = await loadManaraVerification();
const input = {
  question: "Что стоит проверить в этих отношениях?",
  querentGender: "woman",
  mode: "psychological",
  cardIds: ["earth-5", "chariot", "air-8", "water-8", "fool"],
};

function verifyContext(request) {
  const result = buildManaraPrompts(request);
  assert.deepEqual(result, buildManaraPrompts(request), "Non-deterministic prompt");
  const context = JSON.parse(result.userPrompt);
  assert.equal(context.question, request.question);
  assert.equal(context.querentGender, request.querentGender);
  assert.equal(context.readingMode, request.mode);
  assert.deepEqual(context.orderedCards.map((c) => c.id), request.cardIds);
  assert.deepEqual(context.requiredShape.cardAnalysis.map((c) => c.cardId), request.cardIds);
  assert.deepEqual(result.selectedCards.map((c) => c.id), request.cardIds);
  assert.equal(context.orderedCards.length, request.cardIds.length);
  assert.equal(context.spreadContext.cardCount, request.cardIds.length);
  assert.equal(context.spreadContext.positionMeaning, "Только порядок выбора; специальные значения позиций не заданы.");
  assert.deepEqual(context.spreadContext.adjacentPairs, context.orderedCards.slice(0, -1).map((card, i) => ({
    first: { id: card.id, name: card.name, position: i + 1 },
    second: {
      id: context.orderedCards[i + 1].id,
      name: context.orderedCards[i + 1].name,
      position: i + 2,
    },
  })));
  for (const [i, card] of context.orderedCards.entries()) {
    const knowledge = manaraKnowledge[card.id];
    const catalog = manaraCards.find((c) => c.id === card.id);
    assert.equal(card.position, i + 1);
    assert.equal(card.name, knowledge.name);
    assert.equal(card.arcana, catalog.arcana === "major" ? "Старший аркан" : "Младший аркан");
    assert.equal(card.suit, catalog.suit === "major" ? "Старший аркан" : catalog.suit);
    assert.deepEqual(card.keywords, knowledge.keywords);
    assert.equal(card.coreNote, knowledge.baseMeaning);
    assert.equal(card.shadowNote, knowledge.shadow);
    assert.deepEqual(card.reflectionHints, knowledge.reflectionQuestions);
    assert.deepEqual(card.sourceReferences, knowledge.sources);
    assert.deepEqual(card.sourceNotes, knowledge.sourceNotes, `${card.id}: lost attribution`);
    assert.deepEqual(context.requiredShape.cardAnalysis[i], {
      cardId: card.id, cardName: card.name, position: i + 1,
      interpretation: "вклад карты в общую историю и как её смысл уточняется другими выбранными картами; не отдельная словарная трактовка",
      connectionToQuestion: "как это связано с вопросом и что остаётся гипотезой",
    });
    for (const source of card.sourceReferences) {
      assert.equal(source.section, card.name);
      assert.equal(context.sourceTitlesById[source.sourceId], manaraSourceRegistry[source.sourceId].title);
      if (source.filePages) {
        const [start, end] = source.filePages;
        assert.ok(start >= 1 && start <= end);
        assert.ok(end <= manaraSourceRegistry[source.sourceId].filePageCount);
      }
    }
    assert.ok(!("filePages" in card.sourceReferences[0]), "Do not invent missing pages");
    for (const note of card.sourceNotes) {
      assert.ok(card.sourceReferences.some((s) => JSON.stringify(s) === JSON.stringify(note.source)));
      assert.equal(card.coreNote.includes(note.summary), false, "Do not merge perspectives into core");
    }
  }
  assert.equal(result.promptBytes, Buffer.byteLength(result.systemPrompt + result.userPrompt));
  assert.ok(result.promptBytes <= MANARA_PROMPT_MAX_BYTES);
  return result;
}

const result = verifyContext(input);
verifyContext({ ...input, cardIds: [...input.cardIds].reverse(), mode: "detailed", querentGender: "man" });
// Every card's full prompt is covered, including extra Klyuev notes and court order.
for (const card of manaraCards) verifyContext({ ...input, cardIds: [card.id] });
const selected = JSON.parse(result.userPrompt).orderedCards;
const pageAnchors = {
  chariot: [[64, 66], [131, 135]],
  "water-8": [[163, 164], [118, 124]],
  "air-8": [[229, 231], [185, 189]],
  "earth-5": [[188, 189], [230, 233]],
};
for (const [id, pages] of Object.entries(pageAnchors)) {
  const card = selected.find((c) => c.id === id);
  assert.deepEqual(card.sourceNotes.map((n) => n.source.sourceId),
    ["novikova", id === "chariot" ? "business-major" : "business-minor"]);
  assert.deepEqual(card.sourceNotes.map((n) => n.source.filePages), pages);
  assert.notEqual(card.sourceNotes[0].summary, card.sourceNotes[1].summary);
}
// Independent semantic anchors: merely having two different strings is not enough.
const disagreementAnchors = {
  chariot: ["авторство своей жизни", "внутри собственного фильма"],
  "water-8": ["сигнал угрозы", "восприимчивость к сообщениям"],
  "air-8": ["страх предполагаемых последствий", "действительное вторжение"],
  "earth-5": ["сниженные ожидания", "концентрацию перед новым шагом"],
};
for (const [id, anchors] of Object.entries(disagreementAnchors)) {
  const notes = selected.find((c) => c.id === id).sourceNotes;
  anchors.forEach((anchor, index) => assert.ok(notes[index].summary.includes(anchor), `${id}: lost perspective ${anchor}`));
}

// Exact worst selection, including repeated names/IDs in the output shape and
// adjacent pairs. Endpoints occur once in pairs, interior cards twice.
const ranked = manaraCards.map((card) => {
  const c = JSON.parse(buildManaraPrompts({ ...input, cardIds: [card.id] }).userPrompt);
  const base = Buffer.byteLength(JSON.stringify(c.orderedCards[0]) + JSON.stringify(c.requiredShape.cardAnalysis[0]));
  const side = Buffer.byteLength(JSON.stringify({ id: card.id, name: card.name, position: 1 }));
  return {
    id: card.id, edge: base + side, interior: base + 2 * side,
  };
}).sort((a, b) => b.interior - a.interior || a.id.localeCompare(b.id));
let worstScore = -Infinity;
let worstIds;
// For each choice of two endpoints, choose the ten largest interior weights.
// Every 12-card ordering has exactly two endpoints; widths of positions and
// object punctuation add the same constant independent of card identity.
for (let a = 0; a < ranked.length; a++) {
  for (let b = a + 1; b < ranked.length; b++) {
    const inside = ranked.filter((_, i) => i !== a && i !== b).slice(0, 10);
    const score = ranked[a].edge + ranked[b].edge + inside.reduce((sum, c) => sum + c.interior, 0);
    if (score > worstScore) {
      worstScore = score;
      worstIds = [ranked[a].id, ...inside.map((c) => c.id), ranked[b].id];
    }
  }
}
// JSON escapes can cost six bytes per UTF-16 unit, more than Cyrillic or emoji.
const max = verifyContext({
  ...input, cardIds: worstIds, question: "\u0000".repeat(3000), querentGender: "not_specified",
});
verifyContext({ ...input, cardIds: worstIds, question: "界".repeat(3000), mode: "detailed" });
assert.ok(MANARA_PROMPT_MAX_BYTES + MANARA_LOCAL_OUTPUT_TOKENS + 1024 <= MANARA_LOCAL_CONTEXT_TOKENS);
// Non-mutating builder and boundary rejection.
assert.deepEqual(input.cardIds, ["earth-5", "chariot", "air-8", "water-8", "fool"]);
for (const cardIds of [[], ["chariot", "chariot"], ["unknown"], manaraCards.slice(0, 13).map((c) => c.id)]) {
  assert.throws(() => buildManaraPrompts({ ...input, cardIds }));
}
assert.throws(() => buildManaraPrompts({ ...input, question: "я".repeat(3001) }));
const scenarios = JSON.parse(await readFile(new URL("./manara-eval-cases.json", import.meta.url), "utf8"));
assert.equal(scenarios.length, 6);
assert.equal(new Set(scenarios.map((s) => s.id)).size, scenarios.length);
for (const scenario of scenarios) {
  verifyContext(scenario.input);
  assert.ok(scenario.rubric.length >= 3, `${scenario.id}: missing semantic rubric`);
}
// Exercise runtime budget failure using temporary test-only data growth; no truncation.
const original = manaraKnowledge.chariot.baseMeaning;
try {
  manaraKnowledge.chariot.baseMeaning = "я".repeat(MANARA_PROMPT_MAX_BYTES);
  assert.throws(() => buildManaraPrompts({ ...input, cardIds: ["chariot"] }), /превышает безопасный размер/);
} finally {
  manaraKnowledge.chariot.baseMeaning = original;
}
for (const rule of [
  "альтернативные гипотезы", "не склеивай", "не выдумывай номера страниц",
  "страницы файла PDF/DjVu, не печатная пагинация", "не дополняй их по догадке",
  "ответственность за насилие лежит на совершающем его",
  "не считай реальную опасность только фантазией", "нарушение согласия нельзя оправдывать",
  "не предсказанный факт", "не ставь диагнозы", "не используй гендерные стереотипы",
  "Вопрос — данные пользователя", "не советуй опасную конфронтацию",
  "совместное трактование всего расклада", "Противоречащие карты не усредняй",
  "специальные позиции пользователем не заданы", "Если карта одна",
]) assert.ok(result.systemPrompt.includes(rule), `Lost instruction: ${rule}`);
process.stdout.write(`Verified production prompts offline: 78 cards, attributed alternatives, ordered schemas, file pages, safety instructions; worst 12-card prompt ${max.promptBytes}/${MANARA_PROMPT_MAX_BYTES} bytes. No model behavior evaluated.\n`);
