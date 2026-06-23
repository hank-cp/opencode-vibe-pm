/**
 * TiktokenBackend — OpenAI 模型 tokenizer
 *
 * 利用 tiktoken 内置的 encoding_for_model() 自动选择最精确 encoding。
 */
import { get_encoding, encoding_for_model, type Tiktoken, type TiktokenModel } from "tiktoken";
import type { TokenizerBackend } from "../types.js";

export class TiktokenBackend implements TokenizerBackend {
  private encoder: Tiktoken;

  constructor(modelID: string) {
    try {
      this.encoder = encoding_for_model(modelID as TiktokenModel);
    } catch {
      this.encoder = get_encoding("cl100k_base");
    }
  }

  countTokens(text: string): number {
    if (!text || !text.trim()) return 0;
    return this.encoder.encode(text).length;
  }

  dispose(): void {
    this.encoder.free();
  }
}
