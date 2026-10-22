# Browser tests (`scripts/test-*.mjs`)

These drive the real Studio in Chromium with real pointer clicks. Three of them
(`test-locate-focus`, `test-project-isolation`, `test-fin-project-switch`) sign in to a **fake** FIN backend.

## Run them safely

A test signs in with made-up credentials and rewrites the session's project settings. Against a real backend
that would replace the real FIN session, so the tests never use `npm run dev` (its `/api` proxy goes to the
real backend on :8000). Use the isolated dev server instead:

```
FAKE_PORT=8010 npm run dev:test                                   # Vite on :5175, /api -> the fake backend on :8010
APP_URL=http://127.0.0.1:5175 node scripts/test-locate-focus.mjs  # (FAKE_PORT=8010 is the default)
```

`scripts/fake-backend.mjs` starts the fake backend and stops the test **before any sign-in** unless:

- nothing already listens on its port (any listener, not only HTTP), and
- the app under test, through its own proxy, reaches *this* fake backend (it reads a random marker from it).

So a wrong `APP_URL`, a busy port, or a real backend on :8000 ends the run with an explanation and no sign-in.
Never point `FAKE_PORT` at a real backend's port. If a real sign-in is ever needed, it is for the person who owns
the credentials to do; the tests never invent or store them.

## Supported Studio widths

- **1024px and up:** the desktop layout (rail, Asset Register, model strip, docked asset panel).
- **1023px down to about 800px:** the stacked layout (asset sheet at the bottom, full-screen model).
- **Phone width (390px) is not a Studio layout.** The Studio's own 340px sidebar leaves about 50px for the
  dashboard there. Phone layouts exist for the exported viewer and are tested on the standalone dashboard only.
