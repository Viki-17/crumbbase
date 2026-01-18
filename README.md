# Project Book - AI Chapter Insights & TTS

A specialized application for processing PDF books into structural insights, atomic notes, and audio overviews.

## 🚀 Quick Start (Development & Deployment)

The project comes with automated scripts for setting up the environment on **macOS** and **Ubuntu Linux**.

### 1. Prerequisites

- **Node.js** (v18+)
- **Python 3.10+** (for Linux TTS only)

### 2. Setup

Run the setup script to install dependencies and configure TTS:

```bash
chmod +x setup.sh
./setup.sh
```

> **Note**: On Linux, this will automatically download the **Piper TTS** binary and `en_US-lessac-medium` voice model to `server/piper/` and `server/models/`. On macOS, it relies on the native `say` command.

### 3. Run

Start both backend and frontend with a single command:

```bash
chmod +x start.sh
./start.sh
```

- **Backend API**: http://localhost:3001
- **Frontend App**: http://localhost:5173

---

## 🎙 Text-to-Speech (TTS) Architecture

This application uses a hybrid TTS approach to behave optimally on different operating systems while constrained to **4vCPU / 8GB RAM**.

| OS                 | Engine                 | Description                                          |
| :----------------- | :--------------------- | :--------------------------------------------------- |
| **macOS**          | `say` (Native)         | Zero-dependency, zero-RAM overhead system TTS.       |
| **Linux (Ubuntu)** | `Piper` (Local Neural) | Runs local neural TTS via binary. Optimised for CPU. |

### Configuration

- **Audio Cache**: Generated audio is stored in `server/uploads/audio/`.
- **Gitignore**: Models and binaries are explicitly excluded (`server/piper/`, `server/models/`) to keep the repo light.

## 🛠 Deployment on Ubuntu Server

1. Clone repository.
2. Run `./setup.sh` (This downloads the required Piper binary for `x86_64` or `arm64`).
3. Run `./start.sh` (Ensure ports 3001 and 5173 are open or reverse-proxied).

## 📂 Project Structure

- `client/`: React/Vite Frontend.
- `server/`: Node.js Express Backend.
  - `services/tts-service.js`: Handles OS-specific TTS logic.
  - `worker.js`: Background job processor (RabbitMQ integration).
- `setup.sh`: Environment bootstrapper.
- `start.sh`: Runner script.
