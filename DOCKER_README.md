# Docker Setup

This project includes Docker configurations for both the frontend and backend services.

## Prerequisites

- Docker
- Docker Compose

## Quick Start

1. **Build and run all services:**
   ```bash
   docker-compose up --build
   ```

2. **Run in detached mode:**
   ```bash
   docker-compose up -d --build
   ```

3. **Stop all services:**
   ```bash
   docker-compose down
   ```

## Access the Application

- **Frontend:** http://localhost:3000
- **Backend:** http://localhost:3001

## Individual Service Commands

### Backend Only
```bash
# Build the backend image
docker build -t bbd-team12-backend ./backend

# Run the backend container
docker run -p 3001:3001 bbd-team12-backend
```

### Frontend Only
```bash
# Build the frontend image
docker build -t bbd-team12-frontend ./frontend

# Run the frontend container
docker run -p 3000:3000 bbd-team12-frontend
```

## Development

For development, you might want to use volume mounts to enable hot reloading:

```bash
# Development mode with volume mounts (add to docker-compose.yml if needed)
docker-compose -f docker-compose.dev.yml up
```

## Troubleshooting

1. **Port conflicts:** Make sure ports 3000 and 3001 are not in use by other applications
2. **Build issues:** Try rebuilding without cache: `docker-compose build --no-cache`
3. **Network issues:** Ensure the backend service is running before the frontend tries to connect

## Environment Variables

The following environment variables are configured:

### Backend
- `NODE_ENV=production`
- `PORT=3001`

### Frontend
- `NODE_ENV=production`
- `NEXT_PUBLIC_BACKEND_URL=http://backend:3001`

You can override these in the `docker-compose.yml` file as needed.
