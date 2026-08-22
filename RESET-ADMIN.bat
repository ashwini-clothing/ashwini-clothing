@echo off
setlocal
cd /d "%~dp0"
echo.
echo ==============================================
echo Ashwini V54 - Safe Admin Password Recovery
echo ==============================================
echo.
echo This tool updates ONLY the admin password/account.
echo It creates a backup before making the change.
echo It does NOT delete products, customers or orders.
echo.
node reset-admin.js
if errorlevel 1 (
  echo.
  echo Admin recovery did not complete.
  pause
  exit /b 1
)
echo.
echo Recovery completed. You can now start the website normally.
pause
