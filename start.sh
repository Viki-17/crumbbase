#!/bin/bash

echo "🚀 Starting Crumbbase with PM2..."

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 could not be found. Please run ./setup.sh first."
    exit 1
fi

# Create logs directory if it doesn't exist
mkdir -p logs

# Start using ecosystem file
pm2 start ecosystem.config.js

# Save list (optional, good for server persistence)
# pm2 save

echo "✅ Crumbbase started!"
echo "📊 Run 'pm2 status' to see process status."
echo "📝 Logs are in ./logs/"
echo "🛑 To stop: 'pm2 stop ecosystem.config.js' or 'pm2 stop all'"
