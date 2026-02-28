# Colab Training Workflow (Temporal SFT)

This folder contains scripts for external GPU training and model export.

## Quick Start Notebook
Open and run:
- `scripts/colab/temporal_train.ipynb`

It contains the full Colab flow (install, train, merge, GGUF conversion, download).

## 1) Prepare local data
From repo root:

```bash
node scripts/prepareTemporalSFT.js
```

Upload these files to Colab:
- `data/temporal/sft/train.chat.jsonl`
- `data/temporal/sft/val.chat.jsonl`

## 2) Train LoRA/QLoRA in Colab
Install deps in Colab:

```bash
pip install -U transformers trl datasets peft accelerate bitsandbytes sentencepiece
```

Run:

```bash
python scripts/colab/train_temporal_sft.py \
  --train-file /content/train.chat.jsonl \
  --val-file /content/val.chat.jsonl \
  --output-dir /content/temporal-qwen25-lora \
  --base-model Qwen/Qwen2.5-3B-Instruct \
  --use-4bit
```

## 3) Merge adapter into base weights

```bash
python scripts/colab/merge_temporal_adapter.py \
  --base-model Qwen/Qwen2.5-3B-Instruct \
  --adapter-dir /content/temporal-qwen25-lora \
  --output-dir /content/temporal-qwen25-merged
```

## 4) Convert to GGUF (llama.cpp)
Build `llama.cpp` first, then run:

```bash
LLAMA_CPP_DIR=/content/llama.cpp \
HF_MODEL_DIR=/content/temporal-qwen25-merged \
OUT_DIR=/content/model-out \
bash scripts/colab/convert_to_gguf.sh
```

Download the quantized `.gguf` from `OUT_DIR`.

## 5) Import locally into Ollama (Windows PowerShell)
From repo root:

```powershell
.\scripts\importTemporalModel.ps1 -GgufPath C:\models\temporal-qwen25.q4_k_m.gguf -ModelName qwen-temporal
```

## 6) Evaluate in this repo

```bash
npm run predict:temporal-test -- --model qwen-temporal
npm run eval:temporal-test
```
