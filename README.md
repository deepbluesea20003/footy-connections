# Football Separation Number

Find the shortest connection between any two Premier League players through shared teammates.

## Quick Start

```bash
npm install
npm run dev              # backend on :3000
npm run dev:frontend     # frontend on :5173 (proxies to backend)
```

## Project Structure

```
backend/    Node.js + Express + TypeScript API
frontend/   React + Vite + Tailwind CSS
```

## API

- `POST /api/separation` — `{ player1, player2 }` → shortest path + separation number
- `GET /api/players/search?q=` — autocomplete player search
- `GET /api/health` — status check

## Testing

```bash
npm test
```

## Deploy (Cloud Run)

```bash
docker build -t football-separation .
docker run -p 8080:8080 football-separation
```
