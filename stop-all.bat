@echo off
chcp 65001 >nul 2>&1
title CreatorFlow - Stop

echo ==========================================
echo   Stopping CreatorFlow Services
echo ==========================================
echo.

:: -- Kill by port: 18688 (orchestrator) --
echo [1] Stopping orchestrator (port 18688) ...
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr "LISTENING" ^| findstr ":18688"') do (
    taskkill /F /PID %%P >nul 2>&1
    echo     Killed PID %%P
)

:: -- Kill by port: 8080 (frontend) --
echo [2] Stopping frontend (port 8080) ...
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr "LISTENING" ^| findstr ":8080"') do (
    taskkill /F /PID %%P >nul 2>&1
    echo     Killed PID %%P
)

:: -- Clean stale connections on 18688 --
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr "CLOSE_WAIT" ^| findstr ":18688"') do (
    taskkill /F /PID %%P >nul 2>&1
)

echo.
echo [OK] All services stopped.
echo.
pause
