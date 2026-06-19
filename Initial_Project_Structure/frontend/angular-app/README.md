# ForgeDB Frontend

Angular and Tailwind CSS implementation of the ForgeDB Stage 3 mockups.

## Implemented MVP Screens

- Dashboard with meaningful project, source, analysis, and deployment metrics
- CSV / Excel file upload
- REST API connection form
- Data analysis results and quality indicators
- Schema review with Tables, SQL Preview, and Constraints tabs
- Table relationship visualization
- PostgreSQL deployment screen

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:4200`.

## Production Build

```bash
npm run build
```

## Main Routes

- `/dashboard`
- `/data-sources`
- `/analysis`
- `/schema-review`
- `/relationships`
- `/deployment`

The interface currently uses realistic mock data. Replace the arrays in each page component with calls to the future ASP.NET Core API services when the backend endpoints are implemented.
