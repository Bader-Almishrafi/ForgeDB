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
