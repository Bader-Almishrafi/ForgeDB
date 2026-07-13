# Final Imports Progress

- Completion: 35%
- Current branch: `feature/final-imports`
- Completed implementation: Completed real stream-based `.xlsx` import. Added authenticated workbook preview, non-empty worksheet detection, automatic single-sheet selection, required multi-sheet selection, first-10-row preview, deterministic blank/duplicate header normalization, null preservation, row/column/file/cell limits, corrupted/empty/unsupported workbook errors, shared Dataset persistence with `sourceType=excel`, Create Project integration, Add Data Source/Data Sources integration, loading/error/retry-capable UI states, and dataset-list refresh. Removed the CSV-only schema-generation filter so every confirmed dataset source reaches schema/deployment. No temporary files are created.
- Files modified: Backend dataset controller/service/interfaces/DTOs/DI registration, schema service, API project package file; new Excel reader/import records; backend Excel/ownership/schema tests and workbook fixture; frontend API models/client, Create Project and Data Sources components/templates; new frontend DOM tests; this progress file.
- Tests passed: `dotnet build backend/ForgeDB.sln`; `dotnet test backend/ForgeDB.sln` (110/110); `npm run build`; `npm test -- --watch=false` (65/65). Focused Excel backend tests: 7/7; focused Excel frontend DOM tests: 2/2.
- Live scenarios verified: None yet.
- Failures: None.
- Remaining tasks: Implement SSRF-safe API/JSON test/preview/import and UI; fix empty-schema 404; run Python tests; run the real multi-service browser workflow (including Excel analysis/cleaning/schema/deployment) and capture untracked screenshots; run final complete validation.
- Latest commit SHA: `beaa48d`
- Exact continuation instruction: Continue on `feature/final-imports` without switching branches. Implement the typed SSRF-safe HTTP GET JSON client and API test/preview/import endpoints, normalize direct/nested object arrays into the shared dataset pipeline, add backend security/persistence tests, then replace all remaining API Coming Soon UI in Create Project and Data Sources with working controls and DOM tests. Run relevant suites, update this file, and create checkpoint commit `feat: add API JSON dataset import`.

## Dependency record

- Added: `ExcelDataReader` 3.9.0 — stream-based `.xlsx` workbook parsing; MIT license; compatible with .NET 8 according to the NuGet package metadata. No temporary workbook files are created.
