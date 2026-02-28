import fs from "node:fs";
import path from "node:path";
import { Ollama } from "ollama";

const args = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(args.input || "data/temporal/test.jsonl");
const outputPath = path.resolve(args.output || "data/temporal/predictions.test.jsonl");
const model = args.model || process.env.OLLAMA_MODEL_UNDERSTANDING || process.env.OLLAMA_MODEL || "qwen2.5:3b";
const baseUrl = args.baseUrl || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const timeoutMs = Number(args.timeoutMs || process.env.OLLAMA_REQUEST_TIMEOUT_MS || 20000);

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new Error("Invalid timeout, provide --timeout-ms <positive_number>");
}

const client = new Ollama({ host: baseUrl });

const rows = readJsonl(inputPath);
const outRows = [];

for (const row of rows) {
  const query = String(row.query || "").trim();
  const referenceNowIso = String(row.reference_now_iso || "").trim();
  let prediction = emptyPrediction();
  try {
    prediction = await predictTemporal(client, {
      model,
      timeoutMs,
      query,
      referenceNowIso,
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "temporal_prediction_failed",
        id: row.id,
        reason: error?.message || String(error),
      }),
    );
  }

  outRows.push({
    id: row.id,
    prediction,
  });
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
writeJsonl(outputPath, outRows);

console.log(
  JSON.stringify(
    {
      input: inputPath,
      output: outputPath,
      model,
      base_url: baseUrl,
      examples: rows.length,
    },
    null,
    2,
  ),
);

async function predictTemporal(clientInstance, { model, timeoutMs, query, referenceNowIso }) {
  const schema = {
    type: "object",
    required: [
      "time_range_type",
      "start_date_iso",
      "end_date_iso",
      "duration_value",
      "duration_unit",
      "duration_modifier",
      "time_hint",
      "confidence",
    ],
    properties: {
      time_range_type: { type: "string", enum: ["relative", "absolute", "none"] },
      start_date_iso: { type: ["string", "null"] },
      end_date_iso: { type: ["string", "null"] },
      duration_value: { type: ["number", "null"] },
      duration_unit: { type: ["string", "null"], enum: ["day", "week", "month", null] },
      duration_modifier: { type: ["string", "null"], enum: ["half", "next", "this", null] },
      time_hint: { type: ["string", "null"] },
      confidence: { type: "number" },
    },
    additionalProperties: false,
  };

  const response = await withTimeout(
    clientInstance.chat({
      model,
      format: schema,
      options: { temperature: 0, num_ctx: 1536, num_predict: 120 },
      messages: [
        {
          role: "system",
          content:
            "Extract temporal intent from a recreation query. Return strict JSON with keys: time_range_type, start_date_iso, end_date_iso, duration_value, duration_unit, duration_modifier, time_hint, confidence.",
        },
        {
          role: "user",
          content: JSON.stringify({ query, reference_now_iso: referenceNowIso }),
        },
      ],
    }),
    timeoutMs,
    "prediction_timeout",
  );

  const content = response?.message?.content;
  if (!content) return emptyPrediction();

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return emptyPrediction();
  }

  return normalizePrediction(parsed);
}

function normalizePrediction(raw) {
  const normalizeIso = (value) => {
    if (value === undefined || value === null || value === "") return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  let confidence = Number(raw?.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));

  const durationValue = Number.isFinite(Number(raw?.duration_value)) ? Number(raw.duration_value) : null;
  const durationUnit = ["day", "week", "month"].includes(raw?.duration_unit) ? raw.duration_unit : null;
  const durationModifier = ["half", "next", "this"].includes(raw?.duration_modifier)
    ? raw.duration_modifier
    : null;
  const timeRangeType = ["relative", "absolute", "none"].includes(raw?.time_range_type)
    ? raw.time_range_type
    : "none";

  return {
    time_range_type: timeRangeType,
    start_date_iso: normalizeIso(raw?.start_date_iso),
    end_date_iso: normalizeIso(raw?.end_date_iso),
    duration_value: durationValue,
    duration_unit: durationUnit,
    duration_modifier: durationModifier,
    time_hint: raw?.time_hint ? String(raw.time_hint) : null,
    confidence,
  };
}

function emptyPrediction() {
  return {
    time_range_type: "none",
    start_date_iso: null,
    end_date_iso: null,
    duration_value: null,
    duration_unit: null,
    duration_modifier: null,
    time_hint: null,
    confidence: 0,
  };
}

function withTimeout(promise, timeoutMs, timeoutCode) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutCode)), timeoutMs);
    }),
  ]);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--input") out.input = value;
    if (key === "--output") out.output = value;
    if (key === "--model") out.model = value;
    if (key === "--base-url") out.baseUrl = value;
    if (key === "--timeout-ms") out.timeoutMs = value;
  }
  return out;
}

function readJsonl(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${filePath}:${i + 1} (${error.message})`);
      }
    });
}

function writeJsonl(filePath, rows) {
  const payload = rows.map((row) => JSON.stringify(row)).join("\n");
  fs.writeFileSync(filePath, `${payload}\n`, "utf8");
}
