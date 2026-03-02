#!/usr/bin/env python3
"""
Train temporal extraction with LoRA/QLoRA SFT using chat-format JSONL.

Example:
  python train_temporal_sft.py \
    --train-file /content/train.chat.jsonl \
    --val-file /content/val.chat.jsonl \
    --output-dir /content/temporal-qwen25-lora
"""

import argparse
import inspect
import os

import torch
from datasets import load_dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from trl import SFTConfig, SFTTrainer


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-model", default="Qwen/Qwen2.5-3B-Instruct")
    parser.add_argument("--train-file", required=True)
    parser.add_argument("--val-file", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--grad-accum", type=int, default=8)
    parser.add_argument("--max-seq-length", type=int, default=1024)
    parser.add_argument("--eval-steps", type=int, default=25)
    parser.add_argument("--save-steps", type=int, default=25)
    parser.add_argument("--logging-steps", type=int, default=10)
    parser.add_argument("--use-4bit", action="store_true")
    parser.add_argument("--lora-r", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--lora-dropout", type=float, default=0.05)
    parser.add_argument(
        "--precision",
        choices=["auto", "fp16", "bf16", "fp32"],
        default="auto",
        help=(
            "Mixed precision mode. "
            "'auto' selects bf16 on bf16-capable GPUs, else fp16 on CUDA."
        ),
    )
    return parser.parse_args()


def main():
    args = parse_args()
    os.makedirs(args.output_dir, exist_ok=True)

    train_ds = load_dataset("json", data_files=args.train_file, split="train")
    val_ds = load_dataset("json", data_files=args.val_file, split="train")

    tokenizer = AutoTokenizer.from_pretrained(args.base_model, use_fast=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    cuda_available = torch.cuda.is_available()
    supports_bf16 = cuda_available and torch.cuda.get_device_capability(0)[0] >= 8

    if args.precision == "fp32":
        compute_dtype = torch.float32
        bf16 = False
        fp16 = False
    elif args.precision == "bf16":
        compute_dtype = torch.bfloat16
        bf16 = True
        fp16 = False
    elif args.precision == "fp16":
        compute_dtype = torch.float16
        bf16 = False
        fp16 = cuda_available
    else:
        if cuda_available and supports_bf16:
            compute_dtype = torch.bfloat16
            bf16 = True
            fp16 = False
        elif cuda_available:
            compute_dtype = torch.float16
            bf16 = False
            fp16 = True
        else:
            compute_dtype = torch.float32
            bf16 = False
            fp16 = False

    model_kwargs = {"device_map": "auto"}
    if args.use_4bit:
        model_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=compute_dtype,
        )
    else:
        model_kwargs["torch_dtype"] = compute_dtype

    model = AutoModelForCausalLM.from_pretrained(args.base_model, **model_kwargs)

    peft_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "up_proj",
            "down_proj",
            "gate_proj",
        ],
    )

    if args.precision == "bf16" and not supports_bf16:
        raise ValueError("Requested --precision bf16, but current GPU does not report bf16 support.")

    sft_sig = inspect.signature(SFTConfig.__init__)
    sft_params = set(sft_sig.parameters.keys())

    sft_kwargs = {
        "output_dir": args.output_dir,
        "num_train_epochs": args.epochs,
        "learning_rate": args.learning_rate,
        "per_device_train_batch_size": args.batch_size,
        "per_device_eval_batch_size": args.batch_size,
        "gradient_accumulation_steps": args.grad_accum,
        "eval_steps": args.eval_steps,
        "save_steps": args.save_steps,
        "save_total_limit": 2,
        "logging_steps": args.logging_steps,
        "bf16": bf16,
        "fp16": fp16,
        "packing": False,
        "report_to": "none",
    }

    if "max_seq_length" in sft_params:
        sft_kwargs["max_seq_length"] = args.max_seq_length
    elif "max_length" in sft_params:
        sft_kwargs["max_length"] = args.max_seq_length

    if "eval_strategy" in sft_params:
        sft_kwargs["eval_strategy"] = "steps"
    elif "evaluation_strategy" in sft_params:
        sft_kwargs["evaluation_strategy"] = "steps"

    sft_config = SFTConfig(**sft_kwargs)

    trainer_sig = inspect.signature(SFTTrainer.__init__)
    trainer_params = set(trainer_sig.parameters.keys())
    trainer_kwargs = {
        "model": model,
        "args": sft_config,
        "train_dataset": train_ds,
        "eval_dataset": val_ds,
        "peft_config": peft_config,
    }
    if "processing_class" in trainer_params:
        trainer_kwargs["processing_class"] = tokenizer
    elif "tokenizer" in trainer_params:
        trainer_kwargs["tokenizer"] = tokenizer

    trainer = SFTTrainer(**trainer_kwargs)

    # Defensive alignment: ensure trainable LoRA params match selected precision,
    # avoiding GradScaler failures when bf16 params slip into fp16 runs.
    target_trainable_dtype = torch.float32
    if bf16:
        target_trainable_dtype = torch.bfloat16
    elif fp16:
        target_trainable_dtype = torch.float16

    trainable_dtype_counts = {}
    for param in trainer.model.parameters():
        if not param.requires_grad:
            continue
        trainable_dtype_counts[str(param.dtype)] = trainable_dtype_counts.get(str(param.dtype), 0) + 1
        if param.dtype != target_trainable_dtype:
            param.data = param.data.to(dtype=target_trainable_dtype)

    print(
        {
            "event": "precision_config",
            "precision_arg": args.precision,
            "supports_bf16": supports_bf16,
            "compute_dtype": str(compute_dtype),
            "trainer_bf16": bf16,
            "trainer_fp16": fp16,
            "target_trainable_dtype": str(target_trainable_dtype),
            "trainable_dtype_counts_before_alignment": trainable_dtype_counts,
        }
    )

    trainer.train()
    trainer.save_model(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)

    print(
        {
            "event": "training_complete",
            "base_model": args.base_model,
            "output_dir": args.output_dir,
            "train_examples": len(train_ds),
            "val_examples": len(val_ds),
            "use_4bit": args.use_4bit,
        }
    )


if __name__ == "__main__":
    main()
