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

### 6. PostgreSQL
Download:
https://www.postgresql.org/download/

Recommended:
pgAdmin 4 included

Check:
psql --version

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

### 8. Docker Desktop (Optional)
Download:
https://www.docker.com/products/docker-desktop/

Check:
docker --version

---

# Frontend Setup

cd frontend

npm install

ng serve

---

# Backend Setup

cd backend/ForgeDB.API

dotnet restore

dotnet run

---

# Python Analysis Service Setup

cd analysis-service

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