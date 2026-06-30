# ForgeDB Setup Guide

## Required Software

### 1. Git
Download:
https://git-scm.com/

Check:
git --version

---

### 2. Node.js (LTS)
Download:
https://nodejs.org/

Check:
node -v
npm -v

---

### 3. Angular CLI
Install:
npm install -g @angular/cli

Check:
ng version

---

### 4. .NET SDK 9
Download:
https://dotnet.microsoft.com/en-us/download

Check:
dotnet --version

---

### 5. Python 3.12+
Download:
https://www.python.org/downloads/

Check:
python --version

---

### 6. Docker Desktop
Download:
https://www.docker.com/products/docker-desktop/

Check:
docker --version
docker compose version

ForgeDB uses Docker Compose for the local PostgreSQL database so every developer can use the same local database setup.

Local PostgreSQL connection used by the backend:

```text
Host=localhost;Port=5433;Database=forgedb;Username=postgres;Password=postgres
```

The container uses PostgreSQL port `5432` internally and publishes it on host port `5433` to avoid conflicts with manually installed local PostgreSQL services.

---

### 7. VS Code
Download:
https://code.visualstudio.com/

Recommended Extensions:
- Angular Language Service
- Python
- C#
- PostgreSQL
- Thunder Client
- ESLint
- Prettier

---

# Frontend Setup

cd frontend/angular-app

npm install

npm start

---

# Backend Setup

Start local PostgreSQL:

```bash
docker compose up -d
```

Restore local .NET tools:

```bash
dotnet tool restore
```

Apply EF Core migrations:

```bash
dotnet ef database update --project backend/ForgeDB.API --startup-project backend/ForgeDB.API
```

Build backend:

```bash
dotnet build backend/ForgeDB.sln
```

Run backend API:

```bash
dotnet run --project backend/ForgeDB.API
```

For a stable local Postman URL, you can also run:

```bash
dotnet run --project backend/ForgeDB.API --urls http://localhost:5000
```

## Manual Auth and Project API Testing with Postman

Set a Postman variable:

```text
baseUrl = http://localhost:5000
```

### Register User

```text
POST {{baseUrl}}/api/auth/register
Content-Type: application/json
```

Body:

```json
{
  "firstName": "Manual",
  "lastName": "Tester",
  "email": "manual.tester@example.com",
  "password": "ForgeDB123!"
}
```

Expected result:

```text
201 Created
```

The response body contains `user.id`, `user.firstName`, `user.lastName`, `user.email`, `user.role`, and `user.createdAt`. It does not include `password` or `passwordHash`. Save `user.id` as `userId`.

If this email has already been registered, use a new email or run the login request below. Duplicate registration returns:

```text
409 Conflict
```

### Login User

```text
POST {{baseUrl}}/api/auth/login
Content-Type: application/json
```

Body:

```json
{
  "email": "manual.tester@example.com",
  "password": "ForgeDB123!"
}
```

Expected result:

```text
200 OK
```

The response body contains user data only. JWT/token authentication is not implemented yet.

Invalid credentials return:

```text
401 Unauthorized
```

### Create Project

```text
POST {{baseUrl}}/api/projects
Content-Type: application/json
```

Body:

```json
{
  "userId": {{userId}},
  "name": " Sales Analytics MVP ",
  "description": " First real ForgeDB project "
}
```

Expected result:

```text
201 Created
```

The response body contains the new project `id`, trimmed `name`, trimmed `description`, and timestamps. Save the returned `id` as `projectId`.

Use the registered user's `user.id` value for `userId`.

### Get Project by ID

```text
GET {{baseUrl}}/api/projects/{{projectId}}
```

Expected result:

```text
200 OK
```

### Get Projects by User ID

```text
GET {{baseUrl}}/api/projects/user/{{userId}}
```

Expected result:

```text
200 OK
```

The response body is an array of projects owned by that user.

### Validation Checks

Blank project name:

```text
POST {{baseUrl}}/api/projects
Content-Type: application/json
```

```json
{
  "userId": {{userId}},
  "name": "   ",
  "description": "Invalid project"
}
```

Expected result:

```text
400 Bad Request
```

Missing project:

```text
GET {{baseUrl}}/api/projects/999999
```

Expected result:

```text
404 Not Found
```

Stop local PostgreSQL:

```bash
docker compose down
```

Delete local PostgreSQL data only when a full local reset is needed:

```bash
docker compose down -v
```

---

# Python Analysis Service Setup

cd python-analysis-service

python -m venv venv

Activate venv:

Windows:
venv\Scripts\activate

Linux/macOS:
source venv/bin/activate

Install requirements:
pip install -r requirements.txt

Run:
python main.py
