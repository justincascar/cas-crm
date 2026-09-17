@echo off
cd /d "%~dp0"
echo Starting CAS CRM...
echo When you see "Ready", open http://localhost:3000 in your browser.
echo Keep this window open. Press Ctrl+C to stop.
echo.
call npm run dev
pause
