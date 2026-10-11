"""Cell values → ids, counts, statuses; the row collector. Twin of values.ts."""

import math
import re
from dataclasses import dataclass, field

from app.services.mapping_import.text import clean

# Same bound as the vocabulary routes (and JS's safe integers).
MAX_CONCEPT_ID = 2**53 - 1

_ID_RE = re.compile(r"^(\d+)(?:\.0+)?$")
_TOKEN_SPLIT = re.compile(r"[;,| \t\r\n]+")
_FREQUENCY_RE = re.compile(r"^\d+(?:\.\d+)?$")


def parse_id(value: object) -> int | None:
    """A non-negative concept id, or None when the value is not one."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if 0 <= value <= MAX_CONCEPT_ID else None
    if isinstance(value, float):
        if math.isfinite(value) and value.is_integer() and 0 <= value <= MAX_CONCEPT_ID:
            return int(value)
        return None
    if not isinstance(value, str):
        return None
    m = _ID_RE.match(clean(value))
    if not m:
        return None
    n = int(m.group(1))
    return n if n <= MAX_CONCEPT_ID else None


@dataclass
class Targets:
    ids: list[int]
    unmapped: bool
    invalid: bool


def parse_targets(value: object) -> Targets:
    """The target ids of a cell: one or several, separated by `;`, `,`, `|` or
    spaces (deduplicated, in order)."""
    if value is None:
        return Targets([], True, False)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        id_ = parse_id(value)
        if id_ is None:
            return Targets([], False, True)
        return Targets([], True, False) if id_ == 0 else Targets([id_], False, False)
    if not isinstance(value, str):
        return Targets([], False, True)
    ids: list[int] = []
    invalid = False
    for token in _TOKEN_SPLIT.split(clean(value)):
        if not token:
            continue
        id_ = parse_id(token)
        if id_ is None:
            invalid = True
        elif id_ != 0 and id_ not in ids:
            ids.append(id_)
    return Targets(ids, not ids and not invalid, invalid)


def _number(n: float) -> int | float:
    # JSON parity with the TS side, where 12.0 is 12.
    return int(n) if n.is_integer() else n


def parse_frequency(value: object) -> int | float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return _number(float(value)) if math.isfinite(value) and value >= 0 else None
    if not isinstance(value, str):
        return None
    text_ = clean(value)
    if not _FREQUENCY_RE.match(text_):
        return None
    n = float(text_)
    return _number(n) if math.isfinite(n) else None


def text(value: object) -> str | None:
    """A cleaned, non-empty string, or None."""
    if value is None:
        return None
    if isinstance(value, bool):
        s = "true" if value else "false"
    elif isinstance(value, float):
        s = str(_number(value))
    else:
        s = value if isinstance(value, str) else str(value)
    s = clean(s)
    return s or None


def status(value: object) -> str | None:
    s = text(value)
    return s.lower() if s else None


_LEGACY_EQUIVALENCE = {
    "equal": "skos:exactMatch",
    "equivalent": "skos:closeMatch",
    "wider": "skos:broadMatch",
    "narrower": "skos:narrowMatch",
    "inexact": "skos:relatedMatch",
}


def equivalence(value: object) -> str | None:
    """Usagi's enum and Linkr's legacy values → SKOS; a CURIE passes through."""
    s = text(value)
    if not s:
        return None
    if ":" in s:
        return s
    return _LEGACY_EQUIVALENCE.get(s.lower())


# Output field order (the TS side builds rows in this order too).
SOURCE_FIELDS = (
    "sourceVocabularyId",
    "sourceCode",
    "sourceName",
    "sourceConceptId",
    "equivalence",
    "status",
    "frequency",
)


@dataclass
class RowSink:
    """Collects output rows, skipped records and warnings while a parser runs."""

    rows: list[dict] = field(default_factory=list)
    total_rows: int = 0
    skipped_rows: int = 0
    _warnings: dict[str, dict] = field(default_factory=dict)

    def read(self) -> None:
        self.total_rows += 1

    def warn(self, code: str, row: int) -> None:
        w = self._warnings.setdefault(code, {"code": code, "count": 0, "rows": []})
        w["count"] += 1
        if len(w["rows"]) < 5:
            w["rows"].append(row)

    def skip(self, code: str, row: int) -> None:
        self.skipped_rows += 1
        self.warn(code, row)

    def add(self, source: dict, targets: list[int]) -> None:
        base = {k: source[k] for k in SOURCE_FIELDS if source.get(k) is not None}
        if not targets:
            self.rows.append({**base, "targetConceptId": 0})
        for t in targets:
            self.rows.append({**base, "targetConceptId": t})

    def add_cell(self, source: dict, cell: object, row: int) -> bool:
        t = parse_targets(cell)
        if t.ids:
            if t.invalid:
                self.warn("invalid_target", row)
            self.add(source, t.ids)
            return True
        if t.invalid:
            self.skip("invalid_target", row)
            return False
        self.add(source, [])
        return True

    def result(
        self, format_: str, default_statuses: list[str] | None = None, suggested_name: str | None = None
    ) -> dict:
        mapped = [r["targetConceptId"] for r in self.rows if r["targetConceptId"] != 0]
        return {
            "format": format_,
            "rows": self.rows,
            "stats": {
                "totalRows": self.total_rows,
                "mappedRows": len(mapped),
                "unmappedRows": len(self.rows) - len(mapped),
                "skippedRows": self.skipped_rows,
                "uniqueTargets": len(set(mapped)),
            },
            "warnings": sorted(self._warnings.values(), key=lambda w: w["code"]),
            "defaultStatuses": default_statuses,
            "suggestedName": suggested_name,
        }
