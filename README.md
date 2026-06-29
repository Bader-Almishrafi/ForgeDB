# ForgeDB

## Project Overview

ForgeDB is a platform that helps users transform raw data from Excel files, CSV files, and APIs into structured relational databases. The system analyzes uploaded data, suggests tables, relationships, and database constraints, then allows users to review and modify the proposed schema before generating a PostgreSQL database.

## STAGE 1,2,3 IN DOC

---

# Project Charter

## Project Objectives

### Purpose

ForgeDB simplifies the process of creating relational databases from raw data sources by automating data analysis and schema generation.

### Objectives

1. Develop a functional MVP within 12 weeks that can import CSV, Excel, and API data and automatically analyze its structure.

2. Suggest database tables, relationships, and constraints to reduce manual database design effort.

3. Allow users to review, edit, and approve generated schemas before creating a PostgreSQL database.

---

## Stakeholders and Team Roles

### Stakeholders

#### Internal Stakeholders

* Project Team Members
* Project Manager
* Developers
* QA Tester

#### External Stakeholders

* Software Developers
* Data Analysts
* Database Administrators (DBAs)
* Small and Medium Businesses
* Organizations managing large datasets

### Team Roles

| Role                      | Responsibilities                                       |
| ------------------------- | ------------------------------------------------------ |
| Project Manager           | Planning, scheduling, and progress tracking            |
| Team Lead                 | Technical decision-making and development coordination |
| Frontend Developer        | User interface and user experience development         |
| Backend Developer         | APIs, business logic, and database operations          |
| Data Analysis Developer   | Data analysis and schema suggestion engine             |
| QA Tester                 | Testing and validation                                 |
| Documentation Coordinator | Project documentation and reporting                    |

---

## Project Scope

### In-Scope

* Upload CSV and Excel files
* Import data from APIs
* Analyze datasets and identify data types
* Suggest database tables
* Suggest table relationships
* Suggest database constraints
* Review and modify generated schemas
* Generate PostgreSQL databases
* Basic database management dashboard

### Out-of-Scope

* NoSQL database generation
* Mobile applications
* Real-time data streaming
* AI model training
* Enterprise-scale deployment
* Advanced database administration tools

---

## Risks and Mitigation

| Risk                                 | Mitigation Strategy                           |
| ------------------------------------ | --------------------------------------------- |
| Limited experience with technologies | Allocate learning and research time           |
| Inaccurate relationship detection    | Allow manual review and editing               |
| Poor quality uploaded data           | Implement validation checks                   |
| Integration issues                   | Test modules independently before integration |
| Tight timeline                       | Prioritize MVP features                       |
| Team communication challenges        | Conduct regular meetings and task tracking    |

---

## High-Level Plan

| Stage                       | Duration    | Deliverables                                     |
| --------------------------- | ----------- | ------------------------------------------------ |
| Idea Development            | Week 1      | Project idea approved                            |
| Project Charter Development | Week 2      | Project Charter completed                        |
| Technical Documentation     | Weeks 3–4   | Architecture, database design, API documentation |
| MVP Development             | Weeks 5–10  | Functional ForgeDB MVP                           |
| Project Closure             | Weeks 11–12 | Testing, documentation, and final presentation   |

---

## Technology Stack

### Frontend

* Angular

### Backend

* ASP.NET Core (.NET)

### Data Analysis Engine

* Python

### Database

* PostgreSQL

### Version Control

* Git & GitHub

---

## Repository Structure

```text
backend/
  ForgeDB.API/
frontend/
  angular-app/
python-analysis-service/
docs/
  README.md
  stage-1/
  stage-2/
  stage-3/
```

## Local Development Paths

* Backend API: `backend/ForgeDB.API`
* Frontend Angular app: `frontend/angular-app`
* Python analysis service: `python-analysis-service`
* Documentation: `docs/`
* Stage 1 source documents: `docs/stage-1/source`
* Stage 2 source documents: `docs/stage-2/source`
* Stage 3 source documents: `docs/stage-3/source`
