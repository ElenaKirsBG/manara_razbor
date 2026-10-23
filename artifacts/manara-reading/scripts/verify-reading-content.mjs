import assert from "node:assert/strict";
import { buildManaraPrompts, getManaraCardsWithImages, validateOfflineReading } from "../src/generated/manara-core.js";

// Synthetic fixtures test known failure filters, not literary quality, source
// grounding or the ability of a real model to produce a good interpretation.
const deck = getManaraCardsWithImages();
const oldInstructions = [
  "вклад карты в общую историю и как её смысл уточняется другими выбранными картами; не отдельная словарная трактовка",
  "как это связано с вопросом и что остаётся гипотезой",
  "связное совместное чтение: назови конкретные пары/сочетания, объясни изменение смысла, усиления и противоречия, затем собери все карты в общую гипотезу; не повторяй список значений",
  "сдержанный ответ на исходный запрос из совместного чтения всего расклада, а не вердикт по одной карте; отдели гипотезы от известных фактов",
  "минимум одна обоснованная альтернативная версия целого сочетания с опорой на конкретные выбранные карты",
  "2–3 практичных вопроса для проверки реальности и своих границ",
];
for (const count of [1, 4, 12]) {
  const cards = deck.slice(0, count);
  const cardIds = cards.map(card=>card.id);
  const prompts = buildManaraPrompts({
    question:"Какие взаимные ожидания стоит обсудить?", querentGender:"not_specified", mode:"detailed", cardIds,
  });
  const payload = JSON.parse(prompts.userPrompt);
  assert(!Object.hasOwn(payload,"requiredShape"));
  assert.deepEqual(payload.orderedCards.map(card=>card.id),cardIds);
  for(const phrase of oldInstructions) assert(!prompts.userPrompt.includes(phrase));
  assert(prompts.systemPrompt.includes("Напиши САМ РАЗБОР"));
  const valid = {
    overview:"Тестовая гипотеза, не результат реальной модели.",
    cardAnalysis:cards.map((card,i)=>({
      cardId:card.id,cardName:card.name,position:i+1,
      interpretation:`Для ${card.name} проверяется отдельная тестовая динамика между инициативой и ответным поведением.`,
      connectionToQuestion:`В рамках тестового вопроса ${card.name} получает отдельное объяснение, а не одинаковый текст.`,
    })),
    cardDynamics:cards.map(card=>`«${card.name}»`).join(" и ") + ": синтетическая связь для проверки фильтра.",
    likelyAnswer:"Это тестовый ответ, не оценка качества интерпретации.",
    alternativeReadings:["Одна тестовая альтернатива."],
    reflectionQuestions:["Какие факты уже известны?", "Какие ожидания стоит уточнить?"],
  };
  assert.deepEqual(validateOfflineReading(valid,cardIds),valid);
  for(const phrase of oldInstructions) {
    for(const field of ["overview","cardDynamics","likelyAnswer"]) {
      assert.throws(()=>validateOfflineReading({...valid,[field]:phrase},cardIds),/служебные инструкции/);
    }
    assert.throws(()=>validateOfflineReading({...valid,alternativeReadings:[phrase]},cardIds),/служебные инструкции/);
    assert.throws(()=>validateOfflineReading({...valid,reflectionQuestions:[phrase,"Второй вопрос?"]},cardIds),/служебные инструкции/);
    assert.throws(()=>validateOfflineReading({...valid,cardAnalysis:valid.cardAnalysis.map((card,i)=>i?card:{...card,interpretation:phrase})},cardIds),/служебные инструкции/);
  }
  assert.throws(()=>validateOfflineReading({...valid,reflectionQuestions:["Один вопрос?", "Один вопрос?"]},cardIds),/одинаковые заготовки/);
  assert.throws(()=>validateOfflineReading({...valid,overview:"string"},cardIds),/служебные инструкции/);
  if(count>1) {
    assert.throws(()=>validateOfflineReading({...valid,cardDynamics:"Карты говорят об отношениях без конкретных связей."},cardIds),/сочетание конкретных/);
    for(const field of ["interpretation","connectionToQuestion"]) {
      const repeated = "Повтор одного и того же длинного текста вместо конкретного объяснения отдельной выбранной карты.";
      assert.throws(()=>validateOfflineReading({...valid,cardAnalysis:valid.cardAnalysis.map(card=>({...card,[field]:repeated}))},cardIds),/одинаковые заготовки/);
    }
  }
}
console.info("Content regressions verified: old instruction text cannot be shown as a reading; duplicate card boilerplate/questions rejected; joint section names actual selected cards; no answer-shaped prompt template. These filters do not establish semantic quality or real local model behavior.");
