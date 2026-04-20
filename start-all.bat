@echo off
chcp 65001 >nul 2>&1
title CreatorFlow

echo ==========================================
echo   CreatorFlow All-in-One Starter
echo ==========================================
echo.

set "ROOT=%~dp0"

:: -- Check Python --
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Please install Python 3.11+
    pause
    exit /b 1
)

:: -- Install deps on first run --
if not exist "%ROOT%services\orchestrator\__pycache__" (
    echo [INFO] Installing orchestrator dependencies...
    pip install -r "%ROOT%services\orchestrator\requirements.txt" -q
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)

:: -- Create logs dir --
if not exist "%ROOT%logs" mkdir "%ROOT%logs"

:: -- Start Orchestrator (port 18688) --
echo [1/2] Starting orchestrator on port 18688 ...
start /b "" python -m uvicorn main:app --host 0.0.0.0 --port 18688 --reload --app-dir "%ROOT%services\orchestrator" > "%ROOT%logs\orchestrator.log" 2>&1

:: -- Start Frontend (port 8080) --
echo [2/2] Starting frontend on port 8080 ...
start /b "" python -m http.server 8080 --directory "%ROOT%creatorflow" > "%ROOT%logs\frontend.log" 2>&1

:: -- Wait and verify --
echo.
echo Waiting for services ...
ping -n 4 127.0.0.1 >nul

curl -s --max-time 5 http://localhost:18688/api/health >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Orchestrator : http://localhost:18688
) else (
    echo [..] Orchestrator starting, visit later: http://localhost:18688
)
echo [OK] Frontend      : http://localhost:8080

echo.
echo ==========================================
echo   Frontend : http://localhost:8080
echo   API      : http://localhost:18688
echo   Logs     : logs\orchestrator.log
echo ==========================================
echo.
echo Press any key to open browser ...
pause >nul
start http://localhost:8080

echo.
echo Services running. Press any key to STOP all services ...
pause >nul
call "%ROOT%stop-all.bat"
