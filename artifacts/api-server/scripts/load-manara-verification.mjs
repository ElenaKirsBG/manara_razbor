import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Load production code without starting Express or importing any AI provider.
export async function loadManaraVerification({ includeRouter = false } = {}) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const { outputFiles } = await build({
    absWorkingDir: root,
    stdin: {
      contents: [
        'export * from "./src/lib/manara-prompts";',
        'export * from "./src/data/manara-knowledge";',
        'export * from "./src/data/manara-scan-notes";',
        'export * from "./src/routes/manara-cards";',
        'export { CreateManaraReadingResponse } from "@workspace/api-zod";',
        ...(includeRouter ? ['export { default as manaraRouter } from "./src/routes/manara";'] : []),
      ].join("\n"),
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    banner: includeRouter ? {
      js: `import { createRequire } from "node:module"; const require = createRequire(${JSON.stringify(`${root}/package.json`)});`,
    } : undefined,
    external: ["@workspace/integrations-openai-ai-server"],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
