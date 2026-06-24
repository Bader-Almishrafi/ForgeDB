# Stage 1: Idea Development

Stage 1 introduces ForgeDB as an MVP concept: a system that converts raw CSV, Excel, and API data into an organized PostgreSQL database through automated analysis, schema suggestion, user review, and database generation.

## Project Idea

ForgeDB is described as "Raw Data to PostgreSQL - Automated Schema Generation." The idea is to help users upload or import raw data, analyze that data, suggest a database schema, allow the user to review and edit the suggestion, and finally generate a working PostgreSQL database.

The core workflow from the Stage 1 submission is:

1. Upload data.
2. Analyze the imported data.
3. Suggest a schema.
4. Let the user review the schema.
5. Generate a PostgreSQL database.

## Problem Statement

Raw data from spreadsheets, CSV files, and APIs often needs to be transformed into a relational database before it can be queried, managed, or used by applications. Designing tables, columns, data types, constraints, and relationships manually can take time and requires database design knowledge.

ForgeDB addresses this by automating the first database design pass while still keeping the user in control through a review and editing step.

## Proposed Solution

The proposed solution is a web platform with four main layers:

| Layer | Technology | Role |
| --- | --- | --- |
| Angular Frontend | Angular, TypeScript, Tailwind CSS | User interface and interactions |
| Backend API | ASP.NET Core Web API, EF Core, JWT | Business logic, authentication, orchestration |
| Analysis Service | Python FastAPI, Pandas, NumPy, Regex | Data profiling and schema suggestion |
| Database | PostgreSQL, Npgsql | Storage and generated databases |

The planned communication flow is:

1. The user uploads a file through Angular.
2. ASP.NET Core saves the file and forwards it to Python FastAPI for analysis.
3. Python returns profiling results and schema suggestions.
4. ASP.NET Core stores results in PostgreSQL and returns them to the frontend.
5. After user approval, ASP.NET Core generates and executes SQL directly on PostgreSQL.

## Target Users

The Stage 1 submission focuses on users who need to turn raw datasets into relational databases. The likely target users are:

* Developers who need a faster starting point for database design.
* Data analysts working with CSV, Excel, or API data.
* Students or teams building database-backed applications.
* Small project teams that need a quick PostgreSQL database from raw source data.

## Main Features

The Stage 1 MVP includes ten core features:

| Feature | Summary |
| --- | --- |
| User Authentication | Register and log in with JWT, manage personal projects, and use ASP.NET Core Identity with PostgreSQL. |
| Project Management | Create and manage projects, tracking files, analysis results, schemas, and status. |
| Data Import | Upload CSV and Excel files or import JSON from an API URL. |
| Data Profiling | Extract column names, row counts, data types, null ratios, unique ratios, duplicates, and examples. |
| Schema Suggestion | Suggest table names, column names, data types, primary keys, not-null fields, and unique constraints. |
| Relationship Detection | Match column names and values across tables, detect foreign key patterns, and allow manual relationship additions. |
| Data Quality Report | Report missing values, duplicate rows, format issues, and an overall quality score. |
| User Review Screen | Let users edit table names, column names, data types, primary keys, foreign keys, not-null fields, unique fields, and relationships. |
| Database Generation | Execute `CREATE TABLE`, insert data, apply constraints, and use PostgreSQL transactions with rollback support. |
| Dashboard | Show project status, table counts, row counts, data quality score, and charts. |

## Development Roadmap

The MVP plan is a 12-week roadmap:

| Time | Focus | Planned Work |
| --- | --- | --- |
| Month 1 | Foundation and data import | Project setup, authentication, user projects, file upload, CSV/Excel reading, API import, and data preview. |
| Month 2 | Analysis and schema suggestion | Data profiling, type detection, schema suggestion, primary key and foreign key detection, manual relationships, and data quality reporting. |
| Month 3 | Database generation and finalization | Review screen, SQL generation, transaction rollback support, dashboard, UI polish, testing, documentation, and final presentation. |

## Expected Outcome

The expected MVP outcome is a working ForgeDB prototype that proves the main concept. Success criteria include:

1. A user registers and logs in.
2. A user creates a project.
3. A user uploads a CSV or Excel file.
4. A user views analysis results.
5. A user views the suggested schema.
6. A user edits and adjusts schema suggestions.
7. A user clicks Generate Database.
8. The system creates a real PostgreSQL database.
9. A user views the generated tables and data.

The Stage 1 submission positions ForgeDB as an Angular, ASP.NET Core, Python FastAPI, Pandas, and PostgreSQL system for analyzing raw datasets, detecting schema structure, suggesting relationships and constraints, and generating a PostgreSQL database after user review.

## Original Submission Files

* ./source/Stage 1.pdf
