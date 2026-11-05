/** The helper the batch file runs for the local AI step; it ships in backend/ (see backendExport.ts). */
export const LOCAL_AI_HELPER = 'local_ai_setup.py'

/**
 * Start_Viewer_Windows.bat, written into every exported ZIP (exportProjectAsZip). It checks Python, installs the backend's dependencies, sets up the local AI
 * assistant, and starts the FastAPI backend (which serves the viewer and the API).
 *
 * The Python check and the pip line are exactly what they were. The local AI step is one optional section between the dependency install and the server
 * start; it calls backend/local_ai_setup.py, which does the work (detect Ollama, install it only if missing, start the service, download qwen3:8b only if
 * missing, verify, and turn the assistant on in config.json when the administrator has not turned it off). Nothing in that step can stop Eko-DT: it never
 * exits the script, a failing, crashing or missing helper only prints a warning, and EKO_SKIP_LOCAL_AI=1 skips it. The logic is in the helper and not here
 * because a batch file cannot read or merge JSON, test an HTTP API or check a signature safely, and the helper is tested (backend/tests/test_local_ai_setup.py).
 *
 * The last line of the step keeps loopback (Ollama) out of any proxy the machine has configured, for the backend only: NO_PROXY gets 127.0.0.1 and localhost
 * added when a proxy is set. Traffic to FIN and everything else keeps using the proxy as before.
 */
export function startViewerWindowsBat(): string {
  return [
    '@echo off',
    'echo ============================================',
    'echo   EKO Digital Twin Viewer + FIN Backend',
    'echo ============================================',
    'echo.',
    'echo Checking Python...',
    'python --version >nul 2>&1 || (echo Python not found. Please install Python 3.10+ && pause && exit /b 1)',
    'echo.',
    'echo Installing backend dependencies...',
    'cd /d "%~dp0backend"',
    'pip install -r requirements.txt --quiet',
    'echo.',
    'echo Local AI assistant: Ollama and the qwen3:8b model. This step is optional, Eko-DT starts without it.',
    'if /i "%EKO_SKIP_LOCAL_AI%"=="1" echo Local AI setup skipped because EKO_SKIP_LOCAL_AI is 1.',
    'if /i "%EKO_SKIP_LOCAL_AI%"=="1" goto :eko_local_ai_done',
    `if not exist "${LOCAL_AI_HELPER}" goto :eko_local_ai_done`,
    `python ${LOCAL_AI_HELPER}`,
    'if errorlevel 1 echo WARNING: the local AI assistant is not ready. Eko-DT will start with rules-based answers only. Details are above and in %LOCALAPPDATA%\\EKO-DT\\logs.',
    ':eko_local_ai_done',
    `if exist "${LOCAL_AI_HELPER}" for /f "usebackq delims=" %%A in (\`python ${LOCAL_AI_HELPER} --print-no-proxy\`) do set "NO_PROXY=%%A"`,
    'echo.',
    'echo Starting server on port 8000.',
    'echo   This device:    http://127.0.0.1:8000/',
    'echo   Other devices:  http://[this-machine-ip]:8000/',
    'echo.',
    'echo Sign in when the page opens. Press Ctrl+C to stop.',
    'echo.',
    'python start_viewer.py',
    'pause',
  ].join('\r\n')
}
