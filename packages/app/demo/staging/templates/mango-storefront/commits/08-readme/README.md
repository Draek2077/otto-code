# Mango Threads — storefront

The web storefront for Mango Threads: small-batch everyday apparel in warm,
sun-washed color. This is the customer-facing shop — hero, catalog grid, and
cart — built deliberately light so it stays fast to iterate on.

## Stack

- [Vite](https://vite.dev) + React, no UI framework
- One hand-rolled stylesheet (`src/styles.css`), dark theme
- Catalog is plain data in `src/data/products.js` until the merch API lands

## Getting started

```bash
npm install
npm run dev
```

The dev server comes up on [http://localhost:5173](http://localhost:5173).

## Scripts

| Script            | What it does                  |
| ----------------- | ----------------------------- |
| `npm run dev`     | Start the Vite dev server     |
| `npm run build`   | Production build into `dist/` |
| `npm run preview` | Serve the production build    |

## Project layout

```
src/
  main.jsx           entry point
  App.jsx            page composition + cart state
  styles.css         the one stylesheet
  components/        Header, Hero, ProductGrid, ProductCard
  data/products.js   the summer capsule catalog
```

## Up next

- Checkout flow (in progress on `feature/checkout-flow`)
- Product search in the header
- Hook the catalog up to the merch API once it ships
