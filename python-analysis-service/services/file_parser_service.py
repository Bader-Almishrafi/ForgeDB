"""File parsing helper used before sending rows into the analysis pipeline."""

import csv
from io import StringIO
from typing import Any


class FileParserService:
    """Parse uploaded source files into columns and row dictionaries."""

    def parse_file(self, file_content: bytes, file_name: str) -> dict[str, Any]:
        """Parse a CSV upload and return normalized headers with row data."""
        if not file_name.lower().endswith(".csv"):
            raise ValueError("Only CSV files are supported.")

        # utf-8-sig handles CSV files exported with a UTF-8 byte-order mark.
        text = file_content.decode("utf-8-sig")
        reader = csv.DictReader(StringIO(text))

        if reader.fieldnames is None:
            raise ValueError("CSV file must contain a header row.")

        # Header names are trimmed so downstream model validation receives clean names.
        columns = [column.strip() for column in reader.fieldnames]
        if any(not column for column in columns):
            raise ValueError("CSV headers must not be empty.")

        # Keep row values as strings here; type inference happens later in AnalysisService.
        rows = [
            {column: row.get(column) for column in columns}
            for row in reader
        ]

        return {
            "columns": columns,
            "rows": rows,
        }

