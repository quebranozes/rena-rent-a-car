@echo off
setlocal
cd /d "%~dp0"
title RENA - Rent a Car Demo
where python >nul 2>&1
if errorlevel 1 (
  echo Install Python 3.12 or newer and select Add Python to PATH.
  pause
  exit /b 1
)
python -c "import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)"
if errorlevel 1 (
  echo RENA requires Python 3.12 or newer.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  python -m venv .venv
  if errorlevel 1 goto error
)
".venv\Scripts\python.exe" -c "import flask, itsdangerous, openpyxl; from zoneinfo import ZoneInfo; ZoneInfo('Europe/Lisbon')" >nul 2>&1
if errorlevel 1 (
  echo Installing dependencies. The first installation needs internet access.
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 goto error
)
echo RENA - Rent a Car. Created by Renato Pinto.
echo Synthetic data only. Press Ctrl+C to stop.
".venv\Scripts\python.exe" server.py
if errorlevel 1 goto error
exit /b 0
:error
echo Could not start RENA. See the error above.
pause
exit /b 1
