# Таро Манара — разбор расклада

Русскоязычное приложение для анализа раскладов Таро Манара: голосовой или текстовый вопрос, ручной/случайный выбор карт и развернутая трактовка.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/manara-reading run typecheck` — check the web app
- Device mode uses browser WebLLM without the API. Only explicitly selected server mode uses Replit AI Integrations in Replit or Ollama in a local clone unless `MANARA_AI_PROVIDER` is set.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/manara-reading` — web app
- `artifacts/api-server/src/routes/manara.ts` — AI interpretation API
- `artifacts/api-server/src/routes/manara-cards.ts` — concise original notes for 78 cards
- `artifacts/manara-reading/public/cards` — bundled local card images
- `lib/api-spec/openapi.yaml` — API source of truth

## Architecture decisions

- Readings are not saved on the server; the service only receives the current question and card IDs when the user requests an interpretation.
- Card images are bundled locally so the card catalog does not depend on external image hosting.
- Book text is not redistributed; the app uses short original summary notes with per-card source/page references. KNOWLEDGE_SOURCES.md documents scan processing and the limits of verification; generated OCR stays in ignored generated-artifacts/.
- Browser-device interpretation is separate from the optional server provider. The server cannot access Ollama on the user's computer from Replit.

## Product

- Manual ordered card selection or random draw of a user-selected count, 1–12.
- Russian browser dictation for the question, with manual entry as the fallback.
- Detailed and psychological interpretation modes, with hypotheses and alternatives rather than claims of fact.

## User preferences

- Приложение будет использоваться на iPhone 15 Pro Max.
- Для установки доступен компьютер Windows; платной подписки Apple Developer нет.
- Пользователь указала iOS 26.6.2 на целевом iPhone.
- Особое внимание уделять сочетаниям карт в одном раскладе и их совместному трактованию; результат не должен сводиться к списку отдельных значений.

- The user wants the Tarot Manara app to use the books they provided and the Rozamira image gallery they named.
- The user chose fully offline local-model operation and a public GitHub archive containing all 78 images; no external gallery links in the app.

## Gotchas

- Device mode is a PWA with WebLLM; no API or Ollama is required after app/model caching. Actual iPhone inference is not verified by desktop preview.
- Server mode is explicit opt-in; only that offline-server variant requires Ollama on the API machine. Never silently fall back from device mode to server.
- AI Integration variables are supplied by Replit and must never be committed to Git.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
