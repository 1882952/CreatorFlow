@echo off
chcp 65001 >nul 2>&1
title CreatorFlow - Stop

set "NO_PAUSE=0"
if /I "%~1"=="--no-pause" set "NO_PAUSE=1"

echo ==========================================
echo   Stopping CreatorFlow Services
echo ==========================================
echo.

set "ORCH_PORT=18688"
set "FRONT_PORT=8080"

call :kill_by_port %ORCH_PORT% "orchestrator"
call :kill_by_port %FRONT_PORT% "frontend"

echo.
echo [OK] All services stopped.
echo.
if "%NO_PAUSE%"=="1" exit /b 0
pause
exit /b 0

:kill_by_port
set "PORT=%~1"
set "LABEL=%~2"
echo [*] Stopping %LABEL% (port %PORT%) ...

set "FOUND=0"
for /f "tokens=5" %%P in ('netstat -ano -p tcp 2^>nul ^| findstr "LISTENING" ^| findstr ":%PORT%"') do (
    set "FOUND=1"
    echo     Killing PID %%P and child processes
    taskkill /F /T /PID %%P >nul 2>&1
    call :kill_reload_children %%P
)

if "%FOUND%"=="0" (
    echo     No listening process found on port %PORT%
)

call :wait_port_release %PORT%
exit /b 0

:wait_port_release
set "PORT=%~1"
set /a ATTEMPT=0

:wait_loop
set /a ATTEMPT+=1
netstat -ano -p tcp 2>nul | findstr "LISTENING" | findstr ":%PORT%" >nul
if errorlevel 1 (
    echo     Port %PORT% released
    exit /b 0
)

if %ATTEMPT% geq 10 (
    echo     [WARN] Port %PORT% is still occupied after stop attempt
    netstat -ano -p tcp | findstr "LISTENING" | findstr ":%PORT%"
    exit /b 0
)

ping -n 2 127.0.0.1 >nul
goto wait_loop

:kill_reload_children
set "TARGET_PID=%~1"
for /f "usebackq delims=" %%C in (`powershell -NoProfile -Command "$targetPid='%TARGET_PID%'; Get-CimInstance Win32_Process ^| Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -like ('*parent_pid=' + $targetPid + '*') } ^| ForEach-Object { $_.ProcessId }"`) do (
    if not "%%C"=="" (
        echo     Killing reload child PID %%C
        taskkill /F /PID %%C >nul 2>&1
    )
)
exit /b 0
