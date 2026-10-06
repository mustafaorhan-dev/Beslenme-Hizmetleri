# ============================================
# SURUM ARTIRMA SCRIPT'I (gelistirici icin)
# Tek surum kaynagi config.js icindedir; bu script
# APP_CONFIG.build degerini 1 artirir.
# Yayin icin: Admin Paneli > Surum Guncelleme > "Surumu Yayinla"
# ============================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfgPath = Join-Path $root 'config.js'

$cfg = [System.IO.File]::ReadAllText($cfgPath)
$m = [regex]::Match($cfg, 'build:\s*(\d+)')
if (-not $m.Success) { Write-Host 'HATA: config.js icinde build degeri bulunamadi' -ForegroundColor Red; pause; exit 1 }

$old = $m.Groups[1].Value
$new = ([int]$old + 1).ToString()
$cfg = $cfg.Replace("build: $old,", "build: $new,")
[System.IO.File]::WriteAllText($cfgPath, $cfg)

$ver = [regex]::Match($cfg, "version:\s*'([^']+)'")
Write-Host "config.js guncellendi: build $old -> $new (surum v$(if ($ver.Success) { $ver.Groups[1].Value } else { '?' }))" -ForegroundColor Green
Write-Host 'Not: Tum cihazlara yayin icin Admin Panelinden "Surumu Yayinla" tiklayin.' -ForegroundColor Yellow
