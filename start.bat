@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM .NET 代码安全审计平台 —— 启动脚本(双击执行)
REM ============================================================

set "ROOT=%~dp0"
set "LOGDIR=%ROOT%logs"

REM 检查 pnpm
where pnpm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pnpm 未安装。请先运行: npm install -g pnpm
    pause
    exit /b 1
)

REM 检查 node_modules,首次运行会装依赖
if not exist "%ROOT%node_modules" (
    echo [INFO] 首次启动,正在安装依赖...
    pushd "%ROOT%"
    call pnpm install --prefer-offline
    if errorlevel 1 (
        echo [ERROR] pnpm install 失败
        popd
        pause
        exit /b 1
    )
    popd
)

REM 建日志目录
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

REM 检查端口是否已被占用
netstat -ano | findstr ":3030.*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [WARN] 端口 3030 已被占用,可能 API 已在跑。继续启动 Web 即可。
)
netstat -ano | findstr ":5180.*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [WARN] 端口 5180 已被占用,可能 Web 已在跑。
)

echo ============================================================
echo  启动 NestJS API  (http://127.0.0.1:3030)
echo  启动 Vite Web   (http://localhost:5180)
echo ============================================================
echo 日志: %LOGDIR%\api.log  %LOGDIR%\web.log
echo 关闭: 双击 stop.bat
echo ============================================================

REM API dev 模式(nest start --watch 自动编译 + 监听变更)
start "AuditPlatform-API" /B cmd /c "cd /d ""%ROOT%"" && pnpm --filter @platform/api dev > ""%LOGDIR%\api.log"" 2>&1"

REM Web dev 模式(Vite HMR)
start "AuditPlatform-Web" /B cmd /c "cd /d ""%ROOT%"" && pnpm --filter @platform/web dev > ""%LOGDIR%\web.log"" 2>&1"

REM 等服务起来,自动打开浏览器
echo [INFO] 等待服务启动(约 12 秒;NestJS 首次编译耗时)...
timeout /t 12 /nobreak >nul

echo.
echo [OK] 启动完成
echo   API:  http://127.0.0.1:3030/api/health
echo   Web:  http://localhost:5180
echo.

REM 自动打开浏览器(用 start,不阻塞)
start "" "http://localhost:5180"

echo 按任意键关闭此窗口(不会停止服务,服务在后台继续运行)
pause >nul
endlocal