# GSD Instagram

<!-- Deployment trigger: GitHub ↔ Vercel connection refreshed. -->

An interactive frontend prototype for reviewing fresh stories and creating Instagram post concepts featuring Hank and the squirrel.

## Included flows

- Story queue with scores, category filters, edit, produce, and discard actions
- System search state with GSD research requirements
- Article-detail editor with editable post prompt, copy, and hashtags
- Carousel production, regeneration request, upload-replacement affordance, and asset history
- Instagram-style preview and archive/deduplication view

## Run locally

```bash
npm install
npm run dev
```

## Deploy to Vercel

Import the GitHub repository into Vercel. The included `vercel.json` builds the Vite app and routes client-side paths to the application entry point.

## Current scope

This is an interactive frontend MVP with seeded content. Live web research, article extraction, asset-generation providers, user authentication, and persistent storage are intentionally not wired in yet.
Deployment trigger
Verified stylesheet deployment
# Send articles to Google Sheets

The Article detail **Send for Generation** button appends a row to the configured Google Sheet with `Created`, `Status`, `Article Title`, `Source URL`, `Article Summary`, `Format`, and `Content (Suggested Prompt)`.

In Vercel, add these Production environment variables:

- `GOOGLE_GENERATION_SHEET_ID` — defaults to the GSD-Instagram generation Sheet when omitted.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` — paste the complete private-key value from the service-account JSON; Vercel accepts literal `\n` sequences.

Share the Google Sheet with the service-account email as an **Editor**. The API key stays in Vercel and is never sent to the browser.
