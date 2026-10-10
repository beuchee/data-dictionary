"""Validation of content files against the shared JSON Schemas (2020-12).

Errors name the file kind and a JSON pointer. Twin of ../../../src/validate.ts.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import cache
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

from .kinds import kind_for_path
from .parse import parse
from .schemas import load_schema


@dataclass(frozen=True)
class ValidationIssue:
    kind: str
    pointer: str  # JSON pointer, "" = document root
    keyword: str
    message: str

    def __str__(self) -> str:
        return f"{self.kind} {self.pointer or '/'}: {self.message}"


@dataclass(frozen=True)
class ValidationResult:
    valid: bool
    errors: list[ValidationIssue]


class DictionaryFormatError(ValueError):
    def __init__(self, issues: list[ValidationIssue], label: str | None = None):
        prefix = f"{label}: " if label else ""
        super().__init__(f"{prefix}{len(issues)} format error(s)\n{format_issues(issues)}")
        self.issues = issues


@cache
def _validator(kind: str) -> Draft202012Validator:
    schema = load_schema(kind)
    return Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER)


def _show(value: Any) -> str:
    try:
        text = json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        text = repr(value)
    return text if len(text) <= 80 else text[:77] + "..."


def _pointer(path) -> str:
    return "".join("/" + str(p).replace("~", "~0").replace("/", "~1") for p in path)


def _issues(kind: str, error: ValidationError) -> list[ValidationIssue]:
    kw = error.validator
    pointer = _pointer(error.absolute_path)
    if kw == "required":
        missing = [k for k in error.validator_value if k not in error.instance]
        message = f'missing required property "{missing[0] if missing else "?"}"'
    elif kw == "enum":
        message = f"must be one of {', '.join(_show(v) for v in error.validator_value)} (got {_show(error.instance)})"
    elif kw == "type":
        expected = error.validator_value
        expected = ",".join(expected) if isinstance(expected, list) else expected
        message = f"must be {expected} (got {_show(error.instance)})"
    elif kw == "pattern":
        message = f"must match pattern {error.validator_value} (got {_show(error.instance)})"
    elif kw == "format":
        message = f"must be a valid {error.validator_value} (got {_show(error.instance)})"
    elif kw in ("anyOf", "oneOf"):
        message = "does not match any of the accepted shapes (see the other errors at this location)"
    else:
        message = error.message if len(error.message) <= 160 else error.message[:157] + "..."
    if "propertyNames" in error.schema_path:
        # jsonschema reports the sub-keyword (pattern…) with the key as instance.
        kw = "propertyNames"
        message = f"invalid property name {_show(error.instance)}"
    issues = [ValidationIssue(kind, pointer, kw, message)]
    if kw in ("anyOf", "oneOf"):
        for sub in error.context:
            issues.extend(_issues(kind, sub))
    return issues


def validate(kind: str, value: Any) -> ValidationResult:
    """Validate a parsed document against the schema of `kind`."""
    errors = sorted(_validator(kind).iter_errors(value), key=lambda e: list(map(str, e.absolute_path)))
    issues = [issue for e in errors for issue in _issues(kind, e)]
    return ValidationResult(valid=not issues, errors=issues)


def assert_valid(kind: str, value: Any, label: str | None = None) -> None:
    result = validate(kind, value)
    if not result.valid:
        raise DictionaryFormatError(result.errors, label)


def validate_file(rel_path: str, text: str | bytes) -> ValidationResult:
    """Parse and validate a file given its path relative to the repo root."""
    kind = kind_for_path(rel_path)
    if kind is None:
        raise ValueError(f"Not a dictionary content file: {rel_path}")
    return validate(kind, parse(text))


def format_issues(issues: list[ValidationIssue]) -> str:
    return "\n".join(f"  {issue}" for issue in issues)
