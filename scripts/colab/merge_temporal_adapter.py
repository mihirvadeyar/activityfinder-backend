#!/usr/bin/env python3
"""
Merge LoRA adapter into base model and save merged Hugging Face model.

Example:
  python merge_temporal_adapter.py \
    --base-model Qwen/Qwen2.5-3B-Instruct \
    --adapter-dir /content/temporal-qwen25-lora \
    --output-dir /content/temporal-qwen25-merged
"""

import argparse
import os

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-model", required=True)
    parser.add_argument("--adapter-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    return parser.parse_args()


def main():
    args = parse_args()
    os.makedirs(args.output_dir, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(args.base_model, use_fast=True)
    base_model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        torch_dtype=torch.float16,
        device_map="cpu",
    )

    merged = PeftModel.from_pretrained(base_model, args.adapter_dir).merge_and_unload()
    merged.save_pretrained(args.output_dir, safe_serialization=True)
    tokenizer.save_pretrained(args.output_dir)

    print(
        {
            "event": "merge_complete",
            "base_model": args.base_model,
            "adapter_dir": args.adapter_dir,
            "output_dir": args.output_dir,
        }
    )


if __name__ == "__main__":
    main()
