@echo off
setlocal
set "DRAFTHARBOR_DATA_ROOT=%APPDATA%\draftharbor-desktop"
set "DRAFTHARBOR_PROGRAM=%~dp0release\preview-fit-20261007\win-unpacked\DraftHarbor.exe"

if not exist "%DRAFTHARBOR_PROGRAM%" (
    echo [ERROR] The latest DraftHarbor build was not found.
    pause
    exit /b 1
)

start "" "%DRAFTHARBOR_PROGRAM%" --user-data-dir="%DRAFTHARBOR_DATA_ROOT%"
endlocal
