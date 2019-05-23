module.exports = {
  apps: [
    {
      name: 'facebook-messenger-bot',
      script: 'index.js',
      exec_mode: 'fork',
      instances: 1,
      env: {},
      env_development: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      log_file: '/home/toeknee/.pm2/logs/facebook-messenger-bot-all.log',
      pm_log_path: '/home/toeknee/.pm2/logs/facebook-messenger-bot-all.log',
      log_date_format: 'MM-DD-YYYY HH:mm:ss.S',
      min_uptime: 30000,
      max_restarts: 5,
      restart_delay: 30000,
    },
  ],
};
