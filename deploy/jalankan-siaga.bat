@echo off
rem Windows: jalankan server. Pasang di Task Scheduler (Trigger: At startup; "Run whether user is logged on or not").
rem Ubah lokasi folder dan nilai di bawah sesuai kebutuhan.
cd /d C:\siaga-banjir
set PORT=3001
set TRUST_PROXY=1
rem set WEBHOOK_KEY=ganti-dengan-kata-acak-yang-panjang
rem MQTT (alat online lewat broker, lihat TUTORIAL.md). Hapus 'rem' dan isi:
rem set MQTT_URL=mqtts://xxxxxxxx.s1.eu.hivemq.cloud:8883
rem set MQTT_USER=siaga-server
rem set MQTT_PASS=sandi-server
:ulang
node server\server.js
echo Server berhenti, mulai ulang dalam 5 detik...
timeout /t 5 /nobreak >nul
goto ulang
