import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Bundle pure data only: no server, credentials, model, database or source books.
const { outputFiles } = await build({
  absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
  stdin: {
    contents: [
      'export * from "./src/data/manara-knowledge";',
      'export * from "./src/data/manara-scan-notes";',
      'export * from "./src/data/manara-klyuev-notes";',
      'export * from "./src/routes/manara-cards";',
    ].join("\n"),
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const {
  manaraKnowledge, manaraScanNotes, manaraKlyuevNotes, manaraSourceRegistry,
  manaraCards, manaraSources, findManaraCards, getManaraCardsWithImages,
} = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

const majorIds = [
  "fool", "magician", "priestess", "empress", "emperor", "hierophant",
  "lovers", "chariot", "justice", "hermit", "wheel", "strength",
  "hanged-man", "death", "temperance", "devil", "tower", "star",
  "moon", "sun", "judgement", "world",
];
// Independent transcription of the source tables of contents, in APP rank order.
const novikovaStarts = {
  major: [44,47,49,52,55,58,61,64,67,70,73,76,78,81,84,87,89,92,95,98,101,104],
  fire: [107,109,112,115,117,120,123,126,129,132,135,138,142,140],
  water: [144,147,150,152,155,157,160,163,165,167,169,171,176,173],
  air: [210,212,215,217,220,223,226,229,232,234,237,239,243,241],
  earth: [179,181,184,186,188,190,193,196,198,200,202,204,208,206],
};
const businessStarts = {
  major: [97,103,108,113,118,122,126,131,136,140,145,150,155,160,165,170,174,179,184,189,194,199],
  fire: [12,21,24,27,36,40,44,54,58,62,16,66,48,31],
  water: [72,81,85,90,99,103,108,118,125,130,76,135,112,94],
  air: [141,149,152,156,166,169,174,185,190,195,145,199,179,160],
  earth: [205,213,217,221,230,234,238,248,252,256,208,260,242,225],
};
const expectedIds = [
  ...majorIds,
  ...["fire", "water", "air", "earth"].flatMap((suit) =>
    Array.from({ length: 14 }, (_, i) => `${suit}-${i + 1}`)),
];
const klyuevPages = {
  fool: [27,27], magician: [28,28], priestess: [29,29], empress: [30,31],
  emperor: [31,32], "earth-3": [55,55], "earth-4": [55,55],
  "earth-6": [57,57], "earth-7": [57,57],
};
assert.deepEqual(Object.keys(manaraKlyuevNotes).sort(), Object.keys(klyuevPages).sort());
for (const collection of [manaraKnowledge, manaraScanNotes]) {
  assert.deepEqual(Object.keys(collection).sort(), [...expectedIds].sort());
}
assert.equal(manaraCards.length, 78);
assert.equal(new Set(manaraCards.map((c) => c.id)).size, 78);
assert.equal(new Set(manaraCards.map((c) => c.name)).size, 78);
const summaries = new Set();
for (const card of manaraCards) {
  const knowledge = manaraKnowledge[card.id];
  assert.equal(card.name, knowledge.name);
  assert.equal(card.meaning, knowledge.meaning);
  assert.equal(card.shadow, knowledge.shadow);
  assert.ok(knowledge.keywords.length >= 2, card.id);
  assert.ok(knowledge.reflectionQuestions.length >= 2, card.id);
  const additionalKlyuev = Boolean(klyuevPages[card.id]);
  assert.equal(knowledge.sources.length, additionalKlyuev ? 4 : 3, card.id);
  assert.equal(knowledge.sources[0].sourceId, "kotelnikova-gerasimova");
  assert.equal(knowledge.sourceNotes.length, additionalKlyuev ? 3 : 2, card.id);
  const index = card.suit === "major" ? majorIds.indexOf(card.id) : card.rank - 1;
  const starts = [novikovaStarts[card.suit][index], businessStarts[card.suit][index],
    klyuevPages[card.id]?.[0]];
  for (const [i, note] of knowledge.sourceNotes.entries()) {
    const expectedSource = i === 0 ? "novikova" : i === 2 ? "klyuev"
      : card.suit === "major" ? "business-major" : "business-minor";
    assert.equal(note.source.sourceId, expectedSource, card.id);
    assert.equal(note.source.section, card.name, card.id);
    const [start, end] = note.source.filePages;
    assert.equal(start, starts[i], `${card.id}: wrong chapter`);
    if (i === 2) assert.deepEqual(note.source.filePages, klyuevPages[card.id]);
    assert.ok(Number.isInteger(end) && end >= start);
    assert.ok(end <= manaraSourceRegistry[expectedSource].filePageCount);
    assert.deepEqual(knowledge.sources[i + 1], note.source);
    assert.ok(card.meaning.includes(note.summary), `${card.id}: enrichment not exposed`);
    assert.ok(note.summary.length >= 80 && note.summary.length <= 400, card.id);
    assert.ok(!summaries.has(note.summary), `${card.id}: generic repeated summary`);
    summaries.add(note.summary);
  }
}
assert.equal(summaries.size, 165);
for (const sourceId of ["novikova", "business-major", "business-minor", "klyuev"]) {
  assert.ok(manaraSources.includes(manaraSourceRegistry[sourceId].title));
}
assert.deepEqual(findManaraCards(["earth-14", "fool", "water-13"]).map((c) => c.id),
  ["earth-14", "fool", "water-13"]);
assert.throws(() => findManaraCards(["not-a-card"]), /Неизвестная карта/);
for (const card of getManaraCardsWithImages()) {
  assert.equal(card.imageUrl, `/cards/${card.id}.jpg`);
}
// These disagreements must survive into the actual card context, not just a registry.
for (const id of ["chariot", "water-8", "air-8", "earth-5", "earth-10"]) {
  const { meaning } = manaraKnowledge[id];
  assert.ok(meaning.includes("Ракурс Новиковой:"));
  assert.ok(meaning.includes("Ракурс Хапатнюковской и Бахаева:"));
}
process.stdout.write("Verified: 78 cards, 165 unique source notes, chapter/page references, court mapping, catalog and ordered lookup.\n");
