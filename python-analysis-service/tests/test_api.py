from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def cleaning_request(operation):
    return {
        "datasetId": 1,
        "versionId": 7,
        "tableName": "orders",
        "columns": [
            {"name": "name", "dataType": "string"},
            {"name": "amount", "dataType": "decimal"},
        ],
        "rows": [
            {"name": "A", "amount": None},
            {"name": "B", "amount": 10},
        ],
        "operations": [operation],
    }


def test_health_endpoint_has_stable_shape():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "healthy",
        "service": "ForgeDB Python Analysis Service",
    }


def test_analyze_endpoint_handles_nested_values_and_non_finite_numbers():
    response = client.post(
        "/analyze",
        content="""
        {
          "datasetId": 1,
          "tableName": "events",
          "columns": [
            {"name": "payload"},
            {"name": "amount", "dataType": "decimal"}
          ],
          "rows": [
            {"payload": {"b": [1, 2], "a": 1}, "amount": NaN},
            {"payload": {"a": 1, "b": [1, 2]}, "amount": Infinity}
          ]
        }
        """,
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["duplicateRowsCount"] == 0
    assert body["columns"][0]["uniqueCount"] == 1
    assert body["columns"][0]["sampleValues"] == [{"a": 1, "b": [1, 2]}]
    assert body["columns"][1]["sampleValues"] == ["NaN", "Infinity"]
    assert body["columns"][1]["numericStats"] is None


@pytest.mark.parametrize("path", ["/cleaning/preview", "/cleaning/apply"])
def test_cleaning_endpoints_preserve_success_contract(path):
    response = client.post(
        path,
        json=cleaning_request(
            {
                "operationId": "fill-amount",
                "operationType": "fill_missing",
                "column": "amount",
                "parameters": {"strategy": "zero"},
            }
        ),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["datasetId"] == 1
    assert body["sourceVersionId"] == 7
    assert body["executionOrder"] == ["fill-amount"]
    assert body["resultRows"][0]["amount"] == 0
    assert body["affectedRows"] == 1


def test_cleaning_validation_error_has_stable_400_shape():
    response = client.post(
        "/cleaning/preview",
        json=cleaning_request(
            {
                "operationType": "not_supported",
                "parameters": {},
            }
        ),
    )

    assert response.status_code == 400
    assert response.json() == {
        "code": "cleaning_validation_error",
        "message": "Unsupported cleaning operation 'not_supported'.",
    }


def test_reserved_rename_has_stable_400_shape():
    response = client.post(
        "/cleaning/apply",
        json=cleaning_request(
            {
                "operationType": "rename_column",
                "column": "name",
                "parameters": {"newName": "__rowNumber"},
            }
        ),
    )

    assert response.status_code == 400
    assert response.json() == {
        "code": "cleaning_validation_error",
        "message": "Column name '__rowNumber' is reserved for internal use.",
    }


def test_reserved_request_column_is_rejected_before_execution():
    payload = cleaning_request(
        {
            "operationType": "fill_missing",
            "column": "__rowNumber",
            "parameters": {"strategy": "zero"},
        }
    )
    payload["columns"][0]["name"] = "__rowNumber"

    response = client.post("/cleaning/preview", json=payload)

    assert response.status_code == 422
    assert "reserved for internal use" in response.text
