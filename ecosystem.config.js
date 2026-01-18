module.exports = {
  apps: [
    {
      name: "crumbbase-api",
      script: "./server/index.js",
      env: {
        NODE_ENV: "production",
        // Add other env vars here
      },
      // Error handling
      error_file: "./logs/api-err.log",
      out_file: "./logs/api-out.log",
    },
    {
      name: "crumbbase-client",
      script: "npm",
      args: "run dev", // Or 'run preview' if built
      cwd: "./client",
      env: {
        // Envs for client if needed
      },
      error_file: "./logs/client-err.log",
      out_file: "./logs/client-out.log",
    },
  ],
};
