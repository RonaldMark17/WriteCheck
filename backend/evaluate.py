"""
WriteCheck Thesis Evaluation Tool: Benchmark CER & WER
=========================================================
Runs the YOLO + TrOCR pipeline over test essay images and compares
the predicted digital text against Ground Truth (.txt) files.

Outputs:
- Per-sample Character Error Rate (CER) and Word Error Rate (WER)
- Overall dataset mean CER and WER
- Formatted Markdown table and CSV report ready for your thesis defense!

Usage:
    python backend/evaluate.py --images path/to/images --ground-truth path/to/gt_texts
    python backend/evaluate.py --single-image essay.jpg --single-gt essay_gt.txt
"""

import argparse
import csv
import sys
import time
from pathlib import Path

# Add backend directory to path
sys.path.append(str(Path(__file__).resolve().parent))
from pipeline import HandwritingOCRPipeline, calculate_metrics


def evaluate_single(pipeline, image_path, gt_path, num_beams=4):
    image_path = Path(image_path)
    gt_path = Path(gt_path)

    if not image_path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")
    if not gt_path.exists():
        raise FileNotFoundError(f"Ground truth not found: {gt_path}")

    gt_text = gt_path.read_text(encoding="utf-8").strip()

    t0 = time.perf_counter()
    output = pipeline.process_essay(
        str(image_path),
        num_beams=num_beams,
    )
    elapsed = time.perf_counter() - t0

    metrics = calculate_metrics(output["text"], gt_text)
    metrics["image"] = image_path.name
    metrics["lines_detected"] = output["line_count"]
    metrics["elapsed_s"] = elapsed
    metrics["hyp_text"] = output["text"]
    metrics["ref_text"] = gt_text

    return metrics


def evaluate_dataset(pipeline, images_dir, gt_dir, output_csv=None, num_beams=4):
    images_path = Path(images_dir)
    gt_path = Path(gt_dir)

    image_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    image_files = sorted([f for f in images_path.iterdir() if f.suffix.lower() in image_extensions])

    if not image_files:
        print(f"[error] No image files found in {images_dir}")
        return

    results = []
    total_char_errors = 0
    total_ref_chars = 0
    total_word_errors = 0
    total_ref_words = 0
    total_time = 0.0

    print("\n" + "=" * 70)
    print(f"RUNNING THESIS EVALUATION BENCHMARK ON {len(image_files)} ESSAY IMAGES")
    print("=" * 70)

    for idx, img_file in enumerate(image_files, 1):
        gt_file = gt_path / f"{img_file.stem}.txt"
        if not gt_file.exists():
            print(f"[{idx}/{len(image_files)}] Skip {img_file.name} (no ground truth {gt_file.name})")
            continue

        res = evaluate_single(pipeline, img_file, gt_file, num_beams=num_beams)
        results.append(res)

        total_char_errors += res["char_errors"]
        total_ref_chars += res["total_chars"]
        total_word_errors += res["word_errors"]
        total_ref_words += res["total_words"]
        total_time += res["elapsed_s"]

        print(
            f"[{idx}/{len(image_files)}] {img_file.name:<30} "
            f"Lines: {res['lines_detected']:<3} "
            f"CER: {res['CER_percent']:<8} "
            f"WER: {res['WER_percent']:<8} "
            f"Time: {res['elapsed_s']:.2f}s"
        )

    if not results:
        print("[warning] No matching ground truth files found.")
        return

    overall_cer = total_char_errors / max(1, total_ref_chars)
    overall_wer = total_word_errors / max(1, total_ref_words)
    avg_time = total_time / len(results)

    print("\n" + "=" * 70)
    print("OVERALL THESIS BENCHMARK SUMMARY")
    print("=" * 70)
    print(f"Total Evaluated Samples: {len(results)}")
    print(f"Mean Character Error Rate (CER): {overall_cer * 100:.2f}% ({total_char_errors} / {total_ref_chars} characters)")
    print(f"Mean Word Error Rate (WER):      {overall_wer * 100:.2f}% ({total_word_errors} / {total_ref_words} words)")
    print(f"Average Inference Time / Essay:  {avg_time:.2f}s")
    print("=" * 70)

    # Export to CSV if requested
    if output_csv:
        csv_path = Path(output_csv)
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["Filename", "Detected Lines", "CER (%)", "WER (%)", "Time (s)"])
            for r in results:
                writer.writerow([r["image"], r["lines_detected"], f"{r['CER']*100:.2f}", f"{r['WER']*100:.2f}", f"{r['elapsed_s']:.2f}"])
            writer.writerow(["MEAN", "-", f"{overall_cer*100:.2f}", f"{overall_wer*100:.2f}", f"{avg_time:.2f}"])
        print(f"\nSaved CSV thesis report to: {csv_path}")


def main():
    parser = argparse.ArgumentParser(description="Evaluate WriteCheck OCR with CER and WER metrics for Thesis")
    parser.add_argument("--images", default=None, help="Directory containing test images")
    parser.add_argument("--ground-truth", default=None, help="Directory containing ground truth .txt files")
    parser.add_argument("--single-image", default=None, help="Evaluate single image")
    parser.add_argument("--single-gt", default=None, help="Ground truth text file for single image")
    parser.add_argument("--csv", default="thesis_ocr_results.csv", help="Output CSV filename")
    parser.add_argument("--beams", type=int, default=4, help="Beam size (default: 4 for high accuracy)")

    args = parser.parse_args()

    if not ((args.single_image and args.single_gt) or (args.images and args.ground_truth)):
        parser.print_help()
        print("\nExamples:")
        print("  python backend/evaluate.py --single-image essay.jpg --single-gt essay.txt")
        print("  python backend/evaluate.py --images dataset/images --ground-truth dataset/gt --csv thesis_benchmark.csv")
        sys.exit(1)

    pipeline = HandwritingOCRPipeline()

    if args.single_image and args.single_gt:
        res = evaluate_single(
            pipeline,
            args.single_image,
            args.single_gt,
            num_beams=args.beams,
        )
        print("\n" + "=" * 50)
        print(f"EVALUATION: {res['image']}")
        print("=" * 50)
        print(f"Lines: {res['lines_detected']}")
        print(f"CER:   {res['CER_percent']} ({res['char_errors']} / {res['total_chars']} chars)")
        print(f"WER:   {res['WER_percent']} ({res['word_errors']} / {res['total_words']} words)")
        print(f"Time:  {res['elapsed_s']:.2f}s")
        print("=" * 50)
    elif args.images and args.ground_truth:
        evaluate_dataset(
            pipeline,
            args.images,
            args.ground_truth,
            output_csv=args.csv,
            num_beams=args.beams,
        )
    else:
        print("Usage:")
        print("  python backend/evaluate.py --single-image essay.jpg --single-gt essay.txt")
        print("  python backend/evaluate.py --images test_imgs/ --ground-truth test_gt/ --csv results.csv")


if __name__ == "__main__":
    main()
