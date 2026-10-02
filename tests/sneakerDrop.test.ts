import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

describe("Sneaker Drop", () => {
  it("returns health status", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);

    expect(response.body.status).toBe("ok");
  });

  it("requires a userId", async () => {
    const response = await request(app).post("/api/buy").send({});

    expect(response.status).toBe(400);
  });

  it("requires userId for status", async () => {
    const response = await request(app).get("/api/status");

    expect(response.status).toBe(400);
  });
});
