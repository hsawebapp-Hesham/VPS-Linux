@echo off
setlocal EnableDelayedExpansion

rem ============================================================
rem  HSA Come - Local Development Server Launcher (run.bat)
rem  ------------------------------------------------------------
rem  1. Checks whether the local server is already running
rem  2. Stops it if it is running
rem  3. Starts a fresh server
rem  4. Opens the site automatically in the default browser
rem ============================================================

set "PORT=8001"
set "HOST=localhost"
set "SITE_URL=http://%HOST%:%PORT%/"

rem Always serve from the folder where this script lives,
rem no matter where the script was launched from.
cd /d "%~dp0"

echo ============================================================
echo  HSA Come - Local Server Launcher
echo ============================================================
echo.

rem ------------------------------------------------------------
rem [1/4] Check whether a server is already listening on the port
rem ------------------------------------------------------------
echo [1/4] Checking for an existing server on port %PORT% ...
set "FOUND=0"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (set "FOUND=1" & echo        Found process %%P - stopping it ... & taskkill /PID %%P /F >nul 2>&1)
if "!FOUND!"=="0" (echo        No server is running on port %PORT%. Nothing to stop.) else (echo        Existing server stopped. & timeout /t 2 /nobreak >nul)

rem ------------------------------------------------------------
rem [2/4] Locate a Python interpreter
rem ------------------------------------------------------------
echo.
echo [2/4] Looking for Python ...
set "PYTHON_CMD="
where python >nul 2>nul && set "PYTHON_CMD=python"
if not defined PYTHON_CMD ( where python3 >nul 2>nul && set "PYTHON_CMD=python3" )
if not defined PYTHON_CMD ( where py >nul 2>nul && set "PYTHON_CMD=py" )

if not defined PYTHON_CMD (
    echo.
    echo [ERROR] Python is not installed or not in your PATH.
    echo         This static site needs a small local server to run.
    echo.
    echo         Option A - Install Python:
    echo           1. Download it from https://www.python.org/downloads/
    echo           2. During setup, tick "Add Python to PATH"
    echo           3. Run this file again
    echo.
    echo         Option B - No install needed:
    echo           Just open "index.html" directly in your browser.
    echo           The site works offline via the embedded fallback data.
    echo.
    pause
    exit /b 1
)
echo        Found: !PYTHON_CMD!

rem ------------------------------------------------------------
rem [3/4] Start the server in a new console window
rem ------------------------------------------------------------
echo.
echo [3/4] Starting the server at %SITE_URL% ...
start "HSA Come Server" cmd /k "!PYTHON_CMD! -m http.server %PORT% --bind %HOST%"

rem Wait briefly for the server to start, then verify it is listening
timeout /t 2 /nobreak >nul
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>&1
if !errorlevel! == 0 (echo        Server is up and running.) else (echo        Note: the server may still be starting up.)

rem ------------------------------------------------------------
rem [4/4] Open the site in the default browser
rem ------------------------------------------------------------
echo.
echo [4/4] Opening %SITE_URL% in your default browser ...
start "" "%SITE_URL%"

echo.
echo ============================================================
echo  HSA Come is running at %SITE_URL%
echo.
echo  The server runs in its own window titled "HSA Come Server".
echo  To stop it: close that window, or run:  taskkill /f /im python.exe
echo  To restart everything: run this file again.
echo ============================================================

endlocal
