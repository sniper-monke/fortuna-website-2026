# AGENTS.md

## What this is

Stock market simulation for a school competition. Node.js + Express + WebSocket server. No build step, no transpiler — plain CommonJS.

## Run

```
npm start        # starts on port 3000 (hardcoded in index.js:99)
```

No tests, no lint, no typecheck, no CI. There is nothing to run for verification beyond starting the server.

## Architecture

- `index.js` — Express app, WebSocket server, all HTTP routes. Entry point.
- `database.js` — `Database` class: buy/sell logic, price impact formulas, JSON file I/O.
- `config.js` — Initial stock definitions and starting cash ($1M per school).
- `database.json` — **Runtime state store** (stock prices, school portfolios, price history). Read via `require()`, written via `fs.writeFileSync()`. Committed to git.
- `html/` — Frontend pages served as static files.
- `static/` — Tailwind CSS (cached 1 year, immutable).
- `.env` — Accounts (JSON string), admin credentials, initial price arrays. Committed to git (not ignored).

## Critical gotchas

### `require()` cache for `database.json`

`database.js` reads `database.json` with `require('./database.json')` inside each method. `require()` caches JSON files — the first call reads from disk, subsequent calls return the cached copy. `index.js:55` busts the cache in `getCurrentData()` before reading, but `database.js` methods do **not** bust the cache after writing. This works only because Node.js is single-threaded and requests are sequential. Do not refactor to async/parallel without fixing cache invalidation.

### `config.js` property name mismatch (fixed)

`config.js` exports `stockPrices` (capital P). `database.js:33` used to reference `config.stockprices` (lowercase p), which was `undefined`. This has been fixed. The constructor now also writes to `database.json` on startup, so `config.js` changes take effect on restart (but reset school portfolios).

### Stock prices become strings

`buyStock` and `sellStock` store prices with `p.toFixed(2)` (string), but `config.js` defines them as numbers. Downstream code must handle both types. Compare with `parseFloat()` or `Number()`, not `===`.

### Auth model

- User login: plain cookie `ssid` = `username_password`. Verified against `process.env.accounts` (JSON string parsed inline).
- Admin endpoints: query params `?u=admin&p=somepassword` checked against `process.env.un` and `process.env.pass`.
- `.env` contains all credentials in plaintext and is committed to git.

## Stock data

15 fictional companies defined in `config.js`. Each has: name, price, sector, totalStock, risk rating. Price impact formulas are in `database.js:146-168` (buy) and `database.js:233-256` (sell). Scoring rubric is in `Backendscoring.md`.

## Frontend

All HTML pages are in `html/`. The main app page is `html/merged-portfolio.html` (served at `/index`). Admin page at `/admin`. Stock prices page at `/stockPrices`. Login at `/`.
