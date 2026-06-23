# Stage 3: Technical Documentation

Stage 3 defines the technical plan for ForgeDB. The updated technical documentation describes a workflow where ForgeDB saves imported data, analyzes it, generates DBML, supports a fixed dataset dashboard, converts approved DBML into PostgreSQL SQL, and deploys the final schema.

Note: the Stage 3 PDF file was preserved as an original submission file, but automatic text extraction did not return readable content from it. The content below is based on the readable Stage 3 DOCX files, especially the updated full version.

## Project Overview

ForgeDB helps users transform raw data from CSV files, Excel spreadsheets, and external REST APIs into structured relational database designs. The system saves imported data inside ForgeDB, analyzes data structure and quality, generates DBML, converts approved DBML into PostgreSQL SQL statements, and deploys the final schema to PostgreSQL.

The technical goal is to reduce the time and effort required to understand raw datasets and design databases manually. ForgeDB provides an automated path from data ingestion to data analysis, DBML generation, dashboard preview, SQL generation, and database deployment.

## User Stories

The Stage 3 documentation uses MoSCoW prioritization.

### Must Have

| ID | User Story |
| --- | --- |
| US-01 | As a user, I want to upload CSV and Excel files, so that I can use existing datasets to generate a database. |
| US-02 | As a user, I want to connect an external API, so that I can import data directly from external systems. |
| US-03 | As a user, I want ForgeDB to save my imported data, so that I can access and analyze it later. |
| US-04 | As a user, I want ForgeDB to analyze imported data automatically, so that I can understand its structure and quality. |
| US-05 | As a user, I want ForgeDB to detect data types, missing values, duplicate records, and possible relationships, so that I can review the dataset before generating a schema. |
| US-06 | As a user, I want ForgeDB to generate DBML from the analyzed data, so that I can review the database design in a readable format. |
| US-07 | As a user, I want ForgeDB to convert the approved DBML into PostgreSQL SQL statements, so that I can deploy the database. |
| US-08 | As a user, I want to review and modify the generated schema, so that I can customize it before deployment. |
| US-09 | As a user, I want ForgeDB to deploy the approved schema to PostgreSQL, so that the database becomes ready for use. |

### Should Have

| ID | User Story |
| --- | --- |
| US-10 | As a user, I want to view a simple fixed dashboard for each imported dataset, so that I can understand dataset size, quality, and structure. |
| US-11 | As a user, I want to visualize relationships between generated tables, so that I can better understand the database structure. |
| US-12 | As a user, I want ForgeDB to generate SQL scripts, so that I can deploy databases manually if required. |

### Could Have

| ID | User Story |
| --- | --- |
| US-13 | As a user, I want AI-assisted chart recommendations, so that ForgeDB can suggest chart types, values, aggregations, and chart titles from predefined chart templates. |
| US-14 | As a user, I want AI-assisted naming suggestions for tables and columns, so that the generated schema follows better naming practices. |
| US-15 | As a user, I want to export database documentation, so that I can share the generated database design with my team. |

### Won't Have in MVP

| ID | Scope Decision |
| --- | --- |
| US-16 | Multi-database support such as MySQL, SQL Server, and Oracle will not be included. |
| US-17 | Real-time synchronization with external APIs will not be included. |
| US-18 | A fully dynamic dashboard builder will not be included; the dashboard will use predefined fixed templates. |

## System Architecture Summary

ForgeDB follows a layered architecture with clear responsibilities:

| Layer | Responsibility |
| --- | --- |
| Angular Frontend | Handles user interface flows, dashboard pages, schema review pages, relationship views, and deployment screens. |
| ASP.NET Core Backend | Handles business logic, internal API endpoints, authentication, project management, dataset management, DBML generation flow, SQL generation flow, and deployment requests. |
| Python Analysis Engine | Analyzes imported data, detects column types, missing values, duplicates, possible relationships, and dataset statistics. |
| Optional AI Assistant | Recommends chart configurations and naming suggestions from dataset metadata. It does not generate the UI from scratch. |
| PostgreSQL Database | Stores users, projects, imported datasets, dataset rows, analysis results, DBML schemas, SQL scripts, dashboard metrics, chart recommendations, and deployment records. |

### Updated Data Flow

1. The user uploads a CSV or Excel file, or connects an external REST API.
2. Angular sends the data source request to the ASP.NET Core API.
3. ASP.NET Core saves data source metadata and imported data in PostgreSQL.
4. The backend sends dataset metadata and sample data to the Python Analysis Engine.
5. The Analysis Engine detects column types, missing values, duplicates, possible relationships, and basic statistics.
6. The analysis results and dashboard metrics are saved in PostgreSQL.
7. ForgeDB generates a DBML representation of the proposed database design.
8. The user reviews DBML, generated tables, columns, and relationships.
9. The system converts approved DBML into PostgreSQL SQL statements.
10. The approved SQL is deployed to PostgreSQL and the deployment status is saved.

## Frontend Overview

The frontend is an Angular application. The documented components include:

* Application layout components: root app, layout, sidebar, and topbar.
* Authentication screens: login and registration.
* Project screens: project list and project form.
* Dataset screens: upload data, data analysis, and dataset preview.
* Dashboard components: metric cards and chart cards.
* Schema screens: schema review, DBML editing, SQL preview, and relationship review.
* Deployment screen: deploy approved schema and display deployment result.
* Shared notification components and services.

The frontend service layer is planned around `AuthService`, `ProjectService`, `DatasetService`, `AnalysisService`, `SchemaService`, `DashboardService`, `DeploymentService`, `ApiService`, `AuthInterceptor`, and `NotificationService`.

## Backend Overview

The ASP.NET Core backend is the orchestration layer. The Stage 3 document lists controllers, application services, repositories, entities, and integration clients.

Planned backend controller responsibilities include:

* `ProjectsController`: create and retrieve projects.
* `DatasetsController`: upload datasets, import external API data, return dataset previews, list project datasets, trigger analysis, and return dataset dashboards.
* `SchemasController`: generate schemas, return saved schemas, update schema relationships, and deploy approved schemas.
* `AuthController`: handle login, registration, and token refresh in a later authentication stage.

Planned backend services include:

* `ProjectService` for project management.
* `DatasetImportService` for CSV, Excel, and API imports.
* `SchemaService` for DBML, SQL, and schema version workflows.
* `DashboardService` for fixed dataset dashboard metrics.
* `DeploymentService` for validating and deploying approved SQL.
* `PythonAnalysisClient` for HTTP communication with the Python Analysis Service.

## Python Analysis Service Overview

The Python service is responsible for data analysis and schema recommendation. The documented Python components include:

| Component | Responsibility |
| --- | --- |
| Analysis API | Receives analysis requests and coordinates profiling, type detection, relationship detection, DBML generation, and chart recommendation. |
| File Parser | Parses CSV, Excel, and JSON/API data. |
| Data Profiler | Calculates missing values, duplicate rows, column summaries, and dataset statistics. |
| Type Detector | Detects column data types and nullable fields. |
| Relationship Detector | Detects possible primary keys and foreign keys between datasets. |
| DBML Generator | Builds DBML, schema JSON, and SQL from analyzed datasets and detected relationships. |
| Chart Recommendation Engine | Suggests chart configurations using predefined templates. |

## Database Design Overview

The database design supports project management, imported data storage, dataset analysis, generated DBML schemas, dashboard metrics, chart recommendations, and PostgreSQL deployment records.

Dataset rows are planned to be stored as JSONB so ForgeDB can support different structures from different CSV, Excel, or API sources without creating a new physical table for every uploaded file.

| Table | Purpose |
| --- | --- |
| `users` | Stores ForgeDB users and supports authentication and ownership of projects. |
| `projects` | Represents user projects and stores dashboard configuration. |
| `datasets` | Represents one imported or generated table inside a project, including row counts, column counts, missing values, duplicate rows, source information, and status. |
| `dataset_columns` | Stores column metadata and analysis results such as detected type, missing values, unique values, nullability, and sample values. |
| `dataset_rows` | Stores imported rows using JSONB for flexible table structures. |
| `database_schemas` | Stores generated DBML, schema JSON, SQL, version, and status. |
| `database_deployments` | Stores deployment attempts, database names, status, and deployment timestamps. |

Key relationships:

* One user can own many projects.
* One project can contain many datasets.
* One dataset can contain many columns and rows.
* One project can have many generated database schema versions.
* One database schema can have many deployment attempts.
* Deployments are linked to projects for deployment history.

## API Endpoints Summary

The updated documentation lists a broad API surface. The current aligned backend skeleton focuses on the core flow below:

| Endpoint | Description |
| --- | --- |
| `POST /api/projects` | Creates a ForgeDB project. |
| `GET /api/projects/{projectId}` | Returns a specific project. |
| `POST /api/projects/{projectId}/datasets/upload` | Uploads a CSV or Excel dataset into a project. |
| `GET /api/projects/{projectId}/datasets` | Returns imported datasets for a project. |
| `GET /api/datasets/{datasetId}/preview` | Returns a limited preview of stored dataset rows. |
| `POST /api/datasets/{datasetId}/analyze` | Analyzes a dataset and detects structure, data types, duplicates, missing values, and relationships. |
| `GET /api/datasets/{datasetId}/dashboard` | Returns fixed dashboard metrics and chart-ready summaries for a dataset. |
| `POST /api/datasets/{datasetId}/schema/generate` | Generates a schema from the analyzed dataset. |
| `GET /api/schemas/{schemaId}` | Returns a saved schema. |
| `PUT /api/schemas/{schemaId}/relationships` | Updates reviewed relationships for a schema. |
| `POST /api/schemas/{schemaId}/deploy` | Deploys the selected approved schema to PostgreSQL. |

The Stage 3 document also mentions future or broader endpoints for API data source imports, chart recommendations, DBML updates, SQL generation, and project schema lists.

## Sequence Diagrams Summary

The Stage 3 documentation identifies four high-level sequences:

| Sequence | Summary |
| --- | --- |
| Upload and Analyze Dataset | User uploads CSV or Excel, backend saves imported data, Python analysis service analyzes it, and the system returns dataset metrics and schema suggestions. |
| Connect External API | User provides an API endpoint, data is retrieved and saved, the dataset is analyzed, and the generated schema is returned. |
| Deploy Database | Approved DBML is converted into PostgreSQL SQL and deployed to PostgreSQL. |
| Optional AI-Assisted Chart Configuration | Dataset metadata is sent to an optional AI assistant, which returns chart configurations rendered by predefined frontend chart templates. |

## SCM Strategy

The project uses Git and GitHub for version control. The documented branching strategy is intentionally simple:

* `main`: stable branch for reviewed and accepted work.
* `feature/*`: separate branches for individual features.

Each feature should be developed on a separate branch and merged into `main` through a pull request reviewed by at least one team member.

## QA and Testing Strategy

The QA strategy combines unit, integration, optional end-to-end, and manual testing.

| Testing Type | Plan |
| --- | --- |
| Unit Testing | Use xUnit for ASP.NET Core backend tests and Jasmine/Karma for Angular frontend tests. |
| Integration Testing | Use Postman and Swagger to test API endpoints and backend integration. |
| End-to-End Testing | Optionally use Cypress for full workflows such as upload data, review schema, and deploy database. |
| Manual Testing | Manually test critical workflows before release, especially upload, analysis, dashboard preview, DBML generation, SQL generation, and deployment. |

Core test scenarios include:

* Upload a valid CSV file and verify that the dataset is saved.
* Upload an Excel file and verify that columns and rows are detected correctly.
* Connect an external REST API and verify that JSON data is retrieved and saved.
* Analyze a dataset and verify detected data types, missing values, duplicates, and relationships.
* View the fixed dataset dashboard and verify row count, column count, missing values, duplicates, and data preview.
* Generate DBML and verify that tables, columns, and relationships are represented correctly.
* Generate PostgreSQL SQL from DBML and verify that the SQL script is valid.
* Deploy the approved schema to PostgreSQL and verify deployment status.

## Technical Decisions and Justifications

| Decision | Justification |
| --- | --- |
| Angular | Provides scalable component-based architecture and strong TypeScript support for dashboards and forms. |
| ASP.NET Core | Supports performant, secure RESTful API development. |
| Python Analysis Engine | Provides strong data-processing tools and leaves room for future AI integration. |
| PostgreSQL | Fits the relational database generation goal and supports JSONB dataset storage. |
| DBML | Provides a readable and editable representation of generated database designs that can be converted to SQL. |
| JSONB Dataset Storage | Allows ForgeDB to store rows from datasets with different structures without creating physical tables for every upload. |
| Fixed Dataset Dashboard | Keeps the MVP simple while still showing useful dataset insights. |
| AI-Assisted Chart Configuration | Keeps AI optional and limited to chart configuration suggestions from predefined templates. |
| REST Architecture | Provides a simple communication model between frontend and backend components. |
| Simple GitHub Flow | Reduces collaboration complexity and supports review through pull requests. |
| Testing Strategy | Combines unit, integration, optional end-to-end, and manual testing for better quality coverage. |

## MVP Scope

The Stage 3 MVP scope includes:

* Import data from CSV, Excel, and external REST APIs.
* Save imported data inside PostgreSQL using flexible JSONB row storage.
* Analyze datasets and detect column types, missing values, duplicates, and possible relationships.
* Generate DBML from analyzed datasets.
* Generate PostgreSQL SQL from approved DBML.
* Provide a simple fixed dashboard for each imported dataset.
* Deploy the approved schema to PostgreSQL.

Optional or future enhancements include AI-assisted chart configuration, AI-assisted naming suggestions, advanced dashboard building, DBML import/export, schema version comparison, generated database documentation export, support for other database engines, and real-time synchronization with external APIs.

## Original Submission Files

* ../submissions/stage-3/ForgeDB – Technical Documentation (Stage 3).docx
* ../submissions/stage-3/ForgeDB – Technical Documentation (Stage 3).pdf
* ../submissions/stage-3/ForgeDB_Technical_Documentation_Stage3_Updated1.docx
