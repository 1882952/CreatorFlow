@echo off
chcp 65001 >nul 2>&1
title CreatorFlow 一键停止

echo ══════════════════════════════════════════
echo   CreatorFlow 一键停止
echo ══════════════════════════════════════════
echo.

set "ROOT=%~dp0"

:: ── 方法1: 按端口查找并停止进程 ──
echo [1] 停止编排服务 (端口 18688)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":18688.*LISTENING" 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
    echo     已停止 PID %%a
)

echo [2] 停止前端服务 (端口 8080)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080.*LISTENING" 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
    echo     已停止 PID %%a
)

:: ── 清理残留的 CLOSE_WAIT 连接 ──
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":18688.*CLOSE_WAIT" 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: ── 清理 PID 文件 ──
if exist "%ROOT%.pids.orch" del "%ROOT%.pids.orch" 2>nul
if exist "%ROOT%.pids.fe" del "%ROOT%.pids.fe" 2>nul

echo.
echo [√] 所有服务已停止
echo.
pause
