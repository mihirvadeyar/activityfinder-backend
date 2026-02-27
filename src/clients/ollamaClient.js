import { Ollama } from "ollama";

/**
 * Builds a thin wrapper around the Ollama SDK to keep a consistent client shape.
 *
 * @param {Object} deps
 * @param {string} deps.host
 * @param {string} deps.model
 * @param {number} deps.requestTimeoutMs
 */
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

    /**
     * Sends a chat request to Ollama.
     *
     * @param {object} args
     */
    chat(args) {
      return ollamaClient.chat(args);
    },
  };
}
