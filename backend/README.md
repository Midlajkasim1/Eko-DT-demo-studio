# FIN Connector Backend

This is a FastAPI-based backend server designed to act as a connector between the FIN Framework and the IFC Digital Twin Viewer frontend. It exposes a REST API for the frontend to consume, providing real-time equipment data, power histories, and building information.

## Features

- **SCRAM-SHA-256 Authentication**: Securely logs into the FIN server.
- **Background Polling**: Automatically fetches real-time equipment data every 30 seconds.
- **Data Aggregation**: Computes building-wide sensor averages (temperature, humidity, CO2) and builds Fault Detection and Diagnostics (FDD) summaries.
- **Interactive Documentation**: Auto-generated Swagger UI for easy API exploration.

## Prerequisites

- Python 3.8 or higher
- `pip` (Python package installer)

## Setup and Installation

1. Navigate to the `backend` directory (if you aren't already there):
   ```bash
   cd d:\Projects\ifcviewer\backend
   ```

2. *(Optional but recommended)* Create and activate a virtual environment to keep dependencies isolated:
   ```bash
   python -m venv venv
   
   # Activate on Windows:
   venv\Scripts\activate
   
   # Activate on macOS/Linux:
   source venv/bin/activate
   ```

3. Install the required dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Configuration

The backend reads its configuration from `config.json` located in the `backend` directory. This file dictates:
- `project_name`
- `fin_server_url`
- Various endpoints for real-time and power data.
- Live point IDs to be fetched.
- `notification_db_path` (optional): where the notification SQLite database is kept. It must be outside
  this folder, so a new export unzipped over the backend keeps the history. Unset, it is
  `%LOCALAPPDATA%\EKO-DT\notifications.sqlite3` on Windows (`~/.local/share/eko-dt/` elsewhere).
  The `EKO_NOTIFICATION_DB` environment variable overrides both.
  - Keep it on a local disk (SQLite's WAL mode does not work on a network share).
  - If the backend runs as a Windows service, `%LOCALAPPDATA%` is the service account's profile
    (for LocalSystem, `C:\Windows\System32\config\systemprofile\AppData\Local`): set the path
    explicitly, e.g. `C:\ProgramData\EKO-DT\notifications.sqlite3`, on a folder only that account
    and administrators can read. On Linux/macOS a folder the backend creates is owner-only (0700)
    and the database file 0600; a folder that already exists keeps the permissions it was given.
  - Before a schema migration changes a database that holds data, a copy is written next to it:
    `<name>.v<old version>-<UTC time>.bak`. A migration that fails leaves the database as it was.
    To roll back, stop the backend and put the `.bak` file back in place of the database.
- `session_hours` (optional, default 12, at most 720): how long a sign-in lasts in a browser.

## Sign-in and user sessions

`/api/fin/login` (and `/api/auth/login`) sign the backend in to FIN with SCRAM. A successful
sign-in also opens a session for **that browser**: an `eko_session` cookie (HttpOnly,
SameSite=Strict, Secure over https, including behind a proxy that sends `X-Forwarded-Proto: https`)
for the username FIN accepted and the FIN project it was signed in for. `/api/auth/me` (or
`/api/fin/me`) answers who the browser is; the notification API refuses a browser with no valid
session (401) or one signed in for another project (409). A user id or role in a request is never
read.

- There is still one FIN connection, used for polling: the latest sign-in's credentials drive it.
- Signing out ends only that browser's session. The FIN connection closes when the last signed-in
  user signs out; a sign-out from a browser with no session changes nothing.
- Sessions are kept in memory: restarting the backend signs everyone out (as the FIN connection
  itself needs a new sign-in after a restart).
- The FIN-hosted standalone viewer (direct mode) has no Python backend, so it has no sessions and no
  SQLite store: its notifications stay in the browser. Server notifications need this backend.

## Notification state and preferences (per user)

Read, dismissed and preference state belongs to **the signed-in user on one site** (the FIN project the
session was opened for). The user id comes only from the server-side session; the site is the FIN project
the backend serves and FIN validated. A request can state neither. No session is a 401 and a session for
another project a 409 (`session_project_mismatch`); a notification or site that is not the user's answers
404 whatever the reason.

- **Events are shared, state is not.** One event per site and condition is stored once (as before). A
  user's own `notification_recipients` row is created the first time that user opens, dismisses or
  undoes something, copying the state they were seeing. Nothing a user does reaches another user.
- **The baseline.** The row each site had before per-user sign-in (`user_id = '#project:<site>'`) is
  kept as it is. It is only read: it is what every user who has not acted yet sees, so notifications
  read or dismissed before this release stay read or dismissed for everyone until a user changes that
  for themselves. A user id that starts with `#project:` is refused (400), so no sign-in can write it.
- **Preferences** are per user and site, over the site's baseline toggles (the project's earlier
  preferences): a user's own toggle wins, an unset one falls back to the site's, then to the type
  registry's default.
- **Whether critical alarm notifications are created stays a project setting**: `critical_alarm_sites`
  in `config.json` AND the site's own `alarm.critical` toggle (baseline row), both off by default.
  A user's `alarm.critical` preference never enables or disables creation: it is only that user's own
  choice (inherited from the site's toggle until they set theirs). The server leaves `alarm.critical`
  out for a user whose effective preference (or master toggle) is off: from their list and its pages,
  the unread count, mark-all-read, archive-read and by-id reads, so all of them describe the same rows
  and no state or history is written for notifications that user cannot see. A user's own `alarm.critical`
  preference only narrows what that user sees. No route writes the site setting:
  `Store.update_project_preferences` is the seam for the later administration phase, and until then an
  operator sets it in the database. `GET` and `PUT /api/notifications/v1/preferences` answer the user's
  own preferences plus a read-only `site` part, `{"critical_alarms": true | false | null}` (null: it
  could not be read, never assumed on), so the settings page can tell the two apart. A request cannot
  set it (extra fields are a 400).
- Migration 4 changes no row; it writes one `notifications.per_user_state` audit row per site with how
  many notifications and preferences were inherited as the baseline. The database is backed up first
  (see `notification_db_path`).

**Limits.** There is still one FIN polling connection, used for the latest sign-in's project. Per-user
state does not change that: events are created from that one connection's project only, so users who
signed in for another project see nothing new for theirs until it is the one served (their requests are
refused with 409 meanwhile). The unique user is the FIN username the sign-in accepted; names are
compared exactly as FIN returned them (case is not folded). Sessions are in memory (above).

## Running the Server

Start the FastAPI development server with live-reloading enabled using Uvicorn:

```bash
uvicorn main:app --reload
```

The server will start up and run locally, typically accessible at `http://127.0.0.1:8000`.

## API Documentation

FastAPI automatically generates interactive API documentation. Once the server is running, you can explore the available endpoints by visiting:

**[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)**

### Key Endpoints

- `POST /api/fin/login`: Authenticate with the FIN server using your credentials.
- `GET /api/fin/status`: Check connection status.
- `GET /api/fin/equip-live`: Retrieve live, flattened equipment data including alarms and BIM IDs.
- `GET /api/fin/power-live`: Retrieve live power metrics, carbon emissions, and sensor averages.
- `GET /api/fin/building-info`: Get full building data alongside its history.
- `POST /api/fin/logout`: Disconnect the current session.
