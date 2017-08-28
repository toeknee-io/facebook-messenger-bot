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
      log_date_format: 'HH:mm:ss.SSS',
      min_uptime: 10000,
      max_restarts: 10,
      restart_delay: 30000,
    },
  ],
};
