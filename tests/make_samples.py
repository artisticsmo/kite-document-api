"""Generate 30 operator-owned, labelled PDFs. Fixture content is CC0."""
from pathlib import Path
import io
import json
import sys
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader, PdfWriter

def create(root):
    root.mkdir(parents=True, exist_ok=True)
    labels = []
    for index in range(30):
        kind = "text" if index < 10 else "table" if index < 20 else "scan" if index < 25 else "exception"
        filename = f"sample-{index:02d}.pdf"
        output = root / filename
        buffer = io.BytesIO()
        canvas = Canvas(buffer, pagesize=(612, 792))
        expected = f"Kite sample {index}"
        if kind == "scan":
            image = Image.new("RGB", (1200, 1000), "white")
            draw = ImageDraw.Draw(image)
            draw.text((90, 180), expected, font=ImageFont.load_default(size=48), fill="black")
            draw.text((90, 300), "Invoice total 125 USD", font=ImageFont.load_default(size=42), fill="black")
            canvas.drawImage(ImageReader(image), 0, 150, width=600, height=500)
        else:
            canvas.setFont("Helvetica", 16)
            canvas.drawString(50, 730, expected)
            if kind == "table":
                for y in [650, 620, 590]:
                    canvas.line(50, y, 450, y)
                for x in [50, 250, 450]:
                    canvas.line(x, 590, x, 650)
                canvas.drawString(60, 630, "Item")
                canvas.drawString(260, 630, "Quantity")
                canvas.drawString(60, 600, "Widget")
                canvas.drawString(260, 600, "3")
            elif kind == "text":
                canvas.setFont("Helvetica", 11)
                canvas.drawString(50, 690, "Independent public test document for page coordinates.")
        canvas.showPage()
        if index == 29:
            for n in range(10):
                canvas.drawString(50, 730, f"Page {n+2}")
                canvas.showPage()
        canvas.save()
        pdf = buffer.getvalue()
        error = None
        if index == 25:
            pdf = b"%PDF-corrupt-data"
            error = "corrupt_or_unreadable_pdf"
        elif index == 26:
            pdf = b"not a pdf"
            error = "unsupported_format"
        elif index == 27:
            writer = PdfWriter()
            writer.append_pages_from_reader(PdfReader(io.BytesIO(pdf)))
            writer.encrypt("private-sample-password")
            b = io.BytesIO()
            writer.write(b)
            pdf = b.getvalue()
            error = "encrypted_pdf"
        elif index == 28:
            canvas2 = Canvas(str(output), pagesize=(612, 792))
            canvas2.showPage()
            canvas2.save()
            pdf = output.read_bytes()
            error = "no_readable_output"
        elif index == 29:
            error = "page_over_limit"
        output.write_bytes(pdf)
        labels.append({"file": filename, "kind": kind, "expected_text": expected, "expected_error": error})
    (root / "labels.json").write_text(json.dumps(labels, indent=2))
    return labels

if __name__ == "__main__":
    create(Path(sys.argv[1]))
