import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";

const nlp = winkNLP(model);
const its = nlp.its;

export function normalizeText(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const doc = nlp.readDoc(text);
  const tokens = doc.tokens().out();
  return tokens
    .map((token) => String(token || "").toLowerCase())
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
    .join(" ");
}

export function buildAliasCandidates(rawTerm) {
  const normalized = normalizeText(rawTerm);
  if (!normalized) return [];

  const tokens = normalized.split(" ").filter(Boolean);
  if (!tokens.length) return [];

  const candidates = new Set();
  candidates.add(normalized);

  // Phrase n-grams (longest first) help map natural phrases like "play badminton".
  for (let size = tokens.length; size >= 1; size -= 1) {
    for (let i = 0; i + size <= tokens.length; i += 1) {
      const phrase = tokens.slice(i, i + size).join(" ");
      candidates.add(phrase);
    }
  }

  // Keep content terms from POS tags (nouns/proper nouns/adjectives).
  const doc = nlp.readDoc(String(rawTerm || ""));
  const taggedTokens = doc.tokens().out(its.pos).map((pos, idx) => ({
    pos,
    token: tokens[idx] || "",
  }));
  const contentTokens = taggedTokens
    .filter(({ pos, token }) => {
      if (!token) return false;
      return pos === "NOUN" || pos === "PROPN" || pos === "ADJ";
    })
    .map(({ token }) => token);
  if (contentTokens.length) {
    candidates.add(contentTokens.join(" "));
    contentTokens.forEach((token) => candidates.add(token));
  }

  return Array.from(candidates).filter(Boolean);
}
