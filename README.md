# ElectroHub — AI-Powered Electronics Commerce Platform

A full-stack, AI-powered electronics e-commerce platform built as a single monorepo.

## Overview

ElectroHub is an electronics commerce platform featuring:

- **Customer Interface** — Browse, search, and purchase electronics products
- **AI-Powered Search** — Search products by image using computer vision
- **Smart Recommendations** — AI-driven product recommendations
- **Real-Time Delivery Tracking** — Live order delivery tracking with maps
- **Admin Dashboard** — Complete product, order, and inventory management

## Tech Stack

| Area | Technology |
|---|---|
| Frontend | React, TypeScript, Vite, SCSS, Radix UI |
| Backend | Node.js, Express, TypeScript, Prisma |
| Database | PostgreSQL (Supabase) |
| AI Service | Python, FastAPI |
| Real-Time | Socket.IO |
| Payments | Stripe (Test Mode) |
| Email | Brevo |
| Maps | Leaflet, OpenStreetMap |
| Infrastructure | Docker, Nginx, DigitalOcean |

## Project Structure

```text
electrohub/
├── apps/
│   ├── frontend/        # React + TypeScript + Vite
│   ├── backend/         # Node.js + Express + TypeScript
│   └── ai-service/      # Python + FastAPI
├── packages/            # Shared packages (when justified)
├── services/            # Shared services (when justified)
├── tests/               # Cross-service tests
├── docs/                # Project documentation
├── infrastructure/      # Deployment configuration
└── .github/             # CI/CD workflows
```

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.11+
- npm 9+

### Installation

```bash
# Install Node.js dependencies (frontend + backend)
npm install

# Set up the AI service
cd apps/ai-service
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
```

### Environment Configuration

Copy the example environment files and configure them:

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
cp apps/ai-service/.env.example apps/ai-service/.env
```

### Development

```bash
# Start the frontend
npm run dev:frontend

# Start the backend
npm run dev:backend

# Start the AI service
cd apps/ai-service
uvicorn app.main:app --reload --port 8000
```

## Documentation

Complete project documentation is available under [`docs/`](./docs/).

## License

MIT
