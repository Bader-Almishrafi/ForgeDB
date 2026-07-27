from __future__ import annotations

from models.analysis_request import AnalyzeRequest, ColumnInput
from services.analysis_service import AnalysisService


def analyze(rows, data_type=None):
    return AnalysisService().analyze(
        AnalyzeRequest(
            datasetId=1,
            tableName="events",
            columns=[ColumnInput(name="payload", dataType=data_type)],
            rows=rows,
        )
    )


def test_nested_values_are_profiled_and_deduplicated_deterministically():
    result = analyze(
        [
            {"payload": {"b": [2, {"z": 1}], "a": 1}},
            {"payload": {"a": 1, "b": [2, {"z": 1}]}},
            {"payload": ["different", {"k": [1, 2]}]},
        ]
    )

    profile = result.columns[0]
    assert result.duplicateRowsCount == 1
    assert profile.detectedType == "string"
    assert profile.uniqueCount == 2
    assert list(profile.sampleValues[0]) == ["a", "b"]
    assert profile.topValues[0].value == {"a": 1, "b": [2, {"z": 1}]}
    assert profile.topValues[0].count == 2


def test_non_finite_numeric_values_are_not_used_for_numeric_statistics():
    result = analyze(
        [
            {"payload": float("nan")},
            {"payload": float("inf")},
            {"payload": float("-inf")},
        ],
        data_type="decimal",
    )

    profile = result.columns[0]
    assert profile.detectedType == "decimal"
    assert profile.numericStats is None
    assert profile.sampleValues == ["NaN", "Infinity", "-Infinity"]
    assert '"NaN"' in result.model_dump_json()


def test_finite_decimal_values_keep_numeric_statistics():
    result = analyze(
        [
            {"payload": "10.5"},
            {"payload": "20.5"},
            {"payload": "30.5"},
        ]
    )

    profile = result.columns[0]
    assert profile.detectedType == "decimal"
    assert profile.numericStats is not None
    assert profile.numericStats.min == 10.5
    assert profile.numericStats.max == 30.5
    assert profile.numericStats.average == 20.5
