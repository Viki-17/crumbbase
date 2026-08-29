module.exports = {
  apps: [
    {
      // OpenCode AI server sidecar — the backend talks to this over HTTP
      // (see server/services/opencode-client.js). Uses your opencode-go login
      // from ~/.local/share/opencode/auth.json, so it must run as your user.
      name: "crumbbase-opencode",
      script: "opencode",
      args: "serve --port 4096 --hostname 127.0.0.1",
      env: {
        NODE_ENV: "production",
      },
      error_file: "./logs/opencode-err.log",
      out_file: "./logs/opencode-out.log",
    },
    {
      name: "crumbbase-api",
      script: "./server/index.js",
      cron_restart: "0 0 * * *",
      env: {
        NODE_ENV: "production",
        OPENCODE_SERVER_URL: "http://127.0.0.1:4096",
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
