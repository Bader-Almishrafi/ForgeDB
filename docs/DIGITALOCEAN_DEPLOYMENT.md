# DigitalOcean App Platform deployment

Deploy all components from `Bader-Almishrafi/ForgeDB`. Use `main` after the deployment pull request has been reviewed and merged. The paths below are relative to the repository root.

## Angular static site

| Setting | Value |
| --- | --- |
| Resource type | Static Site |
| Source directory | `/frontend/angular-app` |
| Build command | `npm ci && npm run build -- --configuration production` |
| Output directory | `dist/forgedb/browser` |
| HTTP route | `/` |
| Catch-all document | `index.html` |

The output directory is the directory containing `index.html` from a real production build. Production bundles use `/api` as their relative API base URL, so no public backend hostname is compiled into the frontend.

## .NET backend

| Setting | Value |
| --- | --- |
| Resource type | Web Service |
| Source directory | `/backend/ForgeDB.API` |
| Build command | Leave blank; the .NET buildpack runs restore and publish in Release mode |
| Run command | Leave blank; the .NET buildpack detects the ASP.NET Core web process |
| Public HTTP port | `8080` |
| HTTP route | `/api` |
| Preserve full path | Enabled (`preserve_path_prefix: true`) |
| Health check path | `/api/health` |

DigitalOcean's control panel does not currently expose full path preservation. Open **Settings > App Spec > Edit** and make the API ingress rule preserve the prefix. Keep the `/api` rule before the static site's `/` rule:

```yaml
ingress:
  rules:
  - component:
      name: forgedb-api
      preserve_path_prefix: true
    match:
      path:
        prefix: /api
  - component:
      name: forgedb-frontend
    match:
      path:
        prefix: /
```

If different component names are chosen in the control panel, substitute those names in the ingress rules. Prefix preservation is required because the controllers retain their `/api` routes.

## Python analysis service

| Setting | Value |
| --- | --- |
| Resource type | Internal Service |
| Source directory | `/python-analysis-service` |
| Run command | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Health check path | `/health` |

Do not give this component a public HTTP route. Only the .NET backend calls it, so keep it on App Platform's internal network and set `PythonAnalysis__BaseUrl` on the backend to the Python component's internal service URL. The existing Python health endpoint remains `GET /health`.

## PostgreSQL database

Add or attach a PostgreSQL database and bind its connection URL to the backend's `DATABASE_URL` runtime variable. Use the database component's DigitalOcean bindable variable rather than copying a literal connection string. The backend understands PostgreSQL URLs, including URL-encoded credentials and `sslmode=require`.

Production configuration enables `Database:ApplyMigrationsOnStartup`. The backend applies the repository's existing EF Core migrations before serving traffic and fails startup if migration execution fails.

## Environment variables

Configure these on the **.NET backend** component at run time:

| Name | Treatment |
| --- | --- |
| `DATABASE_URL` | Required; bind to the PostgreSQL database URL and mark encrypted/secret |
| `ASPNETCORE_URLS` | Required; set to `http://0.0.0.0:8080` |
| `ASPNETCORE_ENVIRONMENT` | Required; set to `Production` |
| `Jwt__Issuer` | Required |
| `Jwt__Audience` | Required |
| `Jwt__Key` | Required; mark encrypted/secret |
| `PythonAnalysis__BaseUrl` | Required; Python component's internal service URL |

`Cors__AllowedOrigins__0` and `Cors__AllowedOrigins__1` are optional. They are only needed for additional browser origins; the Angular site and API share one App Platform domain, so normal production requests are same-origin. Local defaults continue to allow `localhost:4200` and `127.0.0.1:4200`.

App Platform supplies `PORT` to the **Python service** automatically. The Angular static site needs no runtime environment variables.

Never store database credentials, the JWT key, or deployed service URLs in the repository.

## Final control-panel steps

1. Add the Angular static site, .NET web service, Python internal service, and PostgreSQL database with the settings above.
2. Add the backend runtime variables and encrypt `DATABASE_URL` and `Jwt__Key`.
3. Edit the App Spec so the `/api` ingress rule has `preserve_path_prefix: true` and precedes the `/` rule.
4. Confirm the Python component has no public ingress rule and that the backend uses its internal URL.
5. Deploy, then verify `/api/health`, `/health` from the Python component's health check, authentication, and one database-backed API request.

DigitalOcean references: [.NET buildpack](https://docs.digitalocean.com/products/app-platform/reference/buildpacks/dotnet/), [static sites](https://docs.digitalocean.com/products/app-platform/how-to/manage-static-sites/), [internal routing](https://docs.digitalocean.com/products/app-platform/how-to/manage-internal-routing/), and [App Spec](https://docs.digitalocean.com/products/app-platform/reference/app-spec/).
