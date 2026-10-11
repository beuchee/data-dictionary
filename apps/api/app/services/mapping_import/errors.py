ERROR_CODES = (
    "no_file",
    "unsupported_file",
    "empty_file",
    "bad_zip",
    "invalid_json",
    "unknown_sheet",
    "missing_columns",
    "missing_file",
)


class MappingImportError(ValueError):
    """A file that cannot be read as the chosen format; `code` is one of
    ERROR_CODES (the web app translates it)."""

    def __init__(self, code: str, detail: str | None = None) -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail
