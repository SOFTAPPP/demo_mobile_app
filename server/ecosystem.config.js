module.exports = {
  apps: [
    {
      name: 'sangeet-arghya-server',
      script: './dist/index.js',
      instances: 'max', // Use all CPU cores for clustering
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
  ],
};
