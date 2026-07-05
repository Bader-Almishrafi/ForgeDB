import csv
from io import StringIO
from typing import Any


class FileParserService:
    def parse_file(self, file_content: bytes, file_name: str) -> dict[str, Any]:
        if not file_name.lower().endswith(".csv"):
            raise ValueError("Only CSV files are supported.")

        text = file_content.decode("utf-8-sig")
        reader = csv.DictReader(StringIO(text))

        if reader.fieldnames is None:
            raise ValueError("CSV file must contain a header row.")

        columns = [column.strip() for column in reader.fieldnames]
        if any(not column for column in columns):
            raise ValueError("CSV headers must not be empty.")

        rows = [
            {column: row.get(column) for column in columns}
            for row in reader
        ]

        return {
            "columns": columns,
            "rows": rows,
        }

