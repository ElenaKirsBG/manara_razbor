import { Router, type IRouter } from "express";
import {
  CreateManaraReadingBody,
  GetManaraCardsResponse,
} from "@workspace/api-zod";
import {
  findManaraCards,
  getManaraCardsWithImages,
  manaraCards,
} from "./manara-cards";
import {
  buildManaraPrompts,
  MANARA_LOCAL_CONTEXT_TOKENS,
  MANARA_LOCAL_OUTPUT_TOKENS,
} from "../lib/manara-prompts";
import { validateManaraReading } from "../lib/manara-response";

const router: IRouter = Router();

router.get("/manara/cards", (_req, res) => {
  try {
    res.json(GetManaraCardsResponse.parse(getManaraCardsWithImages()));
  } catch (error) {
    // Keep the catalog usable even if its generated response shape is changed.
    res.json(GetManaraCardsResponse.parse(manaraCards));
  }
});

type AiProvider = "ollama" | "replit";

function getAiProvider(): AiProvider {
  const configured = process.env.MANARA_AI_PROVIDER;
  if (configured === "ollama" || configured === "replit") return configured;
  return process.env.REPL_ID || process.env.REPLIT_DEV_DOMAIN ? "replit" : "ollama";
}

async function generateInterpretationContent(systemPrompt: string, userPrompt: string): Promise<string> {
  if (getAiProvider() === "ollama") {
    const baseUrl = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
    const model = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        format: "json",
        stream: false,
        options: {
          temperature: 0.4,
          num_ctx: MANARA_LOCAL_CONTEXT_TOKENS,
          num_predict: MANARA_LOCAL_OUTPUT_TOKENS,
        },
      }),
      signal: AbortSignal.timeout(600000),
    });
    const payload = await response.json().catch(() => null) as {
      message?: { content?: string };
      error?: string;
    } | null;
    if (!response.ok) {
      throw new Error(payload?.error ?? `Локальная модель вернула HTTP ${response.status}`);
    }
    if (!payload?.message?.content) {
      throw new Error("Локальная модель не вернула текст толкования.");
    }
    return payload.message.content;
  }

  const { openai } = await import("@workspace/integrations-openai-ai-server");
  const stream = await openai.chat.completions.create({
    model: "gpt-5.6-terra",
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  let content = "";
  for await (const chunk of stream) {
    content += chunk.choices[0]?.delta?.content ?? "";
  }
  return content;
}

router.post("/manara/readings", async (req, res) => {
  let input: ReturnType<typeof CreateManaraReadingBody.parse>;
  try {
    input = CreateManaraReadingBody.parse(req.body);
  } catch {
    res.status(400).json({ error: "Проверьте вопрос, режим разбора и выбранные карты." });
    return;
  }

  if (new Set(input.cardIds).size !== input.cardIds.length) {
    res.status(400).json({ error: "В раскладе не должно быть повторяющихся карт." });
    return;
  }

  try {
    findManaraCards(input.cardIds);
  } catch {
    res.status(400).json({ error: "В раскладе есть карта, которой нет в колоде Манара." });
    return;
  }

  const provider = getAiProvider();
  let responseReceived = false;
  try {
    const { systemPrompt, userPrompt } = buildManaraPrompts(input);
    const content = await generateInterpretationContent(systemPrompt, userPrompt);
    responseReceived = true;
    const parsed = validateManaraReading(JSON.parse(content), input.cardIds);
    res.json(parsed);
  } catch (error) {
    req.log.error({ err: error }, "Manara interpretation generation failed");
    res.status(502).json({
      error: responseReceived
        ? "Модель не вернула полноценный разбор: ответ не прошёл проверку и не показан как интерпретация. Вопрос и карты остались в форме."
        : provider === "ollama"
        ? `Локальная модель недоступна или не вернула разбор. Запустите Ollama и проверьте, что модель ${process.env.OLLAMA_MODEL ?? "qwen2.5:7b"} загружена; вопрос и карты остались в форме.`
        : "Не удалось получить корректное толкование. Попробуйте ещё раз; вопрос и карты остались в форме.",
    });
  }
});

export default router;
