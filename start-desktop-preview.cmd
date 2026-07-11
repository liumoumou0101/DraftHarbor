@echo off
setlocal
title DraftHarbor Desktop Preview

cd /d "%~dp0"

echo.
echo ========================================
echo   DraftHarbor Desktop Preview
echo ========================================
echo.
echo This starts the Electron desktop mainline:
echo   draftharbor://app/desktop.html
echo.
echo It does not start the legacy web server or bind port 8000.
echo.

if not exist "package.json" (
    echo [ERROR] package.json not found. Run this file from the project root.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm was not found. Install Node.js first.
    pause
    exit /b 1
)

if not exist "node_modules\.bin\electron.cmd" (
    echo [INFO] Dependencies are missing. Running npm install...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

echo [INFO] Starting desktop app...
echo [INFO] Close the app window to stop preview.
echo.

call npm run desktop
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [ERROR] Desktop preview exited with code %EXIT_CODE%.
    pause
    exit /b %EXIT_CODE%
)

endlocal
