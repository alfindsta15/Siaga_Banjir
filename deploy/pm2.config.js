// pm2 (Linux/Windows/Mac): npm i -g pm2 ; pm2 start deploy/pm2.config.js ; pm2 save
// Agar hidup saat komputer menyala: Linux "pm2 startup"; Windows lebih mudah dengan Task Scheduler (lihat docs/ONLINE.md).
module.exports = { apps: [{ name: 'siaga-banjir', script: 'server/server.js', cwd: __dirname + '/..', autorestart: true, restart_delay: 5000,
  env: { PORT: 3002, TRUST_PROXY: '1'
    // , MQTT_URL: 'mqtts://xxxxxxxx.s1.eu.hivemq.cloud:8883', MQTT_USER: 'siaga-server', MQTT_PASS: 'sandi-server'   // lihat TUTORIAL.md
  } }] };
