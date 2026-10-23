import { Tokenizer } from "@mlc-ai/web-tokenizers";

self.onmessage = async ({ data }: MessageEvent<{ buffer: ArrayBuffer; text: string }>) => {
  try {
    const tokenizer = await Tokenizer.fromJSON(data.buffer);
    let count: number;
    try { count = tokenizer.encode(data.text).length; }
    finally { tokenizer.dispose(); }
    self.postMessage({ count });
  } catch {
    self.postMessage({ error: "Не удалось подсчитать весь контекст локальным токенизатором." });
  } finally {
    // Also close when the parent page disappears, rather than keeping an
    // orphaned tokenizer worker alive after it posts its single result.
    self.close();
  }
};
