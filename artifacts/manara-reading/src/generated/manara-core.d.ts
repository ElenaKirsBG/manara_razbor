import type { ManaraCard, ManaraReading } from "@workspace/api-client-react";
export declare const OFFLINE_CORE_REVISION: string;
export declare function getManaraCardsWithImages(): ManaraCard[];
export declare function buildManaraPrompts(raw: unknown): {
  systemPrompt: string;
  userPrompt: string;
  selectedCards: ManaraCard[];
  promptBytes: number;
};
export declare function validateOfflineReading(raw: unknown, cardIds: string[]): ManaraReading;
