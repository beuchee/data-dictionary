"""dictionary_format: the contract for INDICATE Data Dictionary content files.

Shared JSON Schemas (packages/dictionary-format/schemas) plus a byte-exact
serializer: for every file written by the tools,
`serialize(parse(text), kind) == text`. Twin of the TypeScript package
@data-dictionary/format.
"""

from .kinds import FILE_KINDS, TRAILING_NEWLINE, FileKind, kind_for_path
from .numbers import RawFloat, to_plain
from .parse import parse
from .schemas import SCHEMAS_DIR, load_schema
from .serialize import serialize, serialize_bytes
from .validate import (
    DictionaryFormatError,
    ValidationIssue,
    ValidationResult,
    assert_valid,
    format_issues,
    validate,
    validate_file,
)

__all__ = [
    "FILE_KINDS",
    "TRAILING_NEWLINE",
    "FileKind",
    "kind_for_path",
    "RawFloat",
    "to_plain",
    "parse",
    "SCHEMAS_DIR",
    "load_schema",
    "serialize",
    "serialize_bytes",
    "DictionaryFormatError",
    "ValidationIssue",
    "ValidationResult",
    "assert_valid",
    "format_issues",
    "validate",
    "validate_file",
]
