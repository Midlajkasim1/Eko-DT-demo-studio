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
- **Which routes need a session.** Every route that reads FIN data or steers the shared connection needs the
  browser's own session cookie, not merely a backend that someone else connected: live data (`equip-live`,
  `power-live`, `power-history`, `pmu-live`, `alarms`, `workorders`, `building-info`, `alarm-history`,
  `his-points`, `point-history`), `eval`, `file`, `projects`, `resources`, `validate-mapping` and
  `project-settings` (GET and POST). A browser without one gets 401. Public on purpose: `/login`,
  `/project.json`, the models, textures and static viewer, `status`, `auth/status`, `config`, `mapping-schema`,
  `documents`, and the sign-in and sign-out routes themselves.
- **A failed sign-in changes nothing.** FIN is asked first, with a client of its own. Only a success replaces the
  shared client, applies the project's settings, stops and restarts polling and empties the caches. A wrong
  password (anyone's) no longer disconnects the signed-in users.
- **FIN credentials go only to the FIN server.** A request to another host (an absolute URL in configuration) is
  refused. A user's own `eval` or `point-history` request that FIN refuses (401/403) answers that request with
  403; it no longer marks the shared FIN session as ended for everybody.
- **A project switch stops the old polling first**, so a poll still running cannot record alarms and
  notifications for the old project under the new one.
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
- **Alarm and FIN-connection notifications are automatic.** A project FIN validated makes its own notifications from the polling
  that already runs; nothing is switched on by hand (no Studio setting, no site toggle, no administrator step). Each project's
  events belong to that project's `site_id` and no other, and everyone signed in for it (superuser, technician, any role) sees the same
  list: roles are never read when listing, only the user's own read/dismissed state and own "hide this type" switches differ.
  - **Alarms** (`alarm.critical`, `alarm.warning`) are graded by the project's own `finSeverityBands`; no threshold is in code. A
    project with no bands grades every alarm "info", which is not notified, and the panel says so. One row per open FIN alarm, keyed
    by FIN's own alarm id (an alarm with no id is not notified), held while FIN still reports it. When FIN stops reporting it the row
    resolves and an `alarm.cleared` event says how long it lasted (not when it was only re-graded between critical and warning). An alarm
    that returns within 24 hours of clearing also gets an `alarm.reraised` event next to its new row; later than that it is a new alarm.
    Polling again changes nothing (Store.condition deduplicates on site + asset + type + state).
  - **FIN connection** (`int.connector_down`, `int.connector_restored`): the client records, per read, why it failed (`fin_client.py`
    `_fetch`: session ended by a 401/403, timeout, network error, server error; any other HTTP answer, or an error grid inside a 200, is
    FIN answering and is not a link failure), when ANY read last succeeded (a poll, a live point, a user's action) and whether the
    latest **realtime poll** (equipment, points and alarms read together) got no answer from FIN to every one of its reads. Only that poll
    can be a failed poll. The link is reported lost, once per outage, at once for an ended session, otherwise after three failed realtime
    polls in a row or about 90 seconds without any successful read (`LINK_FAILED_POLLS`, `LINK_SILENCE_S` in `main.py`). The alarm loop
    never counts a failure (its query failing says nothing about the link), a user's failing read never counts, one failing query is
    not a failed poll while another read works, and a read that succeeded since the previous poll, whoever made it, means FIN is
    answering. After a reported loss, the next successful read says "restored" once, with the gap. Tracking is reset on every sign-in and
    project switch (the client's marks are cleared too) and is per project. Before the first read of a project nothing is said. While FIN
    is down nothing is graded or cleared: a failed read is not "all clear" and the last answer is never replayed as new alarms; an alarm
    that cleared during the outage is reported cleared once FIN answers.
  - **One alarm snapshot at a time.** The realtime poll and the alarm loop both read the alarm list. Each read is stamped with when its
    request was sent, and an older read that finishes after a newer one is dropped (`FinScramClient._take_alarms`, under a lock because the
    realtime poll parses on a worker thread), so a stale snapshot can never clear, return or raise an alarm. A project switch or sign-in
    clears the stamp, so the new project's first read is never blocked by the old one's.
  - **The first connection of a brand-new site is quiet.** The site's first successful alarm read claims a marker row in
    `notification_audit_log` (`notifications.baseline`, kept past the audit retention, so a restart or later poll never repeats it).
    The alarms already open at that moment are made quiet only when the site has no alarm notification history (`alarm.*` events,
    resolved or not) at that moment, checked in the same transaction as the claim (`Store.claim_baseline`; the marker's details say
    `{"quiet": true|false}`). Then those alarms whose FIN `occurred` time is earlier than the moment (FIN's
    `2026-11-06T16:42:07.319+04:00 Dubai` form is understood) are stored as already read for everyone, on the site's shared baseline
    recipient (`Store.condition(read=True)`): they stay listed in the history and are not in the unread count or badge. A site that
    already has alarm history but no marker (an upgrade from a version that recorded alarms) gets its marker and nothing is quieted:
    alarms raised since it last ran are new. Connection and sync events are not alarm history. A missing, unreadable (including no UTC
    offset) or later time is treated as new and unread, and so is every alarm after that first read, whatever time FIN gives it. Each
    site has its own marker.
  - **Severity bands.** A project with no numeric critical or warning band cannot grade an alarm (no thresholds are ever assumed), so
    none is notified; `GET /notifications` says `setup.severity_bands: false`, the bell and the Notifications page show a persistent
    warning above the list whatever else is listed, and Studio shows one beside Severity Configuration. A project with only a warning
    band notifies warnings by that band.
  - Only a validated project (the one `/api/notifications/v1` serves) records anything; the site is the FIN project this session reads.
  - A user's `PUT /preferences` can switch a type off for that user alone (it is left out of their list, count and bulk actions); the
    server never stops creating it. A site-wide ("baseline") toggle saved under the old per-site setting, or the project's old
    `apiSettings.notificationsCriticalAlarmsEnabled`, is no longer read by the server, so a project that still carries them is unaffected.
    The `#project:<site>` rows, `eko_role_mapping` and `notification_preferences` tables are kept as they are (no migration);
    `eko_role_mapping` still feeds `GET /api/auth/me`, and `PUT /api/notifications/v1/site-settings` is gone.
  - Limits: polling runs only while a dashboard is open, so an outage is reported when the next poll finds it, and the gap in
    "restored" includes time nobody was polling.
- Migration 4 changes no row; it writes one `notifications.per_user_state` audit row per site with how
  many notifications and preferences were inherited as the baseline. The database is backed up first
  (see `notification_db_path`).

**Limits.** There is still one FIN polling connection, used for the latest sign-in's project. Per-user
state does not change that: events are created from that one connection's project only, so users who
signed in for another project see nothing new for theirs until it is the one served (their requests are
refused with 409 meanwhile). The unique user is the FIN username the sign-in accepted; names are
compared exactly as FIN returned them (case is not folded). Sessions are in memory (above).

## Eko-Chat (Ask EKO's backend)

`POST /api/chat` answers a question about the open project from **typed, read-only tools** over the caches the polling loops
already keep (`get_building_snapshot`, `find_equipment`, `get_equipment_status`, `get_alarms`). Nothing in it can write, acknowledge or
reach FIN, and a model can only call those four tools; every number in an answer must come from a tool result, and the card shown
with it is built by code from the tool result. Code: `eko_chat.py`, `eko_chat_router.py`; browser side: `static/dashboard/js/llm/eko-chat.js`.

- **Off by default.** `config.json` has a `chat` block with `"enabled": false`; nothing is answered until it is `true`.
  `fast_router` answers simple English questions from the tools with no model. For the rest, `provider: "openai_compatible"` talks to any
  OpenAI-style `/chat/completions` server with native tool calling (Ollama at `http://localhost:11434/v1` by default) with `model`,
  `timeout_s` and `max_concurrent_llm`. An API key is read only from the environment variable named by `api_key_env` (`EKO_CHAT_API_KEY`);
  a key written into `config.json` is refused, and no project setting can supply the chat configuration.
- **Who may ask.** The signed-in user of the open project, enforced on `/api/chat` and `/api/chat/stats` by the same checks as the
  notification routes: the FIN connection, this browser's own session cookie, an `X-Eko-Project` header equal to the project the backend
  serves, and a session that signed in for this project. Failures answer 401 (`fin_not_connected`, `session_required`, `session_expired`),
  400 (`project_required`) or 409 (`project_mismatch`, `session_project_mismatch`, `project_not_validated`) as JSON
  `{"detail": {"error", "message"}}`. A disabled chat answers 503 first, whoever asks. The browser client sends the header from the project the
  Studio opened and refuses an answer that comes back for any other project.
  Any project that passes those checks may use chat (Marsa Al Arab, EKO HOSPITAL, ...), and the tools read **that** project's own caches and
  mappings; a block it did not map is reported as not mapped, never filled from another project (`power_boards` included: config.json's boards
  belong to its own site only). `chat.allowed_projects` (a list of FIN project names) is an optional operator allow-list: absent, nobody is
  excluded; present, a project not in it answers 403 `project_not_supported`, and so does an empty list or a value that is not a list.
  `config.json` ships `["marsaAlArab", "ekoHospital"]`, so a third project needs its FIN project name added there. Names match exactly (case included).
- **Capabilities.** `eko_chat_capabilities.py` is the inventory of what Eko-Chat covers (equipment, alarms, notifications, indoor environment,
  energy, HVAC, building overview) and of what it does not (comparisons and trends, water and gas, power meters, work orders, documents, Studio
  controls, and anything that writes). For the open project it reports each capability as `available`, `partial` (answered, with a stated limit),
  `unmapped` (naming the Dashboard Settings > Data Mapping entry, or the equipment points, it needs, from the project's own mappings and points; never a
  point ID) or `not_supported` (`planned` or `read_only`), and whether the
  data behind it is live, historical (FIN's hourly series) or stored (Eko-DT's notification store), and fresh, stale or not read yet. Ask
  "what can you do" (tool `get_capabilities`). A question that names something not supported (a theme change, a comparison, a work order, a
  request to turn something off) is answered with the real reason, where there is no model or the model does not answer; the rules never act on it.
  A wording that fits two readings (a bare "temperature") is asked back in one sentence, before any rule or model could pick one; an explicit
  outdoor or supply-air temperature is answered as not read, before any model (a model would give the indoor value). "What is unavailable / not
  mapped / missing / unsupported in this project" is answered by rules from the same report (`get_capabilities` with `show: "unavailable"`).
- **Point analytics, comparison and alarm records (Phase 2).** Four more read-only tools, all over the same FIN caches (nothing new is asked of FIN):
  `search_points` (which equipment has temperature, humidity, CO2 or power points, and which of them have a usable reading), `calculate_metric` (sum, average,
  min, max, count or a top-N ranking of one of those metrics), `compare_equipment` (two equipment items named exactly: open alarms, and the difference and
  percentage difference of the numeric points they share) and `get_alarm_history` (counts of the alarm records in FIN's latest alarm read). The arithmetic is
  `eko_chat_analytics.py`, never a model: units are kept and never combined (a point in another unit than the metric's is left out and counted; a point with
  no unit takes the metric's unit and is counted as assumed), a point that is missing, not reporting, stale, faulty, a setpoint, not a number or outside a
  sanity range is left out and counted by reason, ties are ordered by name, a zero denominator is `zero_denominator` (never a number), only power may be
  summed, and every answer carries its sample count and the time of the read. **What FIN gives it, and what it does not:** an equipment point has a name, a
  displayed value, a unit, a reporting flag and a status, but the whole equipment cache has ONE read time, so a calculation is over the latest read (a point in
  time) and says so; stored point history is not read, and a question about a past period of a point is answered as not supported. Alarm records are only the
  newest 200 of FIN's latest alarm read (the configured read is `alarms(today)`), so `get_alarm_history` states the days that read covers, flags a period it does
  not reach and a read that is full, gives a severity breakdown only when Severity Bands are mapped, and never counts the open alarms in its place. The points are
  indexed once per project and read (`eko_chat_analytics.index_for`: one memo entry per project, rebuilt when the cache is not the same object with the same
  timestamp, at most 4 held), so a message of several questions scans the points once. A project with no point for a metric is told so, with the live point
  (`ra_co2`) that would answer a single reading and whether the project maps it. Rules route "compare AHU-01 and AHU-02", "which AHU has the highest
  temperature", "top 3 AHUs by CO2", "highest temperature", "average humidity of the AHUs", "list AHUs with CO2 measurements" and "alarm history / how many
  alarms were raised today"; in a message of several questions "list their alarms" means the two compared items and "its alarms" the one item just named
  (nothing else is guessed), and an operation is shared with a bare second metric ("the highest temperature and humidity"). The humidity and CO2 averages of
  `get_environment` run on the same analytics. The new tools take the same filters-the-user-wrote guard as the old ones (`ASKED_FILTERS`).
- **Failed reads.** A read that fails is told to the browser as a tool event `{tool, status: "failed", reason, missing?}`. `reason` is one of
  `SAFE_REASONS` in `eko_chat.py` (anything else is an internal error); `missing` holds Data Mapping NAMES only (`{mapping, key}`, at most 6, never a
  point ID, expression or exception text), so the dashboard can say "not mapped: Live Points: avg_zone_temp". Every reason, tool and mapping name has
  an English and an Arabic text in `static/dashboard/js/i18n/en.js` and `ar.js`.
- **One project, one deadline per request** (`eko_chat_context.py`). Right after the session guard the endpoint captures an immutable project context (the Studio
  project id and the FIN project name, kept apart) and never rebuilds it from the backend's globals. Before EVERY tool call or model step the same guard runs
  again and the live project is compared with the captured one; a project change or an ended session abandons the request (HTTP 409 `project_changed`, or 401
  `session_required`; in a stream an `error` event) and nothing is shown or read for the other project. The whole request has one deadline,
  `chat.request_deadline_s` (default 90, allowed 0.5 to 600; a bad value falls back to the default): every model call is bounded by what is LEFT of it (the wait
  for a slot included) and is cancelled when it runs out, and no tool starts after it. If tools had already read something, the answer is those verified
  results in the code's own words, marked `partial` ("This answer is incomplete..."); otherwise HTTP 504 `request_timeout` (hybrid: a plain "not answered
  within N seconds" reply). Nothing the model had not finished is ever made up.
- **Documents.** `GET /api/fin/documents` needs the same session as the other data routes and lists only the manuals of the FIN project that session signed
  in for and FIN validated (409 for a session of another project or an unvalidated one). The only catalogue configured, `om-warranty.json`, belongs to
  marsaAlArab, so for EKO HOSPITAL the list is empty; no Hospital catalogue exists in the repository. `/api/fin/file` keeps its own project check.
- **Answers are Markdown.** Ask EKO shows bold, italic, headings, lists, tables and code blocks. The text is escaped first and turned into a fixed set of tags
  (`ai/ask.js`, `mdHtml`); raw HTML, links and images are never rendered.
- **Several questions in one message.** "How many assets are there and how many AHUs are in alarm?", "Show equipment list. Then show open alarms.",
  "Show notifications, humidity and CO2." `eko_chat_router.plan_parts()` splits the message into at most four questions (sentences first, then `and`,
  `then`, `also`, `plus`, `&` and commas inside a sentence; `?` `!` `.` and the Arabic `؟` `،` count; a number such as 1,000, a word such as "android"
  and a message that already matches one rule are never split). A list that shares a verb ("Show notifications, humidity and CO2") borrows it for the
  pieces that do not route alone. A message is split only when every piece either matches a rule or is plainly a question of its own; "Show critical
  alerts and warnings" is not a list of questions and goes where it always went. Unsafe text is never split. Each part is routed by the SAME `route()`
  as a single question and run through the same `execute()`, `direct_text()` and number-grounding check, on the request's pinned view (the session and
  project guard runs again before every part; a project change abandons the whole request with 409, nothing shown). No language model is called when
  every part routes. Every part gets a result in the order asked, with one of four statuses: `answered`; `unavailable` (the data cannot be read for this
  project: not mapped, not read yet, stale, no session; the reason and the missing mapping are named and no value is made up); `unsupported` (a
  capability that does not exist or only a planner could understand, reason `needs_planner`, or a question beyond the fourth, reason `limit_exceeded`);
  `failed` (the tool failed, the answer could not be checked, or the request deadline ended before the part ran, reason `request_timeout`; parts already
  answered are kept). The response keeps the single-answer fields and adds `parts` (`question`, `status`, `answer`, `reason`, `tool`, `rule`, `facts`,
  `as_of`, `source`, `card`, `missing`) and `multi` (`count`, `answered`, `status` complete or partial, `needs_planner`); `answer` is the same content as
  headed Markdown for clients that do not draw parts. `route` is `multi`. With the `rules` provider (and `ollama` with the planner off) a part no rule knows is reported; with a
  tool-calling model (`openai_compatible`, or `ollama` with the planner, Phase 3) such a message, or one over the limit, goes to the model as a whole, as before. Ask EKO shows one section per part.
- **Alarms and equipment.** The equipment list counts an alarm by the FIN id of the record it is on; `get_alarms` matches an equipment name the same
  way (the alarm rows carry that id internally, never shown) and by name as before, so the two always agree, and the alarm is shown under the equipment's
  own name. When the equipment list shows alarms for an item that the alarm read cannot match, the answer says so. A project with no Severity Bands is told
  that every alarm is graded info (none is critical), so "no critical alarms" is never false comfort. A severity the model adds that the question does not
  say is dropped, and the one explicit equipment id the user wrote is used when the model left it out. Equipment `type` comes only from the project's
  Equipment Classes (`type_priority`); with none mapped it is `other` for every item, the answer says so, and the item's own FIN tags are listed (nothing
  is classified from a name).
- **Is the model being used?** Every request writes one `CHAT_RESULT` line to the backend's console (`eko_chat_trace.py`), and a model call writes
  `LLM_CALL_STARTED` / `LLM_CALL_COMPLETED` (provider, model, milliseconds, whether a tool was chosen) around it:

  ```
  [eko-chat] LLM_CALL_SKIPPED   provider=ollama model=qwen3.5:4b reason=rules_matched
  [eko-chat] CHAT_RESULT        mode=RULES_ONLY handler=rules rule=equipment.list.read tool=find_equipment llm_called=false ...
  [eko-chat] LLM_CALL_STARTED   stage=interpret provider=ollama model=qwen3.5:4b
  [eko-chat] LLM_CALL_COMPLETED stage=interpret provider=ollama model=qwen3.5:4b ms=2175 tool_selected=yes tool=get_environment outcome=ok
  [eko-chat] CHAT_RESULT        mode=LLM_USED handler=llm_intent tool=get_environment llm_called=true llm_calls=1 llm_ms=2175 ...
  ```

  `mode` is `RULES_ONLY` (deterministic code answered, no model call: `llm_skipped` says `provider_rules`, `rules_matched` or
  `unsafe_or_empty_question`), `LLM_USED` (a model was called and its output produced the answer) or `LLM_FALLBACK` (the model path was entered but
  did not produce the answer; `fallback_reason` says why: `llm_unavailable`, `llm_timeout`, `llm_model_missing`, `llm_cooldown`, `llm_not_configured`,
  `llm_invalid_output`, `model_unsupported`, `model_clarification`, `answer_not_grounded`). `provider` and `model` are the ones in effect after the
  environment is applied (`LLM_ENABLED`, `OLLAMA_MODEL`, ... over `chat` in config.json). Nothing else is written: not the question or the answer, a key,
  the server address, a cookie, a FIN point ID or a tool argument. `chat.diagnostics: false` silences the lines. `GET /api/chat/stats` (signed in) shows
  the running totals as `modes` and `llm_calls`.
- **Logging.** Tool-selection diagnostics (`CHAT_DEBUG` in `eko_chat.py`) are off: they would print each user's question to the server log.
- **Load test.** `scripts/eko_chat_load_test.py` needs `--cookie` (the `eko_session` value, or `EKO_SESSION_COOKIE`) and `--project`.
- **Export.** `eko_chat.py`, `eko_chat_router.py` and `eko_chat_llm.py` are in the backend export list (`src/lib/backendExport.ts`): `main.py` imports them.

### Local AI setup in `Start_Viewer_Windows.bat` (Phase 4)

The batch file every export carries (its text is `src/lib/startViewerBat.ts`) checks Python and installs the dependencies exactly as before, then runs one **optional**
step, `backend/local_ai_setup.py` (Python standard library only), and then starts the backend as before. The step:

1. reads the configuration (`config.json` with `config.local.json` laid over it, see below) and acts only if `chat.local_ai` is `"auto"` (the exports write that). It does nothing, and installs nothing, when `chat.local_ai` is `"off"`,
   when `LLM_ENABLED` is off or `LLM_PROVIDER` is something other than `ollama` in the environment, when `chat.provider` is another provider, when `chat.base_url` is not
   the default local Ollama, or when chat was turned off in `config.json` after this step turned it on (marker `chat.local_ai_enabled_by_setup`). An older folder without
   `chat.local_ai` is left alone.
2. finds Ollama (`PATH`, `%LOCALAPPDATA%\Programs\Ollama`, `%ProgramFiles%\Ollama`) and **installs it only if it is missing**: `OllamaSetup.exe` next to the batch file if
   present (offline PCs), else the official download (`https://ollama.com/download/OllamaSetup.exe`, redirects only to GitHub release hosts, 1.6 GB, with the machine's
   own proxy settings and nothing done to get around them). The file is run, silently and for this user only (no administrator rights), only if its Authenticode signature
   is valid and issued to `CN=Ollama Inc.`
3. checks the service on `http://127.0.0.1:11434` and starts `ollama serve` (with `OLLAMA_HOST=127.0.0.1:11434`) if it is not answering. An `OLLAMA_HOST` that exposes it
   to the network is warned about, never changed.
4. checks the model list and **downloads `qwen3:8b` only if it is missing** (about 5 GB; 8 GB of free disk are required first; progress is shown; a stall or an error
   is a failure). Any other model is never downloaded: a model the administrator chose is only checked.
5. verifies the API, the model and its tool support (a warm-up call after a download only), and **only then** records these `chat` keys in **`config.local.json`** (never in `config.json`): `enabled`,
   `provider` (`ollama`, only if it was `rules`), `base_url` and `model` (only if absent or the rules defaults), and the marker. Every other setting, credential reference
   and custom value stays; a file that was already there is copied to `config.local.json.pre-local-ai.bak` once; the write is atomic. A second run finds everything in
   place and downloads, installs and writes nothing.

If anything fails, the step prints `WARNING: ... Eko-DT will start in rules-only mode`, logs to `%LOCALAPPDATA%\EKO-DT\logs\local-ai-setup.log` (or `EKO_LOCAL_AI_LOG_DIR`),
exits 1, and the batch file starts Eko-DT anyway. `EKO_SKIP_LOCAL_AI=1` skips the step. When a proxy is configured, the batch file adds `127.0.0.1,localhost` to `NO_PROXY`
for the backend (so Ollama on loopback is not sent to the proxy; FIN and everything else keep using it). To keep the assistant off on a machine, put
`{"chat": {"local_ai": "off"}}` in `config.local.json` (or set `LLM_ENABLED=false` for the machine).

**Updating an installation (`config.local.json`).** Every export writes `backend/config.json`, so extracting a newer ZIP over an installation replaces it, before any
script runs; nothing kept in `config.json` can survive an update. The operator's settings therefore live in `backend/config.local.json`, which no export contains: the
backend lays it over `config.json` when it starts (`config_overlay.py`: dicts merge key by key, a list or a value replaces the shipped one, a key it does not mention keeps
the release's value, so an update can still change a default or add a setting). The local AI setup records its settings there, never in `config.json`, so after an update:
an administrator's `local_ai: "off"` stays off, a chat the administrator turned off after the setup stays off, a custom provider, model or connection stays, the
assistant that was set up keeps working with no new setup (the next start finds Ollama and the model in place and writes nothing), and `config.json` is the new release's.
Credentials are not kept in either file (an API key is read from the environment variable `chat.api_key_env` names); the file is yours, and the backend prints the NAMES
of the keys it overrides at startup, never their values. A `config.local.json` that cannot be read is ignored and **the assistant is turned off** until it is fixed.
A folder set up by the earlier build, which wrote into `config.json`, has its AI settings (and only those) copied into `config.local.json` the first time the new setup
runs, if `config.json` still has them (for example when you chose to keep the old file when extracting). Settings an update has already overwritten cannot be recovered:
for a fleet, set the machine-wide `LLM_ENABLED=false`, or create `config.local.json` before the first update.

### The planner: a local model that plans read-only tool calls and explains the results (Ollama, Phase 3)

`chat.provider = "ollama"` runs the **planner** (`eko_chat_planner.py`) for every question the rules do not answer, unless `chat.planner` is `false` (or
`LLM_PLANNER=false`), which restores the one-intent path described under Hybrid mode below. The order of a request is unchanged up to the rules: the session
and project checks, the clarification, the deterministic router, and a message whose parts ALL have a rule are answered with **no model call**. A single
question for something nothing answers (a change, a theme or page, a trend, a forecast, the outdoor temperature) is also answered by code, before any model.
What is left (a question the rules do not know, or a message with at least one part they do not) goes to the model as a whole:

1. The model is offered the 13 registered read-only tools (`TOOLS`; `search_points`, `calculate_metric`, `compare_equipment` and `get_alarm_history` included)
   through Ollama's native tool calling (`/api/chat`, `think` off), and plans: it may call several tools in one step, read their results, and call more.
2. Every call is checked before it runs: the name against the allowlist, the arguments against that tool's own schema, a `type`, `floor`, name or equipment it
   passes must be a word of the question or a name an earlier result of this request returned (a severity must be the user's own word), and at most 6 calls
   run per step. A refused call is reported back to the model, which may ask again; it never reaches a tool. Nothing here can change, start, stop or
   acknowledge anything: there is no such tool.
3. Each call runs on the request's pinned project, which is re-checked (session and project) before every call and again before the answer is returned. A
   change abandons the request: HTTP 409 `project_changed`, or 401 for an ended session, and nothing is shown.
4. The model writes the final answer from the results it was shown (long results are cut by list, with an `_omitted` count; the answer is checked against that
   same text). Every number (Arabic-Indic digits and the Arabic decimal mark included), every equipment name and every severity claim in it must come from those
   results or from the question, also when no tool was used. The model gets one correction request; if the second answer still fails, a fixed reply is shown.
   The card is built by code from the newest successful read, as before.
5. A read that failed for a reason of the building's data (not mapped, stale, not read yet) is always told: when the model's answer does not name what is
   missing (the Data Mapping entries), the code appends "Not available: ..." (Arabic: "غير متاح:") from the tool result. The model's own mistakes (an unknown tool,
   bad arguments) are not reported as missing data.
6. Every part of the question is read. When the question names an equipment item and asks to identify it, check its condition, or find its alarms, the
   matching tool (`find_equipment`, `get_equipment_status`, `get_alarms`) must have been tried; the status result does not stand in for the alarms. A final
   answer that skipped one gets ONE nudge naming the missing reads (it does not use up a round); a part still unread is told ("Not checked: ..."), and an
   answer written with no read at all is never shown: it is replaced by "I could not read the building data this question needs". The prompt also tells the
   model to call a separate tool for each part, and to read the data even when it is only asked to explain or to write in another language.
7. Arabic. A question in Arabic, or one that asks for it ("in Arabic", "بالعربي", "باللغة العربية"), gets the instruction to write the ENTIRE answer in Arabic;
   the answer is rejected once if it is not (more than three English words that are not an equipment ID, a known abbreviation or unit, or a word of the tool
   results, or no Arabic at all), then replaced by an Arabic notice. Equipment IDs, abbreviations and numbers are checked as before; units the model spelled out
   in Arabic (جزء في المليون, °م, كيلوواط ساعة) are written back as the data writes them (ppm, °C, kWh); the lines the code adds ("غير متاح:", "لم يُفحص:") are
   Arabic. The replies the code writes itself follow the language of the request too (`eko_chat_text_ar.py`): the timeout reply, a partial answer (deadline,
   planning limit, model stopped) with the sentences that report what was read (all 13 tools; IDs, numbers and units such as AHU_01, 24 °C, 600 ppm, 3.5 kW are
   the results' own, text from FIN such as an alarm message is quoted as it is), and the replies for a model that is down or not understood. For a request in
   English they are unchanged. Nothing else in the model's text is changed.
8. At most `chat.planner.max_rounds` model calls (1 to 8, default 4; `LLM_PLANNER_MAX_ROUNDS`); the correction request does not count. At the limit, at the
   request's one deadline (`chat.request_deadline_s`), or when the model stops answering after tools had read something, the answer is what was read, in the
   code's own words, marked `partial` and "This answer is incomplete..."; with nothing read it is a plain reply.
9. The model is local: the same `base_url` (localhost unless `allow_remote_llm`), `model`, `timeout_s` (planner default 60 s), `max_output_tokens` (planner
   default 512), `num_ctx` (planner default 8192, the 13 tool definitions need more than 2048), cooldown and concurrency settings as the one-intent path.
   When Ollama is down, slow or without the model, the reply is the short plain message plus the list of supported questions, and the rules keep answering.

The reply has `route: "llm_planner"` and `answer_source: "llm"` when the model's explanation is shown (`"code"` for a fixed, partial or fallback text), and the
diagnostics line says `handler=planner`. A question in Arabic is answered in Arabic (the prompt asks for it; equipment names, units and digits stay as the
results give them). A 4B model needs 10 to 40 seconds for a question that takes two or three calls on a laptop GPU; the default overall deadline is 90 s.

### Hybrid mode: a local model for questions the rules do not know (Ollama)

(The one-intent path below runs when `chat.planner` is `false`.)

`chat.provider = "ollama"` adds a small **local** model behind the rules. The order of a request is unchanged up to the rules:
session and project checks, then the deterministic router answers everything it knows with **no model call**. Only a question the rules do not
recognise goes to Ollama, once, and the model's whole job is to return one JSON intent (schema-constrained, `think` off, at most 160 tokens).
The backend then checks the intent against an allowlist (the eight existing read-only tools; `INTENTS` in `eko_chat_llm.py`), checks the
parameters against that tool's own schema, requires any equipment name, class or floor to be written in the question itself, and runs the same
tool the rules use over the signed-in user's own project. The answer text and the card are built by code from the tool result, so numbers,
units and times are never the model's. The model never sees FIN data, credentials or other projects, and cannot name a tool, endpoint or
project. The one second call is an optional plain-English summary for "explain the current building conditions": it is used only when every
number in it is one of the facts it was given, otherwise the code's own text is shown.

When Ollama is not running, is slow, or the model is not installed, the reply is a short plain message plus the list of supported questions, the rules keep
answering, and the model is not called again for `llm_cooldown_s` (30 s) so a dead server does not delay every question (a refused
connection alone takes about 2 s on Windows). Latency and an error category are logged (`[eko-chat-llm]`, and `/api/chat/stats`), never the question.

**Model.** The default is `qwen3.5:4b` (a 4-billion-parameter model; the file is a few GB, so with a 4 GB GPU part of it may run on the CPU).
Whether it runs on your Ollama depends on the Ollama version, which only `ollama pull` can tell you: if the pull or the first call fails,
use `qwen3:4b` (smaller, long supported) or `qwen2.5:3b`. Set it with `OLLAMA_MODEL`; nothing else changes.

**Setup (Windows PowerShell)**

```powershell
# 1. install Ollama (https://ollama.com/download/windows), then check it
ollama --version
Invoke-RestMethod http://localhost:11434/api/version     # the service starts with Windows; or run: ollama serve
# 2. pull the model once (a multi-GB download; run it deliberately, nothing in Eko-DT does)
ollama pull qwen3.5:4b
ollama list
# 3. turn the hybrid mode on for this backend process only (config.json keeps provider "rules")
$env:LLM_ENABLED = "true"
$env:OLLAMA_MODEL = "qwen3.5:4b"
# 4. chat itself must also be on: "chat": {"enabled": true} in config.json (local edit; do not commit it)
cd backend; python -m uvicorn main:app --port 8000
```

| Setting | Where | Meaning |
|---|---|---|
| `LLM_ENABLED` | env | `true` selects `ollama`; `false` is the kill switch (rules only), whatever `config.json` says |
| `LLM_PROVIDER` | env | `ollama`, `rules` or `openai_compatible` (the older tool-calling provider) |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | env | default `http://localhost:11434`, `qwen3.5:4b`; a `/v1` suffix is ignored |
| `LLM_TIMEOUT_SECONDS`, `LLM_MAX_OUTPUT_TOKENS` | env | defaults 30 s (config.json: `timeout_s`) and 160 (`max_output_tokens`); the planner's are 60 s and 512 |
| `LLM_PLANNER`, `LLM_PLANNER_MAX_ROUNDS` | env | `false` selects the one-intent path; `true` turns the planner on; rounds 1 to 8 (config.json: `chat.planner`, `false` or `{"enabled", "max_rounds"}`) |
| `num_ctx`, `keep_alive`, `llm_cooldown_s`, `max_concurrent_llm` | config.json `chat` | context 2048, model kept loaded 10m, cooldown 30 s, 2 model calls at once |
| `allow_remote_llm` | config.json `chat` | an Ollama on another machine is refused unless this is `true`; the default is this computer only |

Environment values override `config.json`; an invalid value is ignored. No API key is used. To **turn the model off**, unset `LLM_ENABLED`
(or set it to `false`): the rules answer as before and unknown questions get the list of supported questions.

**Try it** (signed in to FIN in the Studio, chat enabled): "How clean is the air inside at the moment?", "Anything critical going wrong right now?",
"Do I have anything unread waiting for me?", "Can you explain the current building conditions?" The rule-known "What is the current IAQ index?" must not
call the model (`/api/chat/stats` shows the runs).

**Tests and measurement**

```powershell
cd backend
$env:EKO_NOTIFICATION_DB = "$env:TEMP\eko-test-notifications.db"      # keeps the tests off the real notification history
python -m unittest tests.test_eko_chat_rules tests.test_eko_chat_metrics tests.test_eko_chat_projects tests.test_eko_chat_inventory tests.test_eko_chat_capabilities tests.test_eko_chat_messages tests.test_eko_chat_trace tests.test_eko_chat_alarms tests.test_eko_chat_scope tests.test_eko_chat_multi tests.test_eko_chat_analytics tests.test_eko_chat_points tests.test_eko_chat_analytics_chat tests.test_eko_chat_analytics_capabilities tests.test_eko_chat_planner tests.test_eko_chat_arabic_partial tests.test_local_ai_setup tests.test_config_overlay tests.test_fin_documents tests.test_backend_export tests.test_fin_projects
cd ..
python scripts/eko_chat_llm_benchmark.py                 # live: cold start, intent latency, end-to-end, accuracy (needs Ollama + the model)
python scripts/eko_chat_llm_benchmark.py --unavailable   # how the chat behaves with Ollama off
python scripts/eko_chat_llm_benchmark.py --simulate      # checks the harness only; its times mean nothing
```

The two test modules cover the rule-based answers (`chat.provider = "rules"`) and the building-metric questions, against a fake FIN (`tests/fake_fin.py`) and a
throwaway notification database; no model is built or called and there is no network. The planner (`test_eko_chat_planner.py`: the Ollama wire against a mock transport, every tool through the planning loop, grounding, rounds, deadline, project and session scope) is tested with scripted models; the one-intent path (`eko_chat_llm.py`) is covered by the older suites with `chat.planner` false, and
neither test checks a real model's accuracy or speed, or live FIN. `pytest tests/test_eko_chat_rules.py tests/test_eko_chat_metrics.py` also works from `backend/`.

**Limitations.** A 4B model misreads some phrasings (the benchmark's accuracy line shows how many on your machine); a misread becomes a
wrong-but-read-only lookup or a "could you be more specific", never a write. The model sees one question at a time (no conversation memory)
and the English prompt works best for English. Equipment names must be written in the question, so "the fan coil on level 2" cannot be resolved.
Streaming is not used: the answer arrives whole, after the model call.

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
