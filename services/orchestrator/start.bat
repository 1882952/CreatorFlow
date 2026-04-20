@echo off
echo Starting CreatorFlow Orchestrator...
cd /d "%~dp0"
python -m uvicorn main:app --host 0.0.0.0 --port 18688 --reload
pause
