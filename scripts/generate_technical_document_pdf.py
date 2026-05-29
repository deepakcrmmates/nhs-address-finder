#!/usr/bin/env python3
"""Generate the NHS Address Finder Technical Document PDF.

Same three-step pipeline as the parent NHS-Training-App:
  1. reportlab -> cover.pdf  (NHS sage-branded cover)
  2. Chrome    -> body.pdf   (markdown -> HTML -> headless print-to-pdf)
  3. pypdf     -> TECHNICAL_DOCUMENT.pdf  (cover + body merged)

Brand palette is the SAGE spec from docs/branding/NHS_Email_Template_Guidelines.md
(in the parent repo), not the legacy #075F50 teal — every NHS-Address-Finder
artefact follows the email template brand.

Usage:
    python3 scripts/generate_technical_document_pdf.py

Author: Deepak K Rana (CRM Mates Ltd)
"""

import re
import subprocess
import tempfile
from pathlib import Path

import markdown
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from pypdf import PdfReader, PdfWriter

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_MD = REPO_ROOT / "TECHNICAL_DOCUMENT.md"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Sage palette per NHS Email Template Guidelines §2
BRAND_DK = HexColor("#4A6B5E")        # Sage Dark
BRAND_MID = HexColor("#6B9080")       # Sage
BRAND_SAGE = HexColor("#C9D5CB")      # Sage Background
BRAND_PALE = HexColor("#EAF4EF")      # Sage Tint
BRAND_PALE_2 = HexColor("#F4F9F6")
BRAND_BORDER = HexColor("#C5DCCC")    # Border
NAVY = HexColor("#0D1E4A")            # Navy values
AMBER_DK = HexColor("#7A5A00")
INK = HexColor("#0D1E4A")
MUTED = HexColor("#6B7280")

DOC_META = {
    "kicker": "TECHNICAL DOCUMENTATION",
    "title_lines": ["NHS Address Finder", "Technical Document"],
    "subtitle": (
        "A free, partner-facing UK address lookup app. Single static HTML, "
        "two Cloudflare Workers, six upstream APIs (OS Places + OS Maps + "
        "Google Street View + MHCLG EPC + Ofcom Broadband + Ofcom Mobile), "
        "and a 4-page branded PDF report."
    ),
    "header": "NHS Address Finder - Technical Document",
    "ref_label": "v1.0 - 27 May 2026",
    "ref_date": "27 May 2026",
    "meta": [
        ("Document reference", "NHS Address Finder Technical Doc"),
        ("Client", "New Home Solutions Ltd"),
        ("Delivery partner", "CRM Mates Ltd - Deepak K Rana"),
        ("Document version", "1.0 - 27 May 2026"),
        ("Scope", "1 SPA - 2 Cloudflare Workers - 6 upstream APIs"),
        ("Status", "Sandbox live - Workers deployed - Push to GitHub pending"),
    ],
    "lead": (
        "A standalone address-lookup tool for NHS partners that turns a UK "
        "postcode into a fully branded PDF property report in under three "
        "seconds, without a backend or build step."
    ),
}


def _wrap_text(text, max_chars):
    words = text.split()
    lines, current = [], ""
    for w in words:
        candidate = (current + " " + w).strip()
        if len(candidate) > max_chars and current:
            lines.append(current)
            current = w
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def build_cover_pdf(meta: dict, out_path: Path) -> None:
    c = canvas.Canvas(str(out_path), pagesize=A4)
    w, h = A4

    # Left brand stripe
    c.setFillColor(BRAND_DK)
    c.rect(0, 0, 8 * mm, h, stroke=0, fill=1)

    # Top sage band (uses Sage Background per brand spec for header bar)
    c.setFillColor(BRAND_SAGE)
    c.rect(8 * mm, h - 55 * mm, w - 8 * mm, 55 * mm, stroke=0, fill=1)
    c.setFillColor(BRAND_DK)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(20 * mm, h - 22 * mm, "NEW HOME SOLUTIONS")
    c.setStrokeColor(BRAND_DK)
    c.setLineWidth(0.6)
    c.line(20 * mm, h - 24 * mm, 110 * mm, h - 24 * mm)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 9)
    c.drawString(20 * mm, h - 30 * mm, "Part Exchange & Assisted Move Specialists")

    # Bottom brand bar
    c.setFillColor(BRAND_DK)
    c.rect(8 * mm, 0, w - 8 * mm, 22 * mm, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(20 * mm, 13 * mm, "CRM MATES LTD - London")
    c.setFont("Helvetica", 8.5)
    c.drawString(
        20 * mm, 8 * mm, "deepak@crmmates.com - 07443 340401 - crmmates.com"
    )
    c.setFont("Helvetica-Bold", 10)
    c.drawRightString(w - 12 * mm, 13 * mm, meta["ref_label"])
    c.setFont("Helvetica", 8.5)
    c.drawRightString(w - 12 * mm, 8 * mm, meta["ref_date"])

    body_top = h - 55 * mm
    body_bottom = 22 * mm
    body_left = 20 * mm
    body_right = w - 22 * mm

    y = body_top - 24 * mm
    c.setFillColor(AMBER_DK)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(body_left, y, meta["kicker"])
    y -= 10 * mm

    c.setFillColor(BRAND_DK)
    c.setFont("Helvetica-Bold", 26)
    for line in meta["title_lines"]:
        c.drawString(body_left, y, line)
        y -= 10 * mm
    y -= 2 * mm

    c.setFillColor(MUTED)
    c.setFont("Helvetica", 12)
    sub_lines = _wrap_text(meta["subtitle"], 72)
    for line in sub_lines:
        c.drawString(body_left, y, line)
        y -= 6 * mm
    y -= 6 * mm

    # Meta table
    kv_left = body_left
    kv_right = body_right
    kv_width = kv_right - kv_left
    kv_label_w = 50 * mm
    row_h = 9 * mm
    table_top = y
    for i, (k, v) in enumerate(meta["meta"]):
        row_y_top = y
        row_y_bottom = y - row_h
        c.setFillColor(BRAND_PALE)
        c.rect(kv_left, row_y_bottom, kv_label_w, row_h, stroke=0, fill=1)
        c.setFillColor(BRAND_DK)
        c.setFont("Helvetica-Bold", 8.5)
        c.drawString(kv_left + 4 * mm, row_y_bottom + 3.2 * mm, k.upper())
        c.setFillColor(white)
        c.rect(
            kv_left + kv_label_w,
            row_y_bottom,
            kv_width - kv_label_w,
            row_h,
            stroke=0,
            fill=1,
        )
        c.setFillColor(INK)
        c.setFont("Helvetica", 9.5)
        c.drawString(kv_left + kv_label_w + 4 * mm, row_y_bottom + 3.2 * mm, v)
        if i > 0:
            c.setStrokeColor(BRAND_BORDER)
            c.line(kv_left, row_y_top, kv_right, row_y_top)
        y = row_y_bottom
    table_bottom = y
    c.setStrokeColor(BRAND_BORDER)
    c.setLineWidth(0.6)
    c.rect(
        kv_left, table_bottom, kv_width, table_top - table_bottom, stroke=1, fill=0
    )
    c.line(
        kv_left + kv_label_w, table_bottom, kv_left + kv_label_w, table_top
    )

    # Lead callout
    lead_lines = _wrap_text("In one sentence: " + meta["lead"], 86)
    lead_height = len(lead_lines) * 5.2 * mm + 10 * mm
    lead_y = body_bottom + 14 * mm
    c.setFillColor(BRAND_PALE_2)
    c.rect(
        body_left, lead_y, body_right - body_left, lead_height, stroke=0, fill=1
    )
    c.setFillColor(BRAND_DK)
    c.rect(body_left, lead_y, 1.2 * mm, lead_height, stroke=0, fill=1)
    c.setFillColor(INK)
    c.setFont("Helvetica", 10.5)
    text_y = lead_y + lead_height - 6 * mm
    for i, line in enumerate(lead_lines):
        if i == 0 and line.startswith("In one sentence:"):
            c.setFillColor(BRAND_DK)
            c.setFont("Helvetica-Bold", 10.5)
            c.drawString(body_left + 5 * mm, text_y, "In one sentence:")
            prefix_w = c.stringWidth("In one sentence: ", "Helvetica-Bold", 10.5)
            c.setFillColor(INK)
            c.setFont("Helvetica", 10.5)
            rest = line[len("In one sentence:"):].lstrip()
            c.drawString(body_left + 5 * mm + prefix_w, text_y, rest)
        else:
            c.drawString(body_left + 5 * mm, text_y, line)
        text_y -= 5.2 * mm

    c.showPage()
    c.save()


# Body CSS — sage palette, Aptos type (per brand spec §1/§2)
BODY_CSS = """
:root {
    --nhs-dk: #4A6B5E; --nhs-mid: #6B9080; --nhs-soft: #6B9080;
    --nhs-sage: #C9D5CB; --nhs-pale: #EAF4EF; --nhs-pale-2: #F4F9F6;
    --nhs-border: #C5DCCC; --amber: #C9A84C; --amber-pale: #FFF8E7;
    --amber-dk: #7A5A00; --ink: #0D1E4A; --muted: #6B7280;
    --divider: #E2E8F0; --code-bg: #1C2B24; --code-fg: #C5DCCC;
}
* { box-sizing: border-box; }
@page {
    size: A4;
    margin: 22mm 14mm 22mm 14mm;
    @top-left { content: "New Home Solutions - {DOC_HEADER}"; font-family: 'Aptos', 'Segoe UI', sans-serif; font-size: 8pt; color: #6B7280; padding-top: 4mm; }
    @top-right { content: "Confidential - May 2026"; font-family: 'Aptos', 'Segoe UI', sans-serif; font-size: 8pt; color: #6B7280; padding-top: 4mm; }
    @bottom-left { content: "CRM Mates Ltd - Deepak K Rana"; font-family: 'Aptos', 'Segoe UI', sans-serif; font-size: 8pt; color: #6B7280; }
    @bottom-right { content: "Page " counter(page); font-family: 'Aptos', 'Segoe UI', sans-serif; font-size: 8pt; color: #6B7280; }
}
html, body { margin: 0; padding: 0; }
body { font-family: 'Aptos', 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif; color: var(--ink); line-height: 1.55; font-size: 9.5pt; }

h1 { color: var(--nhs-dk); font-size: 22pt; font-weight: 700; border-bottom: 3px solid var(--nhs-dk); padding-bottom: 4mm; margin: 0 0 6mm 0; page-break-after: avoid; }
h2 { color: var(--nhs-dk); font-size: 18pt; font-weight: 700; border-bottom: 2px solid var(--nhs-dk); padding-bottom: 3mm; margin: 0 0 5mm 0; page-break-after: avoid; page-break-before: always; }
h2:first-of-type { page-break-before: avoid; }
h3 { color: var(--nhs-mid); font-size: 13pt; font-weight: 700; border-bottom: 1px solid var(--nhs-border); padding-bottom: 1.5mm; margin: 8mm 0 3mm 0; page-break-after: avoid; }
h4 { color: var(--nhs-soft); font-size: 11pt; font-weight: 700; margin: 5mm 0 2mm 0; page-break-after: avoid; }
p { margin: 0 0 3mm 0; }
strong { color: var(--ink); font-weight: 700; }
em { color: var(--muted); font-style: italic; }
a, a:visited { color: var(--nhs-dk); text-decoration: none; border-bottom: 1px dotted var(--nhs-soft); word-break: break-word; }
ul, ol { margin: 0 0 4mm 0; padding-left: 5mm; }
li { margin-bottom: 1mm; }

/* Inline code + fenced blocks */
code { font-family: 'SF Mono', 'Menlo', ui-monospace, monospace; font-size: 8.5pt; background: var(--nhs-pale); color: var(--nhs-dk); padding: 1px 5px; border-radius: 3px; border: 1px solid var(--nhs-border); word-break: break-word; }
pre { background: var(--code-bg); color: var(--code-fg); padding: 4mm 5mm; border-radius: 4px; overflow-x: hidden; font-family: 'SF Mono', 'Menlo', ui-monospace, monospace; font-size: 8pt; line-height: 1.45; margin: 3mm 0 4mm 0; page-break-inside: avoid; white-space: pre-wrap; word-break: break-word; }
pre code { background: transparent; color: inherit; border: none; padding: 0; font-size: inherit; }

/* Tables — brand-spec sage header, sage-tint label cells, white value cells */
table { border-collapse: collapse; width: 100%; margin: 3mm 0 4mm 0; font-size: 8.5pt; }
th { background: var(--nhs-dk); color: #ffffff; font-weight: 700; text-align: left; padding: 2.2mm 3mm; border: 1px solid var(--nhs-dk); font-size: 8pt; text-transform: uppercase; letter-spacing: 0.06em; }
td { padding: 2.2mm 3mm; border: 1px solid var(--nhs-border); vertical-align: top; word-wrap: break-word; overflow-wrap: break-word; color: var(--ink); }
td:first-child { background: var(--nhs-pale); color: var(--nhs-dk); font-weight: 600; }
td code { font-size: 8pt; }
table { page-break-inside: auto; }
tr { page-break-inside: avoid; page-break-after: auto; }

blockquote { border-left: 3px solid var(--amber); background: var(--amber-pale); padding: 2mm 4mm; margin: 3mm 0 4mm 0; font-size: 9.5pt; color: #7A5A00; page-break-inside: avoid; }
blockquote p { margin: 0; }
hr { border: none; border-top: 1px solid var(--nhs-border); margin: 6mm 0; }
input[type="checkbox"] { accent-color: var(--nhs-dk); margin-right: 4px; }
"""


def md_to_html_body(md_path: Path) -> str:
    text = md_path.read_text(encoding="utf-8")
    # Strip the document's H1 title (cover carries it)
    text = re.sub(r"^# .+?\n", "", text, count=1)
    # Strip the bold meta lines that follow the H1
    text = re.sub(
        r"^(?:\*\*(?:Status|Last updated|Owner|Platform|Client)\*\*:[^\n]*\n)+",
        "",
        text,
        count=1,
        flags=re.MULTILINE,
    )
    return markdown.markdown(
        text,
        extensions=["tables", "fenced_code", "attr_list", "toc", "sane_lists"],
    )


def build_body_pdf(md_path: Path, header: str, out_path: Path) -> None:
    html_body = md_to_html_body(md_path)
    css = BODY_CSS.replace("{DOC_HEADER}", header)
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>{header}</title>
<style>{css}</style></head><body>{html_body}</body></html>"""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".html", delete=False, encoding="utf-8"
    ) as f:
        f.write(html)
        html_path = Path(f.name)
    try:
        cmd = [
            CHROME,
            "--headless=new",
            "--disable-gpu",
            "--no-pdf-header-footer",
            f"--print-to-pdf={out_path}",
            str(html_path.resolve().as_uri()),
        ]
        subprocess.run(cmd, check=True, capture_output=True)
    finally:
        html_path.unlink()


def merge_pdfs(cover_pdf: Path, body_pdf: Path, out_path: Path) -> None:
    writer = PdfWriter()
    for src in (cover_pdf, body_pdf):
        reader = PdfReader(str(src))
        for page in reader.pages:
            writer.add_page(page)
    with open(out_path, "wb") as f:
        writer.write(f)


def main() -> None:
    if not SOURCE_MD.exists():
        print(f"  SKIP (missing): {SOURCE_MD}")
        return
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        cover_pdf = tmp / "cover.pdf"
        body_pdf = tmp / "body.pdf"
        final_pdf = SOURCE_MD.with_suffix(".pdf")
        print("  -> rendering cover ...")
        build_cover_pdf(DOC_META, cover_pdf)
        print("  -> rendering body (Chrome print-to-pdf) ...")
        build_body_pdf(SOURCE_MD, DOC_META["header"], body_pdf)
        print("  -> merging ...")
        merge_pdfs(cover_pdf, body_pdf, final_pdf)
        size_kb = final_pdf.stat().st_size // 1024
        print(f"  OK {final_pdf.name}  ({size_kb} KB)")


if __name__ == "__main__":
    main()
