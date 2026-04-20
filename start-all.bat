@echo off
chcp 65001 >nul 2>&1
title CreatorFlow 一键启动

echo ══════════════════════════════════════════
echo   CreatorFlow 一键启动
echo ══════════════════════════════════════════
echo.

set "ROOT=%~dp0"
set "PIDFILE=%ROOT%.pids"

:: ── 检查 Python ──
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Python，请先安装 Python 3.11+
    pause
    exit /b 1
)

:: ── 检查编排服务依赖 ──
if not exist "%ROOT%services\orchestrator\venv\" (
    echo [信息] 首次运行，安装编排服务依赖...
    cd /d "%ROOT%services\orchestrator"
    pip install -r requirements.txt -q
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败，请手动运行: cd services\orchestrator ^&^& pip install -r requirements.txt
        pause
        exit /b 1
    )
    cd /d "%ROOT%"
)

:: ── 启动编排服务 ──
echo [1/2] 启动编排服务 (端口 18688)...
cd /d "%ROOT%services\orchestrator"
start /b "CreatorFlow-Orchestrator" python -m uvicorn main:app --host 0.0.0.0 --port 18688 --reload > "%ROOT%logs\orchestrator.log" 2>&1
echo %errorlevel% > "%PIDFILE%.orch"

:: ── 启动前端静态服务 ──
echo [2/2] 启动前端服务 (端口 8080)...
if not exist "%ROOT%logs" mkdir "%ROOT%logs"
start /b "CreatorFlow-Frontend" python -m http.server 8080 --directory "%ROOT%creatorflow" > "%ROOT%logs\frontend.log" 2>&1
echo %errorlevel% > "%PIDFILE%.fe"

cd /d "%ROOT%"

:: ── 等待服务就绪 ──
echo.
echo 等待服务启动...
timeout /t 3 /nobreak >nul

:: 验证编排服务
curl -s --max-time 5 http://localhost:18688/api/health >nul 2>&1
if %errorlevel% equ 0 (
    echo [√] 编排服务已就绪: http://localhost:18688
) else (
    echo [!] 编排服务启动中，稍后访问: http://localhost:18688
)

echo [√] 前端服务已就绪: http://localhost:8080
echo.
echo ══════════════════════════════════════════
echo   前端: http://localhost:8080
echo   编排: http://localhost:18688
echo   日志: logs\orchestrator.log
echo ══════════════════════════════════════════
echo.
echo 按任意键打开浏览器 (关闭此窗口将停止所有服务)...
pause >nul

start http://localhost:8080

:: 保持窗口打开，关闭时自动停用
echo.
echo 服务运行中，关闭此窗口将停止所有服务...
echo 按任意键停止所有服务...
pause >nul

call "%ROOT%stop-all.bat"
