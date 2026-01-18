#!/bin/bash

echo "🚀 Starting Project Setup..."

# 1. Check Requirements
echo "📦 Checking system requirements..."
command -v node >/dev/null 2>&1 || { echo >&2 "❌ Node.js is required but not installed. Aborting."; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo >&2 "❌ Python3 is required but not installed. Aborting."; exit 1; }

# 2. Install Node Dependencies
echo "📥 Installing Node.js dependencies..."
npm install
cd client && npm install
cd ..

# 3. Install PM2 (Process Manager)
echo "⚙️ Checking for PM2..."
command -v pm2 >/dev/null 2>&1 || {
    echo "⬇️ PM2 not found. Installing globally..."
    npm install -g pm2 || { echo "⚠️ Global install failed. Trying local install..."; npm install pm2; }
}

# 3. Platform Specific Setup (TTS)
OS="$(uname -s)"
ARCH="$(uname -m)"

echo "🖥️ Detect Platform: $OS ($ARCH)"

if [ "$OS" = "Linux" ]; then
    echo "🐧 Linux detected. Setting up Piper TTS..."
    
    # Define Piper URL based on Arch
    PIPER_URL=""
    if [ "$ARCH" = "x86_64" ]; then
        PIPER_URL="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz"
    elif [ "$ARCH" = "aarch64" ]; then
        PIPER_URL="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_aarch64.tar.gz"
        # Note: server/piper/piper binary must be arm64 compatible
    else
        echo "⚠️ Warning: Unsupported Architecture for auto-download ($ARCH). Skipping Piper setup."
    fi

    if [ ! -z "$PIPER_URL" ]; then
        # Create directories
        mkdir -p server/piper
        mkdir -p server/models/piper

        # Check if Piper binary exists
        if [ ! -f "server/piper/piper" ]; then
            echo "⬇️ Downloading Piper binary..."
            curl -L -o server/piper.tar.gz "$PIPER_URL"
            tar -xzf server/piper.tar.gz -C server/piper --strip-components=1
            rm server/piper.tar.gz
            echo "✅ Piper binary installed."
        else
            echo "✅ Piper binary already exists."
        fi

        # Download Voice Model (En US Lessac Medium)
        if [ ! -f "server/models/piper/en_US-lessac-medium.onnx" ]; then
            echo "⬇️ Downloading Voice Model..."
            curl -L -o server/models/piper/en_US-lessac-medium.onnx https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx
            curl -L -o server/models/piper/en_US-lessac-medium.onnx.json https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json
            echo "✅ Voice model installed."
        fi
    fi

elif [ "$OS" = "Darwin" ]; then
    echo "🍎 macOS detected. Using native 'say' command (No Piper download needed)."
else
    echo "⚠️ Unknown OS. Skipping TTS setup."
fi

echo "✅ Setup Complete! Run './start.sh' to launch."
