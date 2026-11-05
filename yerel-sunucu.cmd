@echo off
rem ============================================
rem Uygulamayi yerel HTTP sunucusunda acar.
rem index.html'i cift tiklayarak (file://) acmayin:
rem tarayici guvenlik kurallari manifest.json ve
rem service worker'i engeller, giris calismaz.
rem ============================================
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo HATA: Python bulunamadi.
  echo Yayindaki surumu kullanin: https://mustafaorhan-dev.github.io/Beslenme-Hizmetleri/
  pause
  exit /b 1
)

echo Yerel sunucu baslatiliyor: http://localhost:8080/
echo Kapatmak icin bu pencerede Ctrl+C'ye basin.
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:8080/'"
python -m http.server 8080
pause
