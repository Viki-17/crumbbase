#!/bin/bash

# Function to kill child processes on exit
cleanup() {
    echo "🛑 Shutting down..."
    kill $(jobs -p) 2>/dev/null
    exit
}

trap cleanup SIGINT SIGTERM

echo "🚀 Starting Project Book..."

# 1. Start Backend
echo "⚙️ Starting Backend Server..."
# Ensure we are in root
node server/index.js &
SERVER_PID=$!

# 2. Start Frontend
echo "🎨 Starting Frontend..."
# Check if we should run dev or preview
# For deployment, usually 'npm run preview' (if built) or 'npm run dev' (if debugging)
# User request says "dev in mac, deployed in ubuntu", likely want simple start.
# Let's default to dev for now as per "npm run dev" usage in history.
cd client && npm run dev &
CLIENT_PID=$!

# Wait for processes
wait $SERVER_PID $CLIENT_PID
