@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM  Audit Platform - Status Check (double-click)
REM ============================================================

echo ============================================================
echo   Service Status
echo ============================================================

REM Check API (3030)
netstat -ano | findstr ":3030" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    echo   API   3030   [ STOPPED ]
) else (
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3030" ^| findstr "LISTENING"') do (
        echo   API   3030   [ RUNNING ]  PID=%%P
    )
)

REM Check Web (5180)
netstat -ano | findstr ":5180" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    echo   Web   5180   [ STOPPED ]
) else (
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":5180" ^| findstr "LISTENING"') do (
        echo   Web   5180   [ RUNNING ]  PID=%%P
    )
)

echo.
echo   Logs:  logs\api.log   logs\web.log
echo   Start: double-click start.bat
echo   Stop:  double-click stop.bat
echo.
echo Default login: admin / admin123 (run 'pnpm --filter @platform/api seed' first)
echo.
pause >nul
endlocal