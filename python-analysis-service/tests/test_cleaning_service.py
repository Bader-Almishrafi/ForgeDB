from __future__ import annotations

import copy

import pytest
from pydantic import ValidationError

from models.cleaning import CleaningColumn, CleaningOperation, CleaningRequest
from services.cleaning_service import CleaningService, CleaningValidationError


def request(rows, operations, columns=None):
    return CleaningRequest(
        datasetId=1,
        versionId=1,
        tableName="orders",
        columns=columns or [CleaningColumn(name="name"), CleaningColumn(name="amount", dataType="decimal")],
        rows=rows,
        operations=operations,
    )


def operation(operation_type, column=None, **parameters):
    return CleaningOperation(operationType=operation_type, column=column, parameters=parameters)


def test_preview_leaves_original_input_unchanged_and_fills_missing_values():
    rows = [{"name": "A", "amount": "10"}, {"name": "B", "amount": None}, {"name": "C", "amount": "30"}]
    original = copy.deepcopy(rows)
    result = CleaningService().execute(request(rows, [operation("fill_missing", "amount", strategy="median")]))
    assert rows == original
    assert result.resultRows[1]["amount"] == 20
    assert result.affectedRows == 1
    assert result.affectedCells == 1


@pytest.mark.parametrize("strategy, expected", [("zero", 0), ("empty", ""), ("custom", "unknown"), ("mode", "A")])
def test_missing_value_strategies(strategy, expected):
    rows = [{"name": "A", "amount": "1"}, {"name": "A", "amount": "2"}, {"name": None, "amount": "3"}]
    kwargs = {"strategy": strategy}
    if strategy == "custom": kwargs["value"] = "unknown"
    result = CleaningService().execute(request(rows, [operation("fill_missing", "name", **kwargs)]))
    assert result.resultRows[2]["name"] == expected


def test_forward_and_backward_fill():
    rows = [{"name": "A", "amount": 1}, {"name": None, "amount": 2}, {"name": None, "amount": 3}, {"name": "B", "amount": 4}]
    forward = CleaningService().execute(request(rows, [operation("fill_missing", "name", strategy="forward_fill")]))
    backward = CleaningService().execute(request(rows, [operation("fill_missing", "name", strategy="backward_fill")]))
    assert [row["name"] for row in forward.resultRows] == ["A", "A", "A", "B"]
    assert [row["name"] for row in backward.resultRows] == ["A", "B", "B", "B"]


def test_duplicate_removal_keep_first_and_subset():
    rows = [{"name": "A", "amount": 1}, {"name": "A", "amount": 2}, {"name": "B", "amount": 2}]
    result = CleaningService().execute(request(rows, [operation("remove_duplicates", keep="first", columns=["name"])]))
    assert result.rowsRemoved == 1
    assert result.resultRows == [{"name": "A", "amount": 1}, {"name": "B", "amount": 2}]
    assert result.destructive


def test_type_conversion_reports_failures_without_silent_defaults():
    rows = [{"name": "A", "amount": "12"}, {"name": "B", "amount": "not-a-number"}]
    result = CleaningService().execute(request(rows, [operation("convert_type", "amount", targetType="integer", invalidAction="leave")]))
    assert result.resultRows[0]["amount"] == 12
    assert result.resultRows[1]["amount"] == "not-a-number"
    assert result.conversionFailures[0].rowNumber == 2


def test_invalid_date_handling_and_delete():
    columns = [CleaningColumn(name="date", dataType="string")]
    rows = [{"date": "2026-01-02"}, {"date": "bad"}]
    result = CleaningService().execute(request(rows, [operation("parse_date", "date", format="yyyy-mm-dd", invalidAction="delete")], columns))
    assert len(result.resultRows) == 1
    assert result.rowsRemoved == 1
    assert len(result.conversionFailures) == 1


def test_text_normalization_rename_and_delete_column_follow_deterministic_order():
    columns = [CleaningColumn(name="full name"), CleaningColumn(name="unused")]
    rows = [{"full name": "  JOHN   DOE ", "unused": "x"}]
    operations = [
        operation("delete_column", "unused"),
        operation("text_normalize", "name", action="collapse_spaces"),
        operation("rename_column", "full name", newName="name"),
        operation("text_normalize", "name", action="trim"),
        operation("text_normalize", "name", action="title_case"),
    ]
    result = CleaningService().execute(request(rows, operations, columns))
    assert result.resultRows == [{"name": "John Doe"}]
    assert [column.name for column in result.columns] == ["name"]
    assert result.executionOrder[0] == "operation-3"


def test_outlier_cap_uses_documented_iqr_rule():
    rows = [{"name": str(index), "amount": value} for index, value in enumerate([10, 11, 12, 13, 1000])]
    result = CleaningService().execute(request(rows, [operation("handle_outliers", "amount", action="cap", iqrMultiplier=1.5)]))
    assert result.resultRows[-1]["amount"] < 1000
    assert "IQR rule" in result.warnings[0]


def test_currency_and_percentage_normalization():
    rows = [{"name": "A", "amount": "$1,250.00"}, {"name": "B", "amount": "25%"}]
    currency = CleaningService().execute(request(rows[:1], [operation("normalize_numeric", "amount", removeThousands=True, currencySymbols=["$"], targetType="decimal")]))
    percentage = CleaningService().execute(request(rows[1:], [operation("normalize_numeric", "amount", percentage=True, targetType="decimal")]))
    assert currency.resultRows[0]["amount"] == 1250
    assert percentage.resultRows[0]["amount"] == 0.25


def test_delete_rows_condition_and_preview_samples():
    rows = [{"name": "A", "amount": 1}, {"name": "B", "amount": 5}, {"name": "C", "amount": 10}]
    result = CleaningService().execute(request(rows, [operation("delete_rows_condition", "amount", operator="greater_than", value=4)]))
    assert result.rowsRemoved == 2
    assert len(result.previewRows) == 2
    assert result.previewRows[0].after is None


def test_cannot_delete_every_column_and_rejects_invalid_requests():
    columns = [CleaningColumn(name="only")]
    with pytest.raises(CleaningValidationError):
        CleaningService().execute(request([{"only": 1}], [operation("delete_column", "only")], columns))
    with pytest.raises(ValidationError):
        request([], [])
