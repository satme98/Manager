@echo off
setlocal enabledelayedexpansion

REM ============================================================================
REM MONARQ ECONOMAT - Nightly PocketBase Backup Script (Windows)
REM Copies pb_data to a backup directory (local disk or USB drive) and retains
REM only the 14 most recent backup folders.
REM ============================================================================

set "SOURCE_DIR=%~dp0..\pb_data"
set "BACKUP_ROOT=%~dp0..\pb_backups"

REM Allow overriding the backup destination via first CLI argument (e.g., E:\MONARQ_BACKUPS)
if not "%~1"=="" set "BACKUP_ROOT=%~1"

if not exist "%SOURCE_DIR%" (
    echo [ERROR] Source directory "%SOURCE_DIR%" does not exist.
    exit /b 1
)

if not exist "%BACKUP_ROOT%" (
    mkdir "%BACKUP_ROOT%"
)

REM Generate timestamp YYYYMMDD_HHMMSS via PowerShell for locale independence
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TIMESTAMP=%%i"

set "TARGET_DIR=%BACKUP_ROOT%\pb_data_%TIMESTAMP%"

echo [MONARQ BACKUP] Copying "%SOURCE_DIR%" to "%TARGET_DIR%"...
robocopy "%SOURCE_DIR%" "%TARGET_DIR%" /E /COPY:DAT /R:2 /W:2 /NFL /NDL /NJH /NJS

if %ERRORLEVEL% GEQ 8 (
    echo [ERROR] Robocopy failed with exit code %ERRORLEVEL%.
    exit /b %ERRORLEVEL%
)

REM Keep only the 14 most recent pb_data_* directories
echo [MONARQ BACKUP] Rotating backups (retaining last 14 copies)...
for /f "skip=14 delims=" %%d in ('dir "%BACKUP_ROOT%\pb_data_*" /AD /B /O-N 2^>nul') do (
    echo [MONARQ BACKUP] Removing old backup "%BACKUP_ROOT%\%%d"
    rmdir /S /Q "%BACKUP_ROOT%\%%d"
)

echo [MONARQ BACKUP] Backup completed successfully: "%TARGET_DIR%"
exit /b 0
