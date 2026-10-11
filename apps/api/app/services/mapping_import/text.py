"""Text decoding and delimited parsing. Twin of apps/web/src/lib/mapping-import/text.ts."""

import re

# The same set as the TS twin (JS `trim` and Python `strip` disagree on a few code points).
WS = " \t\r\n\f\v ﻿"
_HEADER_STRIP = re.compile(r"[ \t_-]")


def clean(value: str) -> str:
    return value.strip(WS)


def header_key(header: str) -> str:
    """Header key for name matching: lower case, no spaces, `_` or `-`."""
    return _HEADER_STRIP.sub("", clean(header).lower())


# The five bytes Windows-1252 leaves undefined decode, as in the WHATWG
# encoding the browser uses, to the C1 control of the same value.
_CP1252 = "".join(chr(b) if b in (0x81, 0x8D, 0x8F, 0x90, 0x9D) else bytes([b]).decode("cp1252") for b in range(256))


def _windows_1252(data: bytes) -> str:
    return "".join(_CP1252[b] for b in data)


def decode(data: bytes, encoding: str = "auto") -> str:
    """Bytes → text. 'auto': UTF-16 when a BOM says so, UTF-8 when valid, else
    Windows-1252. A leading BOM is dropped."""
    if encoding == "auto":
        if data[:2] == b"\xff\xfe":
            text = data[2:].decode("utf-16-le", errors="replace")
        elif data[:2] == b"\xfe\xff":
            text = data[2:].decode("utf-16-be", errors="replace")
        else:
            try:
                text = data.decode("utf-8")
            except UnicodeDecodeError:
                text = _windows_1252(data)
    elif encoding == "windows-1252":
        text = _windows_1252(data)
    else:
        text = data.decode("utf-8", errors="replace")
    return text[1:] if text.startswith("﻿") else text


_CANDIDATES = (",", "\t", ";", "|")


def detect_delimiter(text: str) -> str:
    """The candidate seen most often outside quotes on the first non-blank line
    (ties: `,` tab `;` `|`)."""
    counts = dict.fromkeys(_CANDIDATES, 0)
    in_quotes = False
    content = False
    for c in text:
        if c == '"':
            in_quotes = not in_quotes
            content = True
        elif in_quotes:
            continue
        elif c in "\n\r":
            if content:
                break
            counts = dict.fromkeys(_CANDIDATES, 0)
        else:
            if c in counts:
                counts[c] += 1
            if c not in WS and c not in counts:
                content = True
    best = ","
    for c in _CANDIDATES:
        if counts[c] > counts[best]:
            best = c
    return best


def parse_delimited(text: str, delimiter: str) -> list[list[str]]:
    """RFC 4180-ish: `"` opens quoting only at the start of a field (`""` inside
    is a quote; elsewhere a plain character), CRLF / LF / CR end a row, rows whose
    cells are all blank are dropped. Cells are returned untrimmed."""
    rows: list[list[str]] = []
    row: list[str] = []
    field: list[str] = []
    in_quotes = False
    field_start = True
    n = len(text)
    i = 0

    def end_row() -> None:
        nonlocal row, field, field_start
        row.append("".join(field))
        if any(clean(v) != "" for v in row):
            rows.append(row)
        row = []
        field = []
        field_start = True

    while i < n:
        c = text[i]
        if in_quotes:
            if c == '"':
                if i + 1 < n and text[i + 1] == '"':
                    field.append('"')
                    i += 1
                else:
                    in_quotes = False
            else:
                field.append(c)
        elif c == '"' and field_start:
            in_quotes = True
            field_start = False
        elif c == delimiter:
            row.append("".join(field))
            field = []
            field_start = True
        elif c in "\n\r":
            if c == "\r" and i + 1 < n and text[i + 1] == "\n":
                i += 1
            end_row()
        else:
            field.append(c)
            field_start = False
        i += 1
    if field or row:
        end_row()
    return rows
