import { CreateManaraReadingResponse } from "@workspace/api-zod";
import { findManaraCards } from "../routes/manara-cards";

const normalize = (text: string) => text.normalize("NFKC").toLowerCase()
  .replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Regression markers from the old, answer-shaped instruction template.
// These detect a known copying failure, not semantic correctness or grounding.
const instructionMarkers = [
  "вклад карты в общую историю и как её смысл уточняется другими выбранными картами",
  "как это связано с вопросом и что остаётся гипотезой",
  "связное совместное чтение назови конкретные пары сочетания",
  "сдержанный ответ на исходный запрос из совместного чтения всего расклада",
  "минимум одна обоснованная альтернативная версия целого сочетания",
  "2–3 практичных вопроса для проверки реальности и своих границ",
  "целостная гипотеза и центральная динамика всего сочетания в контексте вопроса",
  "объясни предел одиночной карты сочетаний в этом раскладе нет",
].map(normalize);

function hasLongDuplicate(texts: string[], minimumLength = 40) {
  const seen = new Set<string>();
  return texts.some(text => {
    const normalized = normalize(text);
    if (normalized.length < minimumLength) return false;
    if (seen.has(normalized)) return true;
    seen.add(normalized);
    return false;
  });
}

export function validateManaraReading(raw: unknown, cardIds: string[]) {
  const reading = CreateManaraReadingResponse.parse(raw);
  const cards = findManaraCards(cardIds);
  if (reading.cardAnalysis.length !== cards.length ||
      reading.cardAnalysis.some((card, index) => card.cardId !== cards[index].id ||
        card.position !== index + 1 || card.cardName !== cards[index].name)) {
    throw new Error("Модель изменила состав, названия или порядок карт. Разбор не показан.");
  }
  const texts = [reading.overview, reading.cardDynamics, reading.likelyAnswer,
    ...reading.cardAnalysis.flatMap(card => [card.interpretation, card.connectionToQuestion]),
    ...reading.alternativeReadings, ...reading.reflectionQuestions];
  if (texts.some(text => !text.trim()) || reading.alternativeReadings.length < 1 ||
      reading.reflectionQuestions.length < 2) {
    throw new Error("Модель вернула неполный разбор. Вопрос и карты остались в форме.");
  }
  if (texts.some(text => instructionMarkers.some(marker => normalize(text).includes(marker)) ||
      ["string", "text", "строка", "текст"].includes(normalize(text)))) {
    throw new Error("Модель скопировала служебные инструкции вместо интерпретации. Такой текст не показан как разбор. Вопрос и карты остались в форме.");
  }
  if (hasLongDuplicate(reading.cardAnalysis.map(card => card.interpretation)) ||
      hasLongDuplicate(reading.cardAnalysis.map(card => card.connectionToQuestion)) ||
      hasLongDuplicate(reading.alternativeReadings) ||
      new Set(reading.reflectionQuestions.map(normalize)).size !== reading.reflectionQuestions.length) {
    throw new Error("Модель повторила одинаковые заготовки вместо отдельных выводов. Такой текст не показан как разбор. Вопрос и карты остались в форме.");
  }
  const dynamics = ` ${normalize(reading.cardDynamics)} `;
  if (cards.length > 1 && cards.filter(card => dynamics.includes(` ${normalize(card.name)} `)).length < 2) {
    throw new Error("Модель не раскрыла сочетание конкретных выбранных карт. Разбор не показан. Вопрос и карты остались в форме.");
  }
  return reading;
}
