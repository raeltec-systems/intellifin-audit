# Trusted document reader (Story 22.5). Server-owned program text: the model
# never writes, edits or selects it. It runs inside the 22.4 sandbox (no
# network, read-only inputs, bounded CPU/memory/PIDs/time/output) over exactly
# one staged original, and writes only JSON manifests and page images.
#
# Modes (the trusted caller appends `main({...})`):
#   render  - render pages [first, last] of a PDF or image original to PNG
#             (or pass an image through unchanged) and record each page's
#             text layer, if any, plus the document's page count.
#   locate  - report the text at each requested locator (spreadsheet cells,
#             Word paragraphs and table cells, email headers and parts).
#   enumerate - (Story 24.2) read one workbook sheet's header row and every
#             following row to the sheet's last row, reporting each row
#             number and the display texts of the named columns only (values,
#             never formulas; the same `cell_texts` forms as `locate`). At
#             most `max_rows` data rows are read; more is reported as
#             `truncated`, never cut silently. A text over `max_text` bytes is
#             reported as `null` (not usable), never shortened.
#
# Locator semantics (the same ones the model is told):
#   cell:Sheet!B4        one cell's displayed value forms
#   cell:Sheet!B4:C6     the range's values in row order, empty cells skipped,
#                        joined by single spaces
#   paragraph:N          the N-th (1-based) body paragraph, table text excluded
#   table:T:R:C          table T, row R, column C (1-based)
#   header:Name          every value of one email header field
#   part:N               the N-th text/* leaf part in MIME walk order
# A locator that cannot be parsed is `missing` with reason `bad_reference`.
#
# Never: run macros, follow external links, fetch anything, fall back to OCR,
# or invent text. An unreadable, encrypted, oversized or unsupported original
# is reported as such with a closed reason. Every value written is bounded.
import email
import email.policy
import json
import os
import struct
import sys
import zipfile
import zlib

INPUT = "/input"
OUTPUT = "/output"
MAX_TEXT = 64 * 1024
MAX_ZIP_ENTRIES = 10000
MAX_ZIP_BYTES = 256 * 1024 * 1024
MAX_ZIP_RATIO = 200
MAX_PIXELS = 4000 * 4000


def write(name, value):
    data = json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")
    path = os.path.join(OUTPUT, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(data)


def bounded(text):
    data = text.encode("utf-8")
    if len(data) <= MAX_TEXT:
        return text
    return data[:MAX_TEXT].decode("utf-8", "ignore")


EMAIL_FIELDS = {"from", "to", "cc", "subject", "date", "message-id", "received", "mime-version", "return-path", "reply-to", "sender"}


def is_email_head(text):
    """RFC 5322 header structure: field lines (with folded continuations)
    up to an empty line, including at least one common message field."""
    lines = text.replace("\r\n", "\n").split("\n")
    known = False
    fields = 0
    for index, line in enumerate(lines):
        if line == "":
            return fields > 0 and known
        if line.startswith((" ", "\t")):
            if index == 0:
                return False
            continue
        name, colon, _ = line.partition(":")
        if not colon or not name or not all(33 <= ord(c) <= 126 and c != ":" for c in name):
            return False
        fields += 1
        known = known or name.lower() in EMAIL_FIELDS
    # The whole head was header lines: only a short message may end there.
    return fields > 0 and known and len(text) < 4096


def kind_of(data):
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if data.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        # OLE container: legacy Office or an encrypted OOXML package.
        return "ole"
    if data.startswith(b"PK\x03\x04"):
        return "zip"
    head = data[:4096]
    try:
        text = head.decode("utf-8")
    except UnicodeDecodeError:
        return "binary"
    if is_email_head(text):
        return "email"
    return "text"


def safe_zip(path):
    """A package whose actual expansion exceeds the budget is refused. Every
    member is decompressed in bounded chunks and counted: declared sizes are
    attacker-controlled, so they are never trusted on their own."""
    try:
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_ZIP_ENTRIES:
                return None
            total = 0
            for info in infos:
                if info.flag_bits & 0x1:
                    return None  # encrypted member
                actual = 0
                with archive.open(info) as member:
                    while True:
                        chunk = member.read(1024 * 1024)
                        if not chunk:
                            break
                        actual += len(chunk)
                        total += len(chunk)
                        if total > MAX_ZIP_BYTES:
                            return None
                        # A zero compressed size never excuses an expansion.
                        if actual > max(info.compress_size, 1) * MAX_ZIP_RATIO:
                            return None
            names = {info.filename for info in infos}
    except (zipfile.BadZipFile, zlib.error, EOFError, OSError, ValueError, NotImplementedError, RuntimeError):
        return None
    if "[Content_Types].xml" not in names:
        return None
    if "xl/workbook.xml" in names:
        return "xlsx"
    if "word/document.xml" in names:
        return "docx"
    return "zip"


def png(width, height, rows):
    """Minimal PNG writer (8-bit RGB) using only the standard library."""

    def chunk(tag, body):
        out = struct.pack(">I", len(body)) + tag + body
        return out + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + row for row in rows)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def png_size(head):
    """Width and height from a PNG's IHDR, or None when it is malformed."""
    if len(head) < 24 or head[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", head[16:24])


def jpeg_size(path):
    """Width and height from a JPEG's first frame header, or None."""
    with open(path, "rb") as handle:
        data = handle.read(1024 * 1024)
    index = 2
    while index + 4 <= len(data):
        if data[index] != 0xFF:
            return None
        marker = data[index + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            index += 2
            continue
        length = struct.unpack(">H", data[index + 2:index + 4])[0]
        if length < 2:
            return None
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            if index + 9 > len(data):
                return None
            height, width = struct.unpack(">HH", data[index + 5:index + 9])
            return width, height
        index += 2 + length
    return None


def jpeg_document(path):
    """A photo becomes a one-page document so it renders like any page."""
    import pypdfium2 as pdfium

    size = jpeg_size(path)
    if size is None or size[0] <= 0 or size[1] <= 0 or size[0] * size[1] > MAX_PIXELS:
        raise ValueError("image bounds")
    document = pdfium.PdfDocument.new()
    image = pdfium.PdfImage.new(document)
    image.load_jpeg(path)
    width, height = image.get_size()
    if width <= 0 or height <= 0 or width * height > MAX_PIXELS:
        raise ValueError("image bounds")
    page = document.new_page(width, height)
    image.set_matrix(pdfium.PdfMatrix().scale(width, height))
    page.insert_obj(image)
    page.gen_content()
    return document


def render_pdf(path, first, last, max_image, jpeg=False):
    import pypdfium2 as pdfium

    try:
        document = jpeg_document(path) if jpeg else pdfium.PdfDocument(path)
    except Exception:  # encrypted, corrupt or unsupported: never guessed
        return {"status": "unreadable", "reason": "unreadable_pdf" if not jpeg else "unreadable_image"}
    count = len(document)
    pages = []
    for number in range(first, min(last, count) + 1):
        try:
            pages.append(render_page(document, number, max_image, jpeg))
        except Exception:  # this page only: never reported as too large
            pages.append({"page": number, "text_layer": None, "file": None, "reason": "render_failed"})
    return {"status": "rendered", "page_count": count, "pages": pages, "reason": None}


def render_page(document, number, max_image, jpeg):
    """One page's entry. A rendering failure raises (the caller reports
    `render_failed`); only a page no bounded scale fits is `page_too_large`."""
    import numpy

    page = document[number - 1]
    layer = None
    try:
        textpage = page.get_textpage()
        text = textpage.get_text_bounded()
        if text and text.strip():
            layer = bounded(text)
    except Exception:
        layer = None
    width, height = page.get_size()
    image = None
    scales = (1.0, 0.75, 0.5, 0.25) if jpeg else (2.0, 1.5, 1.0, 0.75, 0.5)
    for scale in scales:
        if width * scale * height * scale > MAX_PIXELS:
            continue
        bitmap = page.render(scale=scale, rev_byteorder=True)
        array = bitmap.to_numpy()
        rgb = numpy.ascontiguousarray(array[:, :, :3], dtype=numpy.uint8)
        encoded = png(rgb.shape[1], rgb.shape[0], (rgb[y].tobytes() for y in range(rgb.shape[0])))
        if len(encoded) <= max_image:
            image = encoded
            break
    entry = {"page": number, "text_layer": layer, "file": None, "reason": None}
    if image is None:
        entry["reason"] = "page_too_large"
    else:
        name = "pages/%04d.png" % number
        with open(os.path.join(OUTPUT, name), "wb") as handle:
            handle.write(image)
        entry["file"] = name
    return entry


def render(original, first, last, max_image):
    path = os.path.join(INPUT, original)
    with open(path, "rb") as handle:
        head = handle.read(4096)
    kind = kind_of(head)
    os.makedirs(os.path.join(OUTPUT, "pages"), exist_ok=True)
    if kind == "pdf":
        result = render_pdf(path, first, last, max_image)
    elif kind == "jpeg":
        result = render_pdf(path, first, last, max_image, jpeg=True)
    elif kind == "png":
        size = os.path.getsize(path)
        dimensions = png_size(head)
        entry = {"page": 1, "text_layer": None, "file": None, "reason": None}
        if dimensions is None or dimensions[0] == 0 or dimensions[1] == 0:
            write("pages.json", {"status": "unreadable", "reason": "unreadable_image"})
            return
        if first <= 1 <= last:
            if size > max_image or dimensions[0] * dimensions[1] > MAX_PIXELS:
                entry["reason"] = "page_too_large"
            else:
                name = "pages/0001.png"
                with open(path, "rb") as source, open(os.path.join(OUTPUT, name), "wb") as target:
                    target.write(source.read())
                entry["file"] = name
        result = {
            "status": "rendered",
            "page_count": 1,
            "pages": [entry] if first <= 1 <= last else [],
            "reason": None,
        }
    else:
        result = {"status": "unsupported", "reason": "not_a_paged_document"}
    write("pages.json", result)


# ---------------------------------------------------------------- locate


def number_text(value, fmt):
    """Common displayed forms of a stored number; never more than these."""
    out = []
    if isinstance(value, bool):
        return ["TRUE" if value else "FALSE"]
    if isinstance(value, int) or (isinstance(value, float) and value.is_integer()):
        whole = int(value)
        out += [str(whole), "{:,}".format(whole)]
    if isinstance(value, float):
        out.append(repr(value))
    decimals = None
    if fmt and "." in fmt:
        tail = fmt.split(".", 1)[1]
        decimals = len(tail) - len(tail.lstrip("0"))
    for places in sorted({2, decimals} - {None}):
        out += ["{:.{}f}".format(value, places), "{:,.{}f}".format(value, places)]
    if fmt and fmt.endswith("%"):
        out.append("{:.{}f}%".format(value * 100, decimals or 0))
    return out


def cell_texts(cell):
    value = cell.value
    if value is None:
        return [""]
    if isinstance(value, (int, float)):
        return number_text(value, cell.number_format)
    if hasattr(value, "isoformat"):
        return [value.isoformat(), str(value)]
    return [str(value)]


COLUMN = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def cell_ref(column, row):
    name = ""
    while column:
        column, rem = divmod(column - 1, 26)
        name = COLUMN[rem] + name
    return "%s%d" % (name, row)


def parse_ref(ref):
    """`B4` to (column, row); raises ValueError for anything else."""
    letters = ref.rstrip("0123456789")
    digits = ref[len(letters):]
    if not letters or not digits or len(letters) > 3 or not letters.isupper() or digits.startswith("0"):
        raise ValueError("bad reference")
    column = 0
    for letter in letters:
        column = column * 26 + COLUMN.index(letter) + 1
    return column, int(digits)


def locate_xlsx(path, locators):
    import openpyxl

    try:
        # Values only; macros are never loaded and external links never kept.
        # Staged inputs carry no extension; openpyxl refuses a path without one,
        # so it reads the already bounded package from an open handle.
        with open(path, "rb") as handle:
            workbook = openpyxl.load_workbook(handle, data_only=True, keep_vba=False, keep_links=False)
    except Exception:
        return None
    results = []
    for locator in locators:
        if not locator.startswith("cell:"):
            results.append({"locator": locator, "status": "missing", "texts": []})
            continue
        sheet, _, cells = locator[5:].rpartition("!")
        if sheet not in workbook.sheetnames:
            results.append({"locator": locator, "status": "missing", "texts": []})
            continue
        sheet = workbook[sheet]
        first, _, last = cells.partition(":")
        try:
            c1, r1 = parse_ref(first)
            c2, r2 = parse_ref(last or first)
        except ValueError:
            results.append({"locator": locator, "status": "missing", "reason": "bad_reference", "texts": []})
            continue
        if c1 > c2 or r1 > r2:
            results.append({"locator": locator, "status": "missing", "reason": "bad_reference", "texts": []})
            continue
        if r2 > sheet.max_row or c2 > sheet.max_column:
            results.append({"locator": locator, "status": "missing", "texts": []})
            continue
        if (c1, r1) == (c2, r2):
            texts = cell_texts(sheet.cell(row=r1, column=c1))
        else:
            values = [
                cell_texts(sheet.cell(row=r, column=c))[0]
                for r in range(r1, r2 + 1)
                for c in range(c1, c2 + 1)
            ]
            texts = [" ".join(v for v in values if v)]
        results.append({"locator": locator, "status": "found", "texts": [bounded(t) for t in texts]})
    return results


def locate_docx(path, locators):
    import docx

    try:
        document = docx.Document(path)
    except Exception:
        return None
    paragraphs = document.paragraphs
    tables = document.tables
    results = []
    for locator in locators:
        kind, _, rest = locator.partition(":")
        texts = None
        try:
            if kind == "paragraph":
                index = int(rest)
                if 1 <= index <= len(paragraphs):
                    texts = [paragraphs[index - 1].text]
            elif kind == "table":
                t, r, c = (int(v) for v in rest.split(":"))
                if 1 <= t <= len(tables):
                    rows = tables[t - 1].rows
                    if 1 <= r <= len(rows):
                        cells = rows[r - 1].cells
                        if 1 <= c <= len(cells):
                            texts = [cells[c - 1].text]
        except Exception:
            texts = None
        if texts is None:
            results.append({"locator": locator, "status": "missing", "texts": []})
        else:
            results.append({"locator": locator, "status": "found", "texts": [bounded(t) for t in texts]})
    return results


def text_parts(message):
    parts = []
    for part in message.walk():
        if part.is_multipart():
            continue
        if part.get_content_maintype() != "text":
            continue
        try:
            content = part.get_content()
        except Exception:
            content = None
        parts.append(content)
    return parts


def locate_email(path, locators):
    try:
        with open(path, "rb") as handle:
            message = email.message_from_binary_file(handle, policy=email.policy.default)
        parts = text_parts(message)
    except Exception:
        return None
    results = []
    for locator in locators:
        kind, _, rest = locator.partition(":")
        texts = None
        if kind == "header":
            try:
                values = message.get_all(rest)
                texts = [str(v) for v in values] if values else None
            except Exception:  # a header that cannot be parsed
                return "malformed"
        elif kind == "part":
            index = int(rest) if rest.isdigit() else 0
            if 1 <= index <= len(parts) and parts[index - 1] is not None:
                texts = [parts[index - 1]]
        if texts is None:
            results.append({"locator": locator, "status": "missing", "texts": []})
        else:
            results.append({"locator": locator, "status": "found", "texts": [bounded(t) for t in texts]})
    return results


def locate(original, locators):
    path = os.path.join(INPUT, original)
    with open(path, "rb") as handle:
        head = handle.read(4096)
    kind = kind_of(head)
    if kind == "zip":
        kind = safe_zip(path)
        if kind is None:
            write("located.json", {"status": "unreadable", "reason": "unsafe_package", "results": []})
            return
    if kind == "ole":
        write("located.json", {"status": "unreadable", "reason": "encrypted_or_legacy", "results": []})
        return
    reader = {"xlsx": locate_xlsx, "docx": locate_docx, "email": locate_email}.get(kind)
    if reader is None:
        write("located.json", {"status": "unsupported", "reason": "unsupported_format", "results": []})
        return
    try:
        results = reader(path, locators)
    except Exception:
        results = "malformed" if kind == "email" else None
    if results == "malformed":
        write("located.json", {"status": "unreadable", "reason": "malformed_message", "results": []})
        return
    if results is None:
        write("located.json", {"status": "unreadable", "reason": "unreadable_document", "results": []})
        return
    write("located.json", {"status": "read", "reason": None, "results": results})


# ------------------------------------------------------------- enumerate


def enumerate_xlsx(path, sheet_name, header_row, columns, max_rows, chunk_rows, max_text):
    import openpyxl

    try:
        with open(path, "rb") as handle:
            workbook = openpyxl.load_workbook(handle, data_only=True, keep_vba=False, keep_links=False)
    except Exception:
        return {"status": "unreadable", "reason": "unreadable_document"}
    if sheet_name not in workbook.sheetnames:
        return {"status": "sheet_missing", "reason": None}
    sheet = workbook[sheet_name]
    last_row = sheet.max_row
    width = sheet.max_column
    headers = []
    if header_row <= last_row:
        headers = [cell_texts(sheet.cell(row=header_row, column=c))[0] for c in range(1, width + 1)]
    indices = []
    for column in columns:
        found = [i + 1 for i, text in enumerate(headers) if text == column]
        if len(found) != 1:
            return {"status": "header_mismatch", "reason": None, "column": column}
        indices.append(found[0])
    total = max(last_row - header_row, 0)
    read = min(total, max_rows)
    chunks = []
    rows = []

    def flush():
        name = "rows/%04d.json" % len(chunks)
        write(name, rows)
        chunks.append(name)

    for number in range(header_row + 1, header_row + 1 + read):
        cells = []
        for index in indices:
            texts = cell_texts(sheet.cell(row=number, column=index))
            if any(len(t.encode("utf-8")) > max_text for t in texts):
                cells.append(None)
            else:
                cells.append(texts)
        rows.append([number, cells])
        if len(rows) == chunk_rows:
            flush()
            rows = []
    if rows:
        flush()
    return {
        "status": "read",
        "reason": None,
        "header_row": header_row,
        "last_row": last_row,
        "rows_read": read,
        "truncated": total > max_rows,
        "columns": indices,
        "chunks": chunks,
    }


def enumerate_original(original, sheet, header_row, columns, max_rows, chunk_rows, max_text):
    path = os.path.join(INPUT, original)
    with open(path, "rb") as handle:
        head = handle.read(4096)
    kind = kind_of(head)
    if kind == "zip":
        kind = safe_zip(path)
        if kind is None:
            write("enumerated.json", {"status": "unreadable", "reason": "unsafe_package"})
            return
    if kind == "ole":
        write("enumerated.json", {"status": "unreadable", "reason": "encrypted_or_legacy"})
        return
    if kind != "xlsx":
        write("enumerated.json", {"status": "unsupported", "reason": "unsupported_format"})
        return
    try:
        result = enumerate_xlsx(path, sheet, header_row, columns, max_rows, chunk_rows, max_text)
    except Exception:
        result = {"status": "unreadable", "reason": "unreadable_document"}
    write("enumerated.json", result)


def main(request):
    mode = request["mode"]
    if mode == "render":
        render(request["original"], request["first"], request["last"], request["max_image_bytes"])
    elif mode == "locate":
        locate(request["original"], request["locators"])
    elif mode == "enumerate":
        enumerate_original(
            request["original"],
            request["sheet"],
            request["header_row"],
            request["columns"],
            request["max_rows"],
            request["chunk_rows"],
            request["max_text"],
        )
    else:
        sys.exit(2)
