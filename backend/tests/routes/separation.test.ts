import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app, initApp } from "../../src/app.js";

beforeAll(async () => {
  await initApp();
});

describe("POST /api/separation", () => {
  it("returns a path between known players", async () => {
    const res = await request(app)
      .post("/api/separation")
      .send({ player1: "Haaland", player2: "Kevin De Bruyne" });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.separationNumber).toBe(1);
    expect(res.body.path).toHaveLength(2);
  });

  it("returns 400 for missing fields", async () => {
    const res = await request(app)
      .post("/api/separation")
      .send({ player1: "Haaland" });

    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown player", async () => {
    const res = await request(app)
      .post("/api/separation")
      .send({ player1: "Haaland", player2: "Nobody McFakerson" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("player_not_found");
  });
});

describe("POST /api/separation/explore", () => {
  it("returns the aggregated BFS graph for a connected pair", async () => {
    const res = await request(app)
      .post("/api/separation/explore")
      .send({ player1: "Haaland", player2: "Kevin De Bruyne" });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.path.length).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(res.body.clusters)).toBe(true);
    expect(Array.isArray(res.body.layers)).toBe(true);
    expect(res.body.totals.visitedPlayers).toBeGreaterThan(0);
    // Clusters carry a crestUrl slot (null when the club has no crest).
    if (res.body.clusters.length > 0) {
      expect(res.body.clusters[0]).toHaveProperty("crestUrl");
    }
  });

  it("validates input like /separation", async () => {
    const res = await request(app).post("/api/separation/explore").send({ player1: "Haaland" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/players/search", () => {
  it("returns matching players", async () => {
    const res = await request(app).get("/api/players/search?q=Sal");

    expect(res.status).toBe(200);
    expect(res.body.players.length).toBeGreaterThan(0);
    expect(res.body.players[0]).toHaveProperty("name");
    expect(res.body.players[0]).toHaveProperty("clubs");
  });

  it("returns empty for short query", async () => {
    const res = await request(app).get("/api/players/search?q=");

    expect(res.status).toBe(200);
    expect(res.body.players).toHaveLength(0);
  });
});

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.playerCount).toBeGreaterThan(0);
  });
});
