#!/usr/bin/env bash
set -euo pipefail

# Convert merged HF model to GGUF and quantize with llama.cpp.
#
# Required env vars:
#   LLAMA_CPP_DIR  Path to llama.cpp checkout
#   HF_MODEL_DIR   Path to merged HF model directory
#   OUT_DIR        Output directory for GGUF files
# Optional env vars:
#   GGUF_BASENAME  Base filename (default: temporal-qwen25)
#   QUANT_TYPE     Quant type for llama-quantize (default: Q4_K_M)
#
# Example:
#   LLAMA_CPP_DIR=/content/llama.cpp \
#   HF_MODEL_DIR=/content/temporal-qwen25-merged \
#   OUT_DIR=/content/model-out \
#   bash scripts/colab/convert_to_gguf.sh

: "${LLAMA_CPP_DIR:?LLAMA_CPP_DIR is required}"
: "${HF_MODEL_DIR:?HF_MODEL_DIR is required}"
: "${OUT_DIR:?OUT_DIR is required}"

GGUF_BASENAME="${GGUF_BASENAME:-temporal-qwen25}"
QUANT_TYPE="${QUANT_TYPE:-Q4_K_M}"

mkdir -p "${OUT_DIR}"

FP16_GGUF="${OUT_DIR}/${GGUF_BASENAME}.f16.gguf"
QUANT_GGUF="${OUT_DIR}/${GGUF_BASENAME}.${QUANT_TYPE,,}.gguf"

python3 "${LLAMA_CPP_DIR}/convert_hf_to_gguf.py" \
  "${HF_MODEL_DIR}" \
  --outfile "${FP16_GGUF}" \
  --outtype f16

"${LLAMA_CPP_DIR}/build/bin/llama-quantize" \
  "${FP16_GGUF}" \
  "${QUANT_GGUF}" \
  "${QUANT_TYPE}"

echo "GGUF ready: ${QUANT_GGUF}"
