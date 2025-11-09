# LinkedIn Puppeteer Service — Advanced

Educational wrapper exposing HTTP endpoints to read LinkedIn pages with Puppeteer.
**WARNING**: Automated scraping may violate LinkedIn’s Terms of Service and laws. Use only with accounts/data you are allowed to access, at low volume.

## Endpoints
- `GET /health`
- `GET /profile?url=&login=0|1`
- `GET /profile_posts?url=&days=30&login=0|1`
- `GET /company?url=&login=0|1`
- `GET /company_posts?url=&days=30&login=0|1`
- `GET /jobs_company?url=&login=0|1`

## Env vars
`USER_AGENT` (recommended),
`LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD` (optional),
`PROXY_URL`, `PROXY_USERNAME`, `PROXY_PASSWORD` (optional),
`RATE_MIN_MS`, `RATE_MAX_MS` (optional),
`COOKIES_PATH` (optional).

## Run
```
docker build -t linkedin-adv .
docker run -p 3000:3000 -e USER_AGENT="Mozilla/5.0 ..." linkedin-adv
```
