"""Bounded PDF extraction. stdout contains only protocol JSON; no customer data logs."""
import base64
import csv
import io
import json
import resource
import subprocess
import sys
from pypdf import PdfReader
import pdfplumber

resource.setrlimit(resource.RLIMIT_CPU, (35, 40))
resource.setrlimit(resource.RLIMIT_NOFILE, (96, 96))

def inspect(data):
    if len(data) > 10 * 1024 * 1024:
        raise ValueError("file_over_limit")
    if not data.startswith(b"%PDF-"):
        raise ValueError("unsupported_format")
    reader = PdfReader(io.BytesIO(data), strict=True)
    if reader.is_encrypted:
        raise ValueError("encrypted_pdf")
    count = len(reader.pages)
    if count < 1 or count > 10:
        raise ValueError("page_over_limit")
    return {"page_count": count, "byte_length": len(data)}

def ocr(page):
    image = page.to_image(resolution=120).original
    if image.width * image.height > 6_000_000:
        raise ValueError("page_pixel_limit")
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    p = subprocess.run(["tesseract", "stdin", "stdout", "-l", "eng", "tsv"], input=stream.getvalue(), capture_output=True, timeout=15, check=False)
    if p.returncode:
        raise ValueError("ocr_engine_failed")
    words = []
    for row in csv.DictReader(io.StringIO(p.stdout.decode()), delimiter="\t"):
        text = (row.get("text") or "").strip()
        if text:
            x, y, w, h = (int(row[k]) for k in ("left", "top", "width", "height"))
            words.append({"text": text, "bbox": [x * page.width / image.width, y * page.height / image.height, (x+w) * page.width / image.width, (y+h) * page.height / image.height], "confidence": float(row["conf"]) / 100})
    return words

def extract(data, ranges):
    meta = inspect(data)
    selected = ranges if ranges is not None else list(range(1, meta["page_count"]+1))
    if not isinstance(selected, list) or not selected or len(set(selected)) != len(selected) or any(type(n) is not int or n < 1 or n > meta["page_count"] for n in selected):
        raise ValueError("invalid_page_range")
    pages = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for number in selected:
            p = pdf.pages[number-1]
            if p.width * p.height > 2_000_000 or p.width <= 0 or p.height <= 0:
                raise ValueError("page_dimensions_over_limit")
            result = {"number": number, "width": p.width, "height": p.height, "coordinate_system": "points_top_left", "text": "", "words": [], "tables": [], "issues": []}
            try:
                words = p.extract_words()
                if words:
                    result["method"] = "pdf-text"
                    result["words"] = [{"text": w["text"], "bbox": [w["x0"], w["top"], w["x1"], w["bottom"]], "confidence": None} for w in words]
                    result["text"] = p.extract_text() or ""
                    for table in p.find_tables():
                        rows = table.extract()
                        cells = []
                        for ri, row in enumerate(table.rows):
                            for ci, box in enumerate(row.cells):
                                cells.append({"row": ri, "column": ci, "bbox": list(box) if box else None, "text": rows[ri][ci] if ri < len(rows) and ci < len(rows[ri]) else None})
                        result["tables"].append({"bbox": list(table.bbox), "cells": cells})
                else:
                    result["method"] = "tesseract-eng"
                    result["words"] = ocr(p)
                    result["text"] = " ".join(w["text"] for w in result["words"])
                    confidence = [w["confidence"] for w in result["words"]]
                    if not confidence:
                        result["issues"].append("empty_or_unreadable_page")
                    elif sum(confidence)/len(confidence) < 0.8:
                        result["issues"].append("low_ocr_confidence")
            except Exception:
                result["issues"].append("page_parse_failed")
            if len(result["text"]) > 200000 or len(result["words"]) > 30000:
                raise ValueError("page_output_over_limit")
            pages.append(result)
    if not any(p["text"].strip() for p in pages):
        raise ValueError("no_readable_output")
    return {"parser_version": "pdf-pipeline-1", "page_count": meta["page_count"], "selected_pages": selected, "pages": pages, "quality": "issues_present" if any(p["issues"] for p in pages) else "readable", "confidence_is_accuracy": False}

if __name__ == "__main__":
    try:
        wire = sys.stdin.buffer.read(15 * 1024 * 1024 + 1)
        if len(wire) > 15 * 1024 * 1024:
            raise ValueError("input_over_limit")
        request = json.loads(wire)
        data = base64.b64decode(request["pdf_base64"], validate=True)
        result = inspect(data) if request.get("mode") == "inspect" else extract(data, request.get("page_range"))
        sys.stdout.write(json.dumps({"ok": True, "result": result}))
    except Exception as e:
        allowed = {"file_over_limit", "unsupported_format", "encrypted_pdf", "page_over_limit", "invalid_page_range", "page_dimensions_over_limit", "page_output_over_limit", "no_readable_output", "input_over_limit"}
        sys.stdout.write(json.dumps({"ok": False, "error": str(e) if str(e) in allowed else "corrupt_or_unreadable_pdf"}))
        sys.exit(1)
