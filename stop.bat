@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM  Audit Platform - Stop Script (double-click)
REM  Kills processes on ports 3030 (API) and 5180 (Web)
REM  Uses port-based PID lookup, so other projects are unaffected
REM ============================================================

echo ============================================================
echo   Stopping NestJS API  (port 3030)
echo   Stopping Vite Web   (port 5180)
echo ============================================================

set "KILLED=0"

REM Kill API on port 3030
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3030" ^| findstr "LISTENING"') do (
    if not "%%P"=="0" (
        echo [INFO] Killing API PID=%%P ...
        taskkill /F /PID %%P >nul 2>&1
        if not errorlevel 1 set /a "KILLED+=1"
    )
)

REM Kill Web on port 5180
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":5180" ^| findstr "LISTENING"') do (
    if not "%%P"=="0" (
        echo [INFO] Killing Web PID=%%P ...
        taskkill /F /PID %%P >nul 2>&1
        if not errorlevel 1 set /a "KILLED+=1"
    )
)

REM Fallback: clean up leftover cmd windows with our title (in case port detection misses)
tasklist /FI "WINDOWTITLE eq AuditPlatform-*" 2>nul | findstr /R "AuditPlatform" >nul 2>&1
if not errorlevel 1 (
    echo [INFO] Cleaning leftover launcher windows ...
    for /f "tokens=2" %%W in ('tasklist /FI "WINDOWTITLE eq AuditPlatform-*" /FO LIST 2^>nul ^| findstr "cmd.exe"') do (
        taskkill /F /PID %%W >nul 2>&1
    )
)

if "%KILLED%"=="0" (
    echo [INFO] No running services found (ports 3030 / 5180 both empty)
) else (
    echo [OK] Killed %KILLED% process(es)
)

echo.
echo Press any key to exit.
pause >nul
endlocal