import { Ollama } from "ollama";

export function createOllamaClient({ host, model, requestTimeoutMs }) {
  if (!host) throw new Error("Missing Ollama host");
  if (!model) throw new Error("Missing Ollama model");
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error("Invalid Ollama requestTimeoutMs");
  }

  const ollamaClient = new Ollama({ host });

  return {
    host,
    model,
    requestTimeoutMs,

    chat(args) {
      return ollamaClient.chat(args);
    },
  };
}