from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from PIL import Image, ImageOps, UnidentifiedImageError
from transformers import TrOCRProcessor, VisionEncoderDecoderModel
from ultralytics import YOLO

import json
import os
import re
import shutil
import time
from pathlib import Path

import torch

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
MODEL_DIR = BASE_DIR / "models"

DEFAULT_YOLO_MODEL_PATH = MODEL_DIR / "yolo" / "best.pt"
LEGACY_YOLO_MODEL_PATH = BASE_DIR / "best.pt"
DEFAULT_TROCR_MODEL_PATH = MODEL_DIR / "final_model"

YOLO_CONF = float(os.getenv("YOLO_CONF", "0.25"))
YOLO_IMGSZ = int(os.getenv("YOLO_IMGSZ", "1024"))
OCR_LINE_PADDING = int(os.getenv("OCR_LINE_PADDING", "5"))
MAX_OCR_LINES = int(os.getenv("MAX_OCR_LINES", "0"))
OCR_BATCH_SIZE = max(1, int(os.getenv("OCR_BATCH_SIZE", "4")))
OCR_NUM_BEAMS = int(os.getenv("OCR_NUM_BEAMS", "4"))
OCR_EARLY_STOPPING = os.getenv("OCR_EARLY_STOPPING", "1") != "0"
OCR_DEDUP_BOXES = os.getenv("OCR_DEDUP_BOXES", "1") != "0"
TORCH_THREADS = max(1, int(os.getenv("TORCH_THREADS", str(os.cpu_count() or 1))))
TROCR_CPU_QUANTIZE = os.getenv("TROCR_CPU_QUANTIZE", "0") != "0"
TROCR_USE_CACHE = os.getenv("TROCR_USE_CACHE", "1") != "0"

torch.set_num_threads(TORCH_THREADS)


def resolve_yolo_model_path():
    configured_path = os.getenv("YOLO_MODEL_PATH")
    candidates = []

    if configured_path:
        candidates.append(Path(configured_path).expanduser())

    candidates.extend([
        DEFAULT_YOLO_MODEL_PATH,
        LEGACY_YOLO_MODEL_PATH,
    ])

    for candidate in candidates:
        if candidate.exists():
            return candidate

    searched = "\n".join(f"- {candidate}" for candidate in candidates)
    raise RuntimeError(
        "YOLO weights were not found. Put best.pt at "
        f"{DEFAULT_YOLO_MODEL_PATH} or set YOLO_MODEL_PATH.\nSearched:\n{searched}"
    )


def resolve_trocr_model_source():
    configured_path = os.getenv("TROCR_MODEL_PATH")

    if configured_path:
        return configured_path

    configured_model = os.getenv("TROCR_MODEL_NAME")

    if configured_model:
        return configured_model

    if DEFAULT_TROCR_MODEL_PATH.exists():
        return str(DEFAULT_TROCR_MODEL_PATH)

    raise RuntimeError(
        "TrOCR model folder was not found. Extract final_model to "
        f"{DEFAULT_TROCR_MODEL_PATH} or set TROCR_MODEL_PATH."
    )


def sort_line_boxes(boxes):
    return sorted(
        boxes,
        key=lambda box: (box["y1"], box["x1"]),
    )


def box_area(box):
    return max(0, box["x2"] - box["x1"]) * max(0, box["y2"] - box["y1"])


def box_intersection(box1, box2):
    width = max(
        0,
        min(box1["x2"], box2["x2"]) - max(box1["x1"], box2["x1"]),
    )
    height = max(
        0,
        min(box1["y2"], box2["y2"]) - max(box1["y1"], box2["y1"]),
    )

    return width * height


def box_iou(box1, box2):
    intersection = box_intersection(box1, box2)
    union = box_area(box1) + box_area(box2) - intersection

    if union <= 0:
        return 0

    return intersection / union


def is_duplicate_line_box(box1, box2):
    h1 = box1["y2"] - box1["y1"]
    h2 = box2["y2"] - box2["y1"]
    w1 = box1["x2"] - box1["x1"]
    w2 = box2["x2"] - box2["x1"]

    if h1 <= 0 or h2 <= 0 or w1 <= 0 or w2 <= 0:
        return False

    vertical_overlap = max(
        0,
        min(box1["y2"], box2["y2"]) - max(box1["y1"], box2["y1"]),
    )
    horizontal_overlap = max(
        0,
        min(box1["x2"], box2["x2"]) - max(box1["x1"], box2["x1"]),
    )
    vertical_overlap_ratio = vertical_overlap / min(h1, h2)
    horizontal_overlap_ratio = horizontal_overlap / min(w1, w2)

    center_y1 = (box1["y1"] + box1["y2"]) / 2
    center_y2 = (box2["y1"] + box2["y2"]) / 2
    center_y_distance = abs(center_y1 - center_y2)

    return (
        box_iou(box1, box2) >= 0.35
        or (
            vertical_overlap_ratio >= 0.65
            and horizontal_overlap_ratio >= 0.65
            and center_y_distance <= max(h1, h2) * 0.50
        )
    )


def merge_line_boxes(box1, box2):
    return {
        "x1": min(box1["x1"], box2["x1"]),
        "y1": min(box1["y1"], box2["y1"]),
        "x2": max(box1["x2"], box2["x2"]),
        "y2": max(box1["y2"], box2["y2"]),
        "confidence": max(
            box1.get("confidence", 0),
            box2.get("confidence", 0),
        ),
    }


def dedupe_line_boxes(boxes):
    deduped_boxes = []

    for box in sort_line_boxes(boxes):
        duplicate_index = None

        for index, existing_box in enumerate(deduped_boxes):
            if is_duplicate_line_box(existing_box, box):
                duplicate_index = index
                break

        if duplicate_index is None:
            deduped_boxes.append(box.copy())
        else:
            deduped_boxes[duplicate_index] = merge_line_boxes(
                deduped_boxes[duplicate_index],
                box,
            )

    return sort_line_boxes(deduped_boxes)


def crop_line_images(image, boxes):
    img_width, img_height = image.size
    line_crops = []

    for box in boxes:
        x1 = max(0, int(box["x1"]) - OCR_LINE_PADDING)
        y1 = max(0, int(box["y1"]) - OCR_LINE_PADDING)
        x2 = min(img_width, int(box["x2"]) + OCR_LINE_PADDING)
        y2 = min(img_height, int(box["y2"]) + OCR_LINE_PADDING)

        if x2 <= x1 or y2 <= y1:
            continue

        line_crops.append({
            "box": {
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
            },
            "crop": image.crop((x1, y1, x2, y2)),
        })

    return line_crops


def normalize_duplicate_text(text):
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def is_duplicate_text_line(current_line, previous_line):
    current = normalize_duplicate_text(current_line)
    previous = normalize_duplicate_text(previous_line)

    if not current or not previous:
        return False

    if current == previous:
        return True

    shorter_length = min(len(current), len(previous))
    longer_length = max(len(current), len(previous))

    if shorter_length < 12:
        return False

    return (
        shorter_length / longer_length >= 0.82
        and (current in previous or previous in current)
    )


def clean_ocr_lines(lines):
    cleaned_lines = []

    for line in lines:
        clean_line = re.sub(r"\s+", " ", line).strip()

        if not clean_line:
            continue

        if cleaned_lines and is_duplicate_text_line(clean_line, cleaned_lines[-1]):
            continue

        cleaned_lines.append(clean_line)

    return cleaned_lines


def format_essay_text(lines):
    paragraphs = []
    current_paragraph = []

    for line in clean_ocr_lines(lines):
        starts_new_paragraph = bool(
            re.match(r"^(\d+[\).]|[A-Z][\w\s]{0,30}:$)", line)
        )

        if current_paragraph and starts_new_paragraph:
            paragraphs.append(" ".join(current_paragraph))
            current_paragraph = []

        current_paragraph.append(line)

        if re.search(r"[.!?]$", line) and len(" ".join(current_paragraph)) > 180:
            paragraphs.append(" ".join(current_paragraph))
            current_paragraph = []

    if current_paragraph:
        paragraphs.append(" ".join(current_paragraph))

    return "\n\n".join(paragraphs)


def configure_trocr_kv_cache(model, enabled):
    if hasattr(model.config, "use_cache"):
        model.config.use_cache = enabled

    if hasattr(model.config, "decoder") and model.config.decoder is not None:
        model.config.decoder.use_cache = enabled

    if hasattr(model, "decoder") and hasattr(model.decoder, "config"):
        model.decoder.config.use_cache = enabled

    if hasattr(model, "generation_config"):
        model.generation_config.use_cache = enabled


def encode_stream_event(payload):
    return f"{json.dumps(payload)}\n"


def recognize_line_batches(line_crops, started_at):
    for index in range(0, len(line_crops), OCR_BATCH_SIZE):
        batch_items = line_crops[index:index + OCR_BATCH_SIZE]
        batch_images = [item["crop"] for item in batch_items]

        pixel_values = processor(
            images=batch_images,
            return_tensors="pt",
            padding=True,
        ).pixel_values.to(device)

        with torch.inference_mode():
            generated_ids = trocr_model.generate(
                pixel_values,
                use_cache=TROCR_USE_CACHE,
                num_beams=OCR_NUM_BEAMS,
                early_stopping=OCR_EARLY_STOPPING,
            )

        batch_texts = [
            text.strip()
            for text in processor.batch_decode(
                generated_ids,
                skip_special_tokens=True,
            )
        ]

        print(
            f"[ocr] trocr batch {index // OCR_BATCH_SIZE + 1} "
            f"lines={index + 1}-{index + len(batch_items)}/{len(line_crops)} "
            f"done in {time.perf_counter() - started_at:.2f}s",
            flush=True,
        )

        yield {
            "start_index": index,
            "lines": batch_texts,
            "boxes": [item["box"] for item in batch_items],
        }


def recognize_lines(line_crops, started_at):
    generated_texts = []

    for batch in recognize_line_batches(line_crops, started_at):
        generated_texts.extend(batch["lines"])

    return generated_texts


def prepare_ocr_input(file, started_at):
    safe_filename = Path(file.filename or "upload.png").name
    filepath = UPLOAD_DIR / safe_filename

    with open(filepath, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        image = ImageOps.exif_transpose(Image.open(filepath)).convert("RGB")
    except (OSError, UnidentifiedImageError) as exc:
        raise HTTPException(
            status_code=400,
            detail="Uploaded file is not a readable image.",
        ) from exc

    normalized_filepath = filepath.with_name(f"{filepath.stem}_normalized.png")
    image.save(normalized_filepath)

    print(
        f"[ocr] received={safe_filename} size={image.size}",
        flush=True,
    )

    results = yolo_model.predict(
        source=str(normalized_filepath),
        conf=YOLO_CONF,
        imgsz=YOLO_IMGSZ,
        verbose=False,
    )

    result = results[0]
    xyxy_boxes = result.boxes.xyxy.cpu().tolist()
    confidences = (
        result.boxes.conf.cpu().tolist()
        if result.boxes.conf is not None
        else []
    )

    raw_boxes = []

    for index, box in enumerate(xyxy_boxes):
        x1, y1, x2, y2 = box

        raw_boxes.append({
            "x1": float(x1),
            "y1": float(y1),
            "x2": float(x2),
            "y2": float(y2),
            "confidence": float(confidences[index]) if index < len(confidences) else 0,
        })

    print(
        f"[ocr] yolo raw_boxes={len(raw_boxes)} "
        f"done in {time.perf_counter() - started_at:.2f}s",
        flush=True,
    )

    line_boxes = (
        dedupe_line_boxes(raw_boxes)
        if OCR_DEDUP_BOXES
        else sort_line_boxes(raw_boxes)
    )

    duplicate_line_count = len(raw_boxes) - len(line_boxes)
    detected_line_count = len(line_boxes)
    truncated = MAX_OCR_LINES > 0 and detected_line_count > MAX_OCR_LINES

    if truncated:
        line_boxes = line_boxes[:MAX_OCR_LINES]

    line_crops = crop_line_images(image, line_boxes)

    print(
        f"[ocr] detected_lines={detected_line_count} "
        f"duplicates_removed={duplicate_line_count} "
        f"crops={len(line_crops)} truncated={truncated}",
        flush=True,
    )

    return {
        "raw_boxes": raw_boxes,
        "line_crops": line_crops,
        "detected_line_count": detected_line_count,
        "duplicate_line_count": duplicate_line_count,
        "truncated": truncated,
    }


# ==========================================
# FASTAPI
# ==========================================

app = FastAPI()

# ==========================================
# CORS
# ==========================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# LOAD MODELS
# ==========================================

YOLO_MODEL_PATH = resolve_yolo_model_path()
TROCR_MODEL_SOURCE = resolve_trocr_model_source()

print(f"[ocr] loading YOLO from {YOLO_MODEL_PATH}", flush=True)
yolo_model = YOLO(str(YOLO_MODEL_PATH))

print(f"[ocr] loading TrOCR from {TROCR_MODEL_SOURCE}", flush=True)
processor = TrOCRProcessor.from_pretrained(TROCR_MODEL_SOURCE)
trocr_model = VisionEncoderDecoderModel.from_pretrained(TROCR_MODEL_SOURCE)

device = "cuda" if torch.cuda.is_available() else "cpu"
trocr_model.to(device)
trocr_model.eval()

if device == "cpu" and TROCR_CPU_QUANTIZE:
    print("[ocr] applying CPU dynamic quantization to TrOCR", flush=True)
    trocr_model = torch.ao.quantization.quantize_dynamic(
        trocr_model,
        {torch.nn.Linear},
        dtype=torch.qint8,
    )

configure_trocr_kv_cache(trocr_model, TROCR_USE_CACHE)

print(
    f"[ocr] TrOCR device={device} "
    f"quantized={device == 'cpu' and TROCR_CPU_QUANTIZE} "
    f"use_cache={TROCR_USE_CACHE}",
    flush=True,
)

# ==========================================
# CREATE UPLOAD FOLDER
# ==========================================

os.makedirs(UPLOAD_DIR, exist_ok=True)

# ==========================================
# API ROUTES
# ==========================================


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "yolo_model": str(YOLO_MODEL_PATH),
        "trocr_model": str(TROCR_MODEL_SOURCE),
        "device": device,
        "yolo_imgsz": YOLO_IMGSZ,
        "max_ocr_lines": MAX_OCR_LINES,
        "ocr_batch_size": OCR_BATCH_SIZE,
        "ocr_num_beams": OCR_NUM_BEAMS,
        "ocr_early_stopping": OCR_EARLY_STOPPING,
        "ocr_dedup_boxes": OCR_DEDUP_BOXES,
        "trocr_cpu_quantized": device == "cpu" and TROCR_CPU_QUANTIZE,
        "trocr_use_cache": TROCR_USE_CACHE,
    }


@app.post("/upload")
def upload_image(file: UploadFile = File(...)):
    started_at = time.perf_counter()
    ocr_input = prepare_ocr_input(file, started_at)
    raw_boxes = ocr_input["raw_boxes"]
    line_crops = ocr_input["line_crops"]
    detected_line_count = ocr_input["detected_line_count"]
    duplicate_line_count = ocr_input["duplicate_line_count"]
    truncated = ocr_input["truncated"]

    if not raw_boxes:
        return {
            "text": "",
            "lines": [],
            "boxes": [],
            "raw_boxes": [],
            "detected_line_count": 0,
            "duplicate_line_count": 0,
            "processed_line_count": 0,
            "truncated": False,
        }

    if not line_crops:
        return {
            "text": "",
            "lines": [],
            "boxes": [],
            "raw_boxes": raw_boxes,
            "detected_line_count": detected_line_count,
            "duplicate_line_count": duplicate_line_count,
            "processed_line_count": 0,
            "truncated": truncated,
        }

    generated_texts = recognize_lines(line_crops, started_at)
    cleaned_texts = clean_ocr_lines(generated_texts)
    full_text = format_essay_text(cleaned_texts)

    print(
        f"[ocr] complete in {time.perf_counter() - started_at:.2f}s",
        flush=True,
    )

    return {
        "text": full_text,
        "lines": cleaned_texts,
        "boxes": [item["box"] for item in line_crops],
        "raw_boxes": raw_boxes,
        "detected_line_count": detected_line_count,
        "duplicate_line_count": duplicate_line_count,
        "processed_line_count": len(line_crops),
        "truncated": truncated,
    }


@app.post("/upload-stream")
def upload_image_stream(file: UploadFile = File(...)):
    started_at = time.perf_counter()
    ocr_input = prepare_ocr_input(file, started_at)
    raw_boxes = ocr_input["raw_boxes"]
    line_crops = ocr_input["line_crops"]
    detected_line_count = ocr_input["detected_line_count"]
    duplicate_line_count = ocr_input["duplicate_line_count"]
    truncated = ocr_input["truncated"]

    def event_stream():
        generated_texts = []
        generated_boxes = []

        yield encode_stream_event({
            "type": "metadata",
            "detected_line_count": detected_line_count,
            "duplicate_line_count": duplicate_line_count,
            "processed_line_count": 0,
            "truncated": truncated,
            "raw_boxes": raw_boxes,
        })

        if not line_crops:
            yield encode_stream_event({
                "type": "done",
                "text": "",
                "lines": [],
                "boxes": [],
                "raw_boxes": raw_boxes,
                "detected_line_count": detected_line_count,
                "duplicate_line_count": duplicate_line_count,
                "processed_line_count": 0,
                "truncated": truncated,
            })
            return

        for batch in recognize_line_batches(line_crops, started_at):
            generated_texts.extend(batch["lines"])
            generated_boxes.extend(batch["boxes"])
            cleaned_texts = clean_ocr_lines(generated_texts)

            yield encode_stream_event({
                "type": "lines",
                "lines": clean_ocr_lines(batch["lines"]),
                "boxes": batch["boxes"],
                "text": format_essay_text(cleaned_texts),
                "detected_line_count": detected_line_count,
                "duplicate_line_count": duplicate_line_count,
                "processed_line_count": len(generated_texts),
                "truncated": truncated,
            })

        cleaned_texts = clean_ocr_lines(generated_texts)
        full_text = format_essay_text(cleaned_texts)

        print(
            f"[ocr] complete in {time.perf_counter() - started_at:.2f}s",
            flush=True,
        )

        yield encode_stream_event({
            "type": "done",
            "text": full_text,
            "lines": cleaned_texts,
            "boxes": generated_boxes,
            "raw_boxes": raw_boxes,
            "detected_line_count": detected_line_count,
            "duplicate_line_count": duplicate_line_count,
            "processed_line_count": len(generated_texts),
            "truncated": truncated,
        })

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
