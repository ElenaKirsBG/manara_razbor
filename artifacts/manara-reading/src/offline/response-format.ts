type SelectedCard = { id: string; name: string };
const text = { type: "string", minLength: 1 };

// An unconstrained JSON object permits {}. Constrain generation itself, not
// only the post-response validator. Identity and order come from the real draw.
export function buildLocalResponseFormat(cards: readonly SelectedCard[]) {
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > 12 ||
      cards.some(card => !card || typeof card.id !== "string" || !card.id ||
        typeof card.name !== "string" || !card.name) ||
      new Set(cards.map(card => card.id)).size !== cards.length) {
    throw new Error("Не удалось подготовить формат ответа: проверьте выбранные карты.");
  }
  const schema = {
    type: "object",
    properties: {
      overview: text,
      cardAnalysis: {
        type: "array",
        prefixItems: cards.map((card, index) => ({
          type: "object",
          properties: {
            cardId: { const: card.id },
            cardName: { const: card.name },
            position: { const: index + 1 },
            interpretation: text,
            connectionToQuestion: text,
          },
          required: ["cardId", "cardName", "position", "interpretation", "connectionToQuestion"],
          additionalProperties: false,
        })),
        items: false,
        minItems: cards.length,
        maxItems: cards.length,
      },
      cardDynamics: text,
      likelyAnswer: text,
      alternativeReadings: { type: "array", items: text, minItems: 1 },
      reflectionQuestions: { type: "array", items: text, minItems: 2 },
    },
    required: ["overview", "cardAnalysis", "cardDynamics", "likelyAnswer", "alternativeReadings", "reflectionQuestions"],
    additionalProperties: false,
  };
  // WebLLM's WASM binding requires a serialized schema, not a JS object.
  return { type: "json_object" as const, schema: JSON.stringify(schema) };
}
