"""
WriteCheck OCR Pipeline: YOLO Line Segmentation + Fine-Tuned TrOCR
====================================================================
Exact implementation matching high-accuracy 'New folder (19)' reference:
- YOLO Line Detection with iou=0.40
- Vertical centroid sorting
- Non-merging overlap filter (never combines lines into tall multi-line crops)
- Neighbor-bounded adaptive vertical padding (safe_pad_t, safe_pad_b)
- CLAHE contrast normalization on every crop
- Tuned TrOCR generation (repetition_penalty=1.2, no_repeat_ngram_size=3, max_new_tokens=64)
- Essay post-processing (essay_formatter.py)
"""

import argparse
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps
import torch
from transformers import TrOCRProcessor, VisionEncoderDecoderModel
from ultralytics import YOLO

# Add backend directory to path
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
sys.path.append(str(BASE_DIR))

from essay_formatter import (
    clean_punctuation_and_casing,
    correct_domain_terms,
    format_essay_document,
)

DEFAULT_YOLO_PATH = (
    PROJECT_ROOT
    / "yolo26x_grayscale_1024_lr0.00075_adam_scale_only_0.1_701515_FINAL_RESULTS"
    / "training_results"
    / "weights"
    / "best.pt"
)
DEFAULT_TROCR_PATH = PROJECT_ROOT / "final_model"


def find_model_paths(yolo_arg=None, trocr_arg=None):
    yolo_candidates = []
    if yolo_arg:
        yolo_candidates.append(Path(yolo_arg))
    if os.getenv("YOLO_MODEL_PATH"):
        yolo_candidates.append(Path(os.getenv("YOLO_MODEL_PATH")))
    yolo_candidates.extend([
        DEFAULT_YOLO_PATH,
        BASE_DIR / "best.pt",
        PROJECT_ROOT / "best.pt",
        PROJECT_ROOT / "weights" / "best.pt",
    ])
    yolo_path = next((p for p in yolo_candidates if p.exists()), None)
    if not yolo_path:
        raise FileNotFoundError(
            f"YOLO best.pt model weights not found. Searched: {[str(p) for p in yolo_candidates]}"
        )

    trocr_candidates = []
    if trocr_arg:
        trocr_candidates.append(Path(trocr_arg))
    if os.getenv("TROCR_MODEL_PATH"):
        trocr_candidates.append(Path(os.getenv("TROCR_MODEL_PATH")))
    trocr_candidates.extend([
        DEFAULT_TROCR_PATH,
        BASE_DIR / "models" / "final_model",
    ])
    trocr_path = next((p for p in trocr_candidates if p.exists()), None)
    if not trocr_path:
        raise FileNotFoundError(
            f"TrOCR model folder not found. Searched: {[str(p) for p in trocr_candidates]}"
        )

    return yolo_path, trocr_path


def compute_levenshtein(seq1, seq2):
    m, n = len(seq1), len(seq2)
    dp = [[0] * (n + 1) for _ in range(m + 1)]

    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j

    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if seq1[i - 1] == seq2[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])

    return dp[m][n]


def calculate_metrics(hypothesis_text, reference_text):
    hyp_clean = hypothesis_text.strip()
    ref_clean = reference_text.strip()

    char_dist = compute_levenshtein(hyp_clean, ref_clean)
    total_chars = max(1, len(ref_clean))
    cer = char_dist / total_chars

    hyp_words = hyp_clean.split()
    ref_words = ref_clean.split()
    word_dist = compute_levenshtein(hyp_words, ref_words)
    total_words = max(1, len(ref_words))
    wer = word_dist / total_words

    return {
        "CER": cer,
        "WER": wer,
        "CER_percent": f"{cer * 100:.2f}%",
        "WER_percent": f"{wer * 100:.2f}%",
        "char_errors": char_dist,
        "total_chars": total_chars,
        "word_errors": word_dist,
        "total_words": total_words,
    }


def preprocess_crop_clahe(crop_pil):
    """Enhance stroke contrast against yellow/ruled backgrounds using CLAHE."""
    img_np = np.array(crop_pil)
    gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    return Image.fromarray(cv2.cvtColor(enhanced, cv2.COLOR_GRAY2RGB))


def extract_adaptive_line_crops(
    raw_img,
    boxes,
    pad_ratio_vert=0.08,
    pad_px_horiz=6,
    save_crops_dir=None,
):
    """
    Adaptive line extraction exactly matching New folder (19):
    1. Centroid Y sorting.
    2. Overlap filter (retains higher confidence, does NOT merge boxes).
    3. Safe vertical padding that cannot bleed into neighboring lines.
    4. CLAHE contrast enhancement.
    """
    img_w, img_h = raw_img.size
    parsed_boxes = []

    for box in boxes:
        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
        conf = float(box.conf[0])
        parsed_boxes.append({
            "x1": x1,
            "y1": y1,
            "x2": x2,
            "y2": y2,
            "centroid_y": (y1 + y2) / 2.0,
            "height": y2 - y1,
            "conf": conf,
        })

    # Sort strictly by vertical centroid
    parsed_boxes.sort(key=lambda b: b["centroid_y"])

    # Overlap filter
    filtered_boxes = []
    for b in parsed_boxes:
        if not filtered_boxes:
            filtered_boxes.append(b)
            continue
        prev = filtered_boxes[-1]
        overlap_y1 = max(prev["y1"], b["y1"])
        overlap_y2 = min(prev["y2"], b["y2"])
        overlap_h = max(0, overlap_y2 - overlap_y1)
        min_h = min(prev["height"], b["height"])

        if min_h > 0 and (overlap_h / min_h) > 0.65:
            if b["conf"] > prev["conf"]:
                filtered_boxes[-1] = b
        else:
            filtered_boxes.append(b)

    crops = []
    num_boxes = len(filtered_boxes)

    for idx, b in enumerate(filtered_boxes):
        max_pad = int(b["height"] * pad_ratio_vert)
        if idx > 0:
            dist_prev = b["y1"] - filtered_boxes[idx - 1]["y2"]
            safe_pad_t = min(max_pad, max(0, dist_prev // 2))
        else:
            safe_pad_t = max_pad

        if idx < num_boxes - 1:
            dist_next = filtered_boxes[idx + 1]["y1"] - b["y2"]
            safe_pad_b = min(max_pad, max(0, dist_next // 2))
        else:
            safe_pad_b = max_pad

        cx1 = max(0, b["x1"] - pad_px_horiz)
        cy1 = max(0, b["y1"] - safe_pad_t)
        cx2 = min(img_w, b["x2"] + pad_px_horiz)
        cy2 = min(img_h, b["y2"] + safe_pad_b)

        crop_pil = raw_img.crop((cx1, cy1, cx2, cy2))
        enhanced_crop = preprocess_crop_clahe(crop_pil)

        crops.append({
            "box": (cx1, cy1, cx2, cy2),
            "crop": enhanced_crop,
            "conf": b["conf"],
        })

    if save_crops_dir:
        save_dir = Path(save_crops_dir)
        save_dir.mkdir(parents=True, exist_ok=True)
        for i, item in enumerate(crops):
            crop_path = save_dir / f"line_{i+1:03d}.png"
            item["crop"].save(crop_path)
        print(f"[info] Saved {len(crops)} line crops to: {save_dir}", flush=True)

    return crops


class HandwritingOCRPipeline:
    def __init__(self, yolo_path=None, trocr_path=None, device=None, fp16=True):
        yolo_p, trocr_p = find_model_paths(yolo_path, trocr_path)
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.fp16 = fp16 and self.device == "cuda"

        if self.device == "cuda":
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True

        print(f"[1/3] Loading YOLO model from: {yolo_p}", flush=True)
        self.yolo_model = YOLO(str(yolo_p))

        print(f"[2/3] Loading TrOCR model from: {trocr_p}", flush=True)
        self.processor = TrOCRProcessor.from_pretrained(
            str(trocr_p), local_files_only=trocr_p.exists()
        )
        torch_dtype = torch.float16 if self.fp16 else torch.float32
        self.trocr_model = VisionEncoderDecoderModel.from_pretrained(
            str(trocr_p), local_files_only=trocr_p.exists(), torch_dtype=torch_dtype
        ).to(self.device)
        self.trocr_model.eval()

        # Suppress max_length warning
        if hasattr(self.trocr_model.config, "max_length"):
            self.trocr_model.config.max_length = None
        if hasattr(self.trocr_model, "generation_config") and hasattr(self.trocr_model.generation_config, "max_length"):
            self.trocr_model.generation_config.max_length = None

        print(f"[3/3] Pipeline initialized on device: {self.device} (FP16: {self.fp16})", flush=True)

    def detect_lines(self, image_path, conf=0.25, iou=0.40, imgsz=1024):
        """Step 4: YOLO line detection matching New folder (19) parameters."""
        raw_img = ImageOps.exif_transpose(Image.open(image_path)).convert("RGB")
        img_cv = cv2.cvtColor(np.array(raw_img), cv2.COLOR_RGB2BGR)
        results = list(self.yolo_model.predict(
            source=img_cv,
            conf=conf,
            iou=iou,
            imgsz=imgsz,
            verbose=False,
        ))
        boxes = getattr(results[0], "boxes", [])
        return raw_img, boxes

    def recognize_lines(self, line_crops, batch_size=8, num_beams=4, max_new_tokens=64):
        """
        Step 7: Send crops to TrOCR in batches.
        Uses repetition_penalty=1.2 and no_repeat_ngram_size=3 matching New folder (19).
        """
        recognized_lines = []
        total = len(line_crops)

        for i in range(0, total, batch_size):
            batch = line_crops[i : i + batch_size]
            batch_images = [item["crop"] for item in batch]

            pixel_values = self.processor(
                images=batch_images,
                return_tensors="pt",
                padding=True,
            ).pixel_values.to(self.device)

            if self.fp16:
                pixel_values = pixel_values.half()

            with torch.no_grad():
                gen_kwargs = {
                    "max_new_tokens": max_new_tokens,
                    "repetition_penalty": 1.2,
                    "use_cache": True,
                    "early_stopping": True,
                }
                if num_beams > 1:
                    gen_kwargs["num_beams"] = num_beams
                    gen_kwargs["no_repeat_ngram_size"] = 3

                generated_ids = self.trocr_model.generate(pixel_values, **gen_kwargs)

            batch_texts = self.processor.batch_decode(
                generated_ids,
                skip_special_tokens=True,
            )

            for item, text in zip(batch, batch_texts):
                recognized_lines.append({
                    "text": text.strip(),
                    "box": item["box"],
                    "conf": item["conf"],
                })

        return recognized_lines

    def process_essay(
        self,
        image_path,
        conf=0.25,
        iou=0.40,
        pad_ratio_vert=0.08,
        pad_px_horiz=6,
        batch_size=8,
        num_beams=4,
        max_new_tokens=64,
        save_crops_dir=None,
    ):
        """
        Execute end-to-end OCR flow on a handwritten essay.
        Returns:
            dict with 'lines', 'text', 'line_count', 'boxes', 'elapsed_seconds'
        """
        t0 = time.perf_counter()
        image_path = Path(image_path)
        if not image_path.exists():
            raise FileNotFoundError(f"Image not found: {image_path}")

        # 1. YOLO detection
        raw_img, yolo_boxes = self.detect_lines(str(image_path), conf=conf, iou=iou)

        if len(yolo_boxes) == 0:
            return {
                "text": "",
                "lines": [],
                "line_count": 0,
                "boxes": [],
                "elapsed_seconds": time.perf_counter() - t0,
            }

        # 2. Adaptive Line Extraction (with CLAHE & neighbor bounds)
        crops = extract_adaptive_line_crops(
            raw_img,
            yolo_boxes,
            pad_ratio_vert=pad_ratio_vert,
            pad_px_horiz=pad_px_horiz,
            save_crops_dir=save_crops_dir,
        )

        # 3. TrOCR Recognition
        results = self.recognize_lines(
            crops,
            batch_size=batch_size,
            num_beams=num_beams,
            max_new_tokens=max_new_tokens,
        )

        # 4. Essay Formatter (paragraphs, numbered items, domain corrections)
        lines_with_meta = [
            {
                "text": clean_punctuation_and_casing(correct_domain_terms(r["text"])),
                "bbox": list(r["box"]),
            }
            for r in results
        ]

        full_text = format_essay_document(lines_with_meta)
        line_texts = [r["text"] for r in lines_with_meta if r["text"]]
        elapsed = time.perf_counter() - t0

        return {
            "text": full_text,
            "lines": line_texts,
            "line_count": len(line_texts),
            "boxes": [r["box"] for r in results],
            "elapsed_seconds": elapsed,
        }


def main():
    parser = argparse.ArgumentParser(
        description="WriteCheck: YOLO + TrOCR Line Segmentation & Recognition Pipeline"
    )
    parser.add_argument("image", nargs="?", help="Path to handwritten essay image")
    parser.add_argument("--yolo", default=None, help="Path to best.pt weights")
    parser.add_argument("--trocr", default=None, help="Path to fine-tuned TrOCR folder")
    parser.add_argument("--save-crops", default=None, help="Directory to export line crops")
    parser.add_argument("--output", default=None, help="File to save recognized text")
    parser.add_argument("--eval", default=None, help="Path to ground-truth text file to compute CER and WER")
    parser.add_argument("--beams", type=int, default=4, help="Beam size (default: 4 for high-accuracy beam search)")
    parser.add_argument("--batch-size", type=int, default=8, help="Batch size for TrOCR (default: 8)")
    parser.add_argument("--conf", type=float, default=0.25, help="YOLO confidence threshold (default: 0.25)")
    parser.add_argument("--iou", type=float, default=0.40, help="YOLO NMS IoU threshold (default: 0.40)")

    args = parser.parse_args()

    if not args.image:
        sample = PROJECT_ROOT / "backend" / "uploads" / "i35oi19cu0e41.jpg"
        if not sample.exists():
            sample = PROJECT_ROOT / "backend" / "uploads" / "IMG_8884_deskewed_JPG.rf.6edf809d20975308dfd44798b9be71f0.jpg"
        if sample.exists():
            args.image = str(sample)
            print(f"[notice] No image specified, using sample: {sample}", flush=True)
        else:
            parser.print_help()
            sys.exit(1)

    pipeline = HandwritingOCRPipeline(yolo_path=args.yolo, trocr_path=args.trocr)
    print(f"\nProcessing essay: {args.image} ...", flush=True)
    output = pipeline.process_essay(
        args.image,
        conf=args.conf,
        iou=args.iou,
        batch_size=args.batch_size,
        num_beams=args.beams,
        save_crops_dir=args.save_crops,
    )

    print("\n" + "=" * 50)
    print(f"RECOGNIZED DIGITAL TEXT ({output['line_count']} lines in {output['elapsed_seconds']:.2f}s)")
    print("=" * 50)
    print(output["text"])
    print("=" * 50)

    if args.output:
        Path(args.output).write_text(output["text"], encoding="utf-8")
        print(f"\nSaved recognized text to: {args.output}")

    if args.eval:
        gt_path = Path(args.eval)
        if gt_path.exists():
            gt_text = gt_path.read_text(encoding="utf-8")
            metrics = calculate_metrics(output["text"], gt_text)
            print("\n" + "=" * 50)
            print("THESIS BENCHMARK EVALUATION (CER / WER)")
            print("=" * 50)
            print(f"Character Error Rate (CER): {metrics['CER_percent']} ({metrics['char_errors']} / {metrics['total_chars']} chars)")
            print(f"Word Error Rate (WER):      {metrics['WER_percent']} ({metrics['word_errors']} / {metrics['total_words']} words)")
            print("=" * 50)
        else:
            print(f"[warning] Ground truth file not found: {gt_path}")


if __name__ == "__main__":
    main()
