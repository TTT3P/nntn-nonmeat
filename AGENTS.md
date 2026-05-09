# NNTN Stock System — Codex Review Guide

## What This Is

Inventory management system for a Thai beef stew restaurant (F&B).
Production app — used daily by kitchen staff and management.

## Stack

- **Frontend**: Vanilla HTML/CSS/JS — no framework, no build step
- **Hosting**: GitHub Pages (static)
- **Backend**: Supabase Postgres via PostgREST REST API
- **Auth**: Supabase Auth (email/password), JWT stored in localStorage
- **CI**: 17 Playwright E2E tests on every PR

## Architecture

All pages are standalone HTML files that call Supabase directly from the browser.
No server-side rendering, no API gateway — just client → Supabase PostgREST.

### Database Schemas
- `public` — core tables (items, stock_counts, suppliers, catch_weight)
- `stock` — delivery system (delivery_drafts, delivery_lines)
- `cookingbook` — recipes, BOM, SOP, ingredients
- `sales_ops` — POS revenue data (FoodStory, Grab, LineMan)
- `cron` — pg_cron job management
- `net` — pg_net DLQ for webhook retries

### Shared Modules
- `auth.js` — authentication wrapper, JWT management
- `shared/nntn-shell.js` — navigation shell (header, sidebar)
- `shared/nntn-tokens.css` — design tokens (colors, spacing)
- `shared/nntn-nav-badge.js` — notification badges

### Key Pages by Area

**Stock (core)**:
- `index.html` — stock status overview
- `dashboard.html` — 4-card dashboard with filters
- `stock-form.html` — manual stock counting
- `stock-dispense.html` — dispensing + loss recording (1069 LoC)
- `po-receive.html` — purchase order + receiving (1064 LoC)
- `hub-delivery.html` — delivery notes meat+non-meat (2477 LoC)

**Meat stock**:
- `meat-stock/index.html` — monolith (2895 LoC) — receive/produce/stock/history tabs

**CookingBook**:
- `cookingbook/` — recipe management, BOM, SOP authoring
- `admin-bom.html` — BOM editor
- `admin-sop.html` — SOP 7-state workflow

**Sales**:
- `sales-ops.html` — daily revenue dashboard (1286 LoC)
- `data-pipeline.html` — POS data ingestion

**Admin**:
- `admin-items.html` — item registry CRUD
- `admin-config.html` — par level configuration

## Review Focus Areas

1. **Security** — XSS in DOM manipulation, SQL injection via PostgREST filters, auth bypass, JWT handling, RLS policy gaps
2. **Data integrity** — race conditions in stock counting, double-submit on forms, concurrent delivery writes
3. **Error handling** — network failures, Supabase downtime, missing error feedback to users
4. **Code quality** — duplicated logic across pages, inconsistent patterns, dead code
5. **Performance** — unnecessary re-fetches, large DOM manipulation, missing pagination
6. **Accessibility** — form labels, keyboard navigation, mobile responsiveness

## Known Issues

- `meat-stock/index.html` is a 2900 LoC monolith — split is planned but gated until 15/05
- `data-pipeline.html` has a P3 purpose audit pending (B7)
- Some pages have Thai variable names mixed with English

## What NOT to Flag

- No build step is intentional (GitHub Pages, no-code operator)
- localStorage for JWT is the Supabase Auth default pattern
- Thai text in UI strings is expected (Thai restaurant)
- `node_modules/` and `playwright-report/` are gitignored noise

## Running Tests

```bash
npm install
npx playwright test
```

## Database Access

Read-only via Supabase MCP or PostgREST. Project ID: `emjqulzikpxorvpaaiww`.
Schema definitions in `schema.sql`, `schema_v2.sql`, `schema_v3.sql`.
