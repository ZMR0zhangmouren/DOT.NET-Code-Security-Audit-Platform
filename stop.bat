@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM .NET 代码安全审计平台 —— 关闭脚本(双击执行)
REM ============================================================
REM 通过端口定位 PID,精准关闭 API(3030)与 Web(5180)。
REM 不影响其它项目。
REM ============================================================

echo ============================================================
echo  关闭 NestJS API  (端口 3030)
echo  关闭 Vite Web   (端口 5180)
echo ============================================================

set "KILLED=0"

REM 关闭端口 3030 上的进程(API)
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3030" ^| findstr "LISTENING"') do (
    if not "%%P"=="0" (
        echo [INFO] 关闭 API PID=%%P ...
        taskkill /F /PID %%P >nul 2>&1
        if not errorlevel 1 set /a "KILLED+=1"
    )
)

REM 关闭端口 5180 上的进程(Web)
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":5180" ^| findstr "LISTENING"') do (
    if not "%%P"=="0" (
        echo [INFO] 关闭 Web PID=%%P ...
        taskkill /F /PID %%P >nul 2>&1
        if not errorlevel 1 set /a "KILLED+=1"
    )
)

REM 兜底:关掉 AuditPlatform-* 窗口标题的所有 node 进程
REM (防止 start.bat 启动的两个 cmd 窗口仍残留,即使端口检测失败)
tasklist /FI "WINDOWTITLE eq AuditPlatform-*" 2>nul | findstr /R "AuditPlatform" >nul 2>&1
if not errorlevel 1 (
    echo [INFO] 清理残留的启动窗口 ...
    for /f "tokens=2" %%W in ('tasklist /FI "WINDOWTITLE eq AuditPlatform-*" /FO LIST ^| findstr "cmd.exe"') do (
        taskkill /F /PID %%W >nul 2>&1
    )
)

if "%KILLED%"=="0" (
    echo [INFO] 没找到运行中的服务(端口 3030 / 5180 都空)
) else (
    echo [OK] 共关闭 %KILLED% 个进程
)

echo.
echo 按任意键退出
pause >nul
endlocal