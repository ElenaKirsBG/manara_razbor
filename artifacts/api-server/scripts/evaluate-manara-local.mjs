import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadManaraVerification } from "./load-manara-verification.mjs";

process.on("uncaughtException", (error) => {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exit(1);
});
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--run")) throw new Error("Usage: eval:manara [--run]");
const run = args.includes("--run");
const cases = JSON.parse(await readFile(new URL("./manara-eval-cases.json", import.meta.url), "utf8"));
const { buildManaraPrompts, CreateManaraReadingResponse,
  MANARA_LOCAL_CONTEXT_TOKENS, MANARA_LOCAL_OUTPUT_TOKENS } = await loadManaraVerification();
// Deliberately no production provider selection or cloud fallback.
const baseUrl = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
const model = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";
const options = {
  temperature: 0.4, seed: 42,
  num_ctx: MANARA_LOCAL_CONTEXT_TOKENS, num_predict: MANARA_LOCAL_OUTPUT_TOKENS,
};
const results = [];
for (const scenario of cases) {
  const { systemPrompt, userPrompt, promptBytes } = buildManaraPrompts(scenario.input);
  const record = {
    ...scenario, promptBytes,
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    generationStatus: run ? "pending" : "not_run",
    structureStatus: "not_evaluated",
    semanticStatus: "not_evaluated",
    // A reviewer must fill each item with pass/fail and evidence from rawContent.
    review: scenario.rubric.map((criterion) => ({ criterion, verdict: "not_evaluated", evidence: "" })),
  };
  if (run) {
    try {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: record.messages, format: "json", stream: false, options }),
        signal: AbortSignal.timeout(600_000),
      });
      if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
      const payload = await response.json();
      record.rawContent = payload.message?.content ?? "";
      record.generationMetadata = {
        model: payload.model, createdAt: payload.created_at, doneReason: payload.done_reason,
        promptEvalCount: payload.prompt_eval_count, evalCount: payload.eval_count,
      };
      if (!record.rawContent) throw new Error("Ollama returned no content");
      record.generationStatus = "generated";
      // Structural success must NEVER turn semanticStatus into pass.
      try {
        const parsed = CreateManaraReadingResponse.parse(JSON.parse(record.rawContent));
        const complete = parsed.cardAnalysis.length === scenario.input.cardIds.length &&
          parsed.cardAnalysis.every((card, i) =>
            card.cardId === scenario.input.cardIds[i] && card.position === i + 1);
        if (!complete) throw new Error("Incomplete or reordered cards");
        record.structureStatus = "pass";
      } catch (error) {
        record.structureStatus = "fail";
        record.structureError = error.message;
      }
      record.semanticStatus = "needs_human_review";
    } catch (error) {
      record.generationStatus = "error";
      record.generationError = error.message;
    }
  }
  results.push(record);
  process.stdout.write(`${scenario.id}: generation=${record.generationStatus}, structure=${record.structureStatus}, semantics=${record.semanticStatus}\n`);
  // An unavailable local service is not a failed semantic test. Save evidence
  // and stop rather than waiting ten minutes again for every remaining case.
  if (record.generationStatus === "error") break;
}
const directory = fileURLToPath(new URL("../../../generated-artifacts/manara-evaluation/", import.meta.url));
await mkdir(directory, { recursive: true });
const path = `${directory}${new Date().toISOString().replaceAll(":", "-")}-${run ? "local" : "dry-run"}.json`;
await writeFile(path, JSON.stringify({
  executedAt: new Date().toISOString(), mode: run ? "local-ollama" : "dry-run",
  model, options, semanticVerdict: "not_evaluated", results,
}, null, 2));
process.stdout.write(`Report: ${path}\nNo automatic semantic verdict. Review every rubric item against the actual raw answer.\n`);
if (run && results.some((r) => r.generationStatus === "error" || r.structureStatus === "fail")) process.exitCode = 1;
