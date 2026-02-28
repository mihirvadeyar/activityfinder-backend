import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const baseDir = args.baseDir || "data/temporal";
const outDir = args.outDir || "data/temporal/sft";
const splits = args.splits?.length ? args.splits : ["train", "val", "test"];

for (const split of splits) {
  const inputPath = path.resolve(baseDir, `${split}.jsonl`);
  const outputChatPath = path.resolve(outDir, `${split}.chat.jsonl`);
  const outputInstructPath = path.resolve(outDir, `${split}.instruct.jsonl`);

  const records = readJsonl(inputPath);
  const chatRows = records.map(toChatRow);
  const instructRows = records.map(toInstructRow);

  fs.mkdirSync(path.dirname(outputChatPath), { recursive: true });
  writeJsonl(outputChatPath, chatRows);
  writeJsonl(outputInstructPath, instructRows);

  console.log(
    JSON.stringify(
      {
        split,
        input: inputPath,
        output_chat: outputChatPath,
        output_instruct: outputInstructPath,
        examples: records.length,
      },
      null,
      2,
    ),
  );
}

/**
 * Builds a chat-style SFT row compatible with many open-source fine-tuning pipelines.
 *
 * @param {Object} row
 */
function toChatRow(row) {
  const query = String(row.query || "").trim();
  const referenceNowIso = String(row.reference_now_iso || "").trim();
  const label = normalizeLabel(row.label || {});

  return {
    id: row.id,
    messages: [
      {
        role: "system",
        content:
          "Extract temporal intent from a recreation query. Return strict JSON with keys: time_range_type, start_date_iso, end_date_iso, duration_value, duration_unit, duration_modifier, time_hint, confidence.",
      },
      {
        role: "user",
        content: JSON.stringify({
          query,
          reference_now_iso: referenceNowIso,
        }),
      },
      {
        role: "assistant",
        content: JSON.stringify(label),
      },
    ],
  };
}

/**
 * Builds an instruction-tuning row for frameworks that use instruction/input/output triplets.
 *
 * @param {Object} row
 */
function toInstructRow(row) {
  const query = String(row.query || "").trim();
  const referenceNowIso = String(row.reference_now_iso || "").trim();
  const label = normalizeLabel(row.label || {});

  return {
    id: row.id,
    instruction:
      "Extract temporal intent from a recreation query as strict JSON. Use keys: time_range_type, start_date_iso, end_date_iso, duration_value, duration_unit, duration_modifier, time_hint, confidence.",
    input: JSON.stringify({
      query,
      reference_now_iso: referenceNowIso,
    }),
    output: JSON.stringify(label),
  };
}

/**
 * Normalizes output label shape before writing training examples.
 *
 * @param {Object} raw
 */
function normalizeLabel(raw) {
  const normalizeIso = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  const durationValueRaw = raw.duration_value;
  const durationValue = Number.isFinite(Number(durationValueRaw)) ? Number(durationValueRaw) : null;
  const durationUnit = ["day", "week", "month"].includes(raw.duration_unit) ? raw.duration_unit : null;
  const durationModifier = ["half", "next", "this"].includes(raw.duration_modifier)
    ? raw.duration_modifier
    : null;
  const timeRangeType = ["relative", "absolute", "none"].includes(raw.time_range_type)
    ? raw.time_range_type
    : "none";

  let confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    time_range_type: timeRangeType,
    start_date_iso: normalizeIso(raw.start_date_iso),
    end_date_iso: normalizeIso(raw.end_date_iso),
    duration_value: durationValue,
    duration_unit: durationUnit,
    duration_modifier: durationModifier,
    time_hint: raw.time_hint ? String(raw.time_hint) : null,
    confidence,
  };
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

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--base-dir") out.baseDir = value;
    if (key === "--out-dir") out.outDir = value;
    if (key === "--splits") out.splits = String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  return out;
}
