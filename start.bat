@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM  Audit Platform - Start Script (double-click)
REM  Starts NestJS API and Vite Web in truly independent windows
REM  Closing this window does NOT kill the services.
REM ============================================================

set "ROOT=%~dp0"
set "LOGDIR=%ROOT%logs"

REM Check pnpm available
where pnpm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pnpm not found. Install: npm install -g pnpm
    pause
    exit /b 1
)

REM First-run: install deps if missing
if not exist "%ROOT%node_modules" (
    echo [INFO] First run - installing dependencies...
    pushd "%ROOT%"
    call pnpm install --prefer-offline
    if errorlevel 1 (
        echo [ERROR] pnpm install failed
        popd
        pause
        exit /b 1
    )
    popd
)

REM Create log dir
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

REM Check port already in use
netstat -ano | findstr ":3030.*LISTENING" >nul 2>&1
if not errorlevel 1 echo [WARN] Port 3030 already in use - API may already be running.
netstat -ano | findstr ":5180.*LISTENING" >nul 2>&1
if not errorlevel 1 echo [WARN] Port 5180 already in use - Web may already be running.

echo ============================================================
echo   NestJS API  -> http://127.0.0.1:3030
echo   Vite Web   -> http://localhost:5180
echo ============================================================
echo   Logs:  %LOGDIR%\api.log   %LOGDIR%\web.log
echo   Stop:  double-click stop.bat
echo ============================================================

REM Launch services in NEW cmd windows (not /B — these are independent)
REM Closing this launcher window does NOT affect them.
start "AuditPlatform-API" cmd /c "cd /d ""%ROOT%"" && pnpm --filter @platform/api dev > ""%LOGDIR%\api.log"" 2>&1"
start "AuditPlatform-Web" cmd /c "cd /d ""%ROOT%"" && pnpm --filter @platform/web dev > ""%LOGDIR%\web.log"" 2>&1"

REM Wait for boot
echo [INFO] Waiting for services to start (~12s)...
timeout /t 12 /nobreak >nul

echo.
echo [OK] Startup complete
echo   Health: http://127.0.0.1:3030/api/health
echo   Login:  http://localhost:5180/login  (admin / admin123)
echo.
echo You can close this window now — services continue running.

REM Auto-open browser
start "" "http://localhost:5180" 2>nul

REM Auto-close after 5 seconds (no user interaction needed)
timeout /t 5 /nobreak >nul
endlocal
exit