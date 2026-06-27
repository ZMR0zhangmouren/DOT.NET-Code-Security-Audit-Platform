@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM .NET 代码安全审计平台 —— 状态查询(双击执行)
REM ============================================================

echo ============================================================
echo  服务状态
echo ============================================================

REM 检查 API (3030)
netstat -ano | findstr ":3030" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    echo   API   3030  [ STOPPED ]
) else (
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3030" ^| findstr "LISTENING"') do (
        echo   API   3030  [ RUNNING ] PID=%%P
    )
)

REM 检查 Web (5180)
netstat -ano | findstr ":5180" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    echo   Web   5180  [ STOPPED ]
) else (
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":5180" ^| findstr "LISTENING"') do (
        echo   Web   5180  [ RUNNING ] PID=%%P
    )
)

echo.
echo  日志:  logs\api.log   logs\web.log
echo  启动:  双击 start.bat
echo  关闭:  双击 stop.bat
echo.
pause >nul
endlocal