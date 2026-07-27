# latency dashboard

A four-card latency dashboard. Plain HTML, plain CSS, TypeScript modules run
directly by Node — no bundler, no framework, no `node_modules`.

```bash
node --test tests/format.test.ts tests/render.test.ts
```

Open `index.html` in a browser to see it rendered. The page loads `src/app.ts` as a
module; a dev server that serves TypeScript (or any modern bundler) will run it as-is.

## Layout

| Path                     | What it holds                                                     |
| ------------------------ | ------------------------------------------------------------------ |
| `index.html`             | Document shell, `aria-live` metric region                          |
| `styles/main.css`        | Custom properties, dark mode, responsive grid, reduced-motion guard |
| `src/format.ts`          | Pure helpers: `mean`, `trendOf`, `formatNumber`, `percentChange`    |
| `src/sparkline.ts`       | Sample series to an SVG polyline, returned as a string              |
| `src/app.ts`             | Rendering and the one DOM touch, guarded so Node can import it      |
| `tests/*.test.ts`        | `node:test` suites — 18 cases, no framework                         |

## Design notes

**No DOM below `app.ts`.** `format.ts` and `sparkline.ts` are pure, so they are
testable in Node without a browser or a DOM shim. That is also why `sparklineSvg`
returns a string instead of building nodes.

**The DOM touch is guarded.** `app.ts` checks `typeof document !== "undefined"`
before querying, so importing it from a test does not throw. A test asserts that
`document` really is absent, which is what keeps the guard honest.

**Edge cases are decided, not stumbled into.** A single sample is `flat` by
definition rather than by accident. A flat series pins its sparkline to the middle
instead of dividing by zero and emitting `NaN` coordinates. A zero baseline yields
`—` rather than `Infinity%`.

**The tolerance band is a policy.** `trendOf` treats anything within 2% as flat, so
noise does not paint every card red. It is a parameter, and one test pins the
behaviour at both the default and a tighter band.
