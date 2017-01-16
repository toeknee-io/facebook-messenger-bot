console.dir(process.env);

module.exports = {
  apps: [
    {
      name: 'facebook-messenger-bot',
      script: '/usr/local/nodejs/facebook-messenger-bot.js',
      exec_mode: 'fork',
      instances: 1,
      env: {},
      env_production: {
        NODE_ENV: 'production',
      },
      log_date_format: 'HH:mm:ss.SSS',
    },
  ],
};
