@echo off
chcp 65001 >nul
title 啟動課堂教學互動白板
echo ====================================================
echo        正在啟動課堂教學互動白板
echo ====================================================
echo.
echo 正在開啟本機服務器 (http://localhost:8090)...
start http://localhost:8090
python -m http.server 8090
pause
