import { randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";

export type TestUser = {
  id: string;
  email: string;
  token: string;
};

// Registers a fresh user through the real sign-up endpoint and returns the
// bearer token the mobile app would get. Emails are unique per call, so tests
// never depend on each other's users.
export async function createTestUser(name = "Test User"): Promise<TestUser> {
  const email = `test-${randomUUID()}@test.local`;
  const res = await request(app)
    .post("/api/auth/sign-up/email")
    .send({ name, email, password: "test-password-123" });

  if (res.status !== 200) {
    throw new Error(`Sign-up failed (${res.status}): ${JSON.stringify(res.body)}`);
  }

  const token = res.headers["set-auth-token"];
  if (!token) {
    throw new Error("Sign-up succeeded but no set-auth-token header was returned");
  }

  return { id: res.body.user.id, email, token };
}

// Deletes the users (and, via cascade, their sessions and recipes).
export async function deleteTestUsers(...users: TestUser[]): Promise<void> {
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

export function authed(user: TestUser) {
  return { Authorization: `Bearer ${user.token}` };
}

// Creates a recipe through POST /recipes and returns its id.
export async function createRecipe(user: TestUser, body: object = {}): Promise<string> {
  const res = await request(app)
    .post("/recipes")
    .set(authed(user))
    .send({ title: "Test Recipe", ingredients: ["1 onion"], instructions: "Cook.", ...body });
  if (res.status !== 201) {
    throw new Error(`Recipe create failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.id;
}

// Logs an attempt through POST /recipes/:recipeId/attempts and returns its id.
export async function createAttempt(user: TestUser, recipeId: string, body: object = {}): Promise<string> {
  const res = await request(app).post(`/recipes/${recipeId}/attempts`).set(authed(user)).send(body);
  if (res.status !== 201) {
    throw new Error(`Attempt create failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.id;
}

// True when an attempt's ingredients column is SQL NULL (not the JSON value `null`).
export async function ingredientsIsSqlNull(attemptId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ isnull: boolean }[]>`
    SELECT ingredients IS NULL AS isnull FROM attempt WHERE id = ${attemptId}`;
  return rows[0].isnull;
}

// A minimal baseline JPEG: SOI, an APP0 (JFIF) segment, an SOF0 frame header
// with the given size, then EOI. Only readJpegSize has to parse it; `extra`
// makes the bytes of each test photo different.
export function makeJpeg(width: number, height: number, { sofMarker = 0xc0, extra = 0 } = {}): Buffer {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [
    0xff, sofMarker, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff,
    width >> 8, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ];
  return Buffer.from([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9, extra & 0xff]);
}

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// A minimal PNG start: signature, then an IHDR chunk (length 13, type, width,
// height, bit depth, colour type, compression, filter, interlace, CRC). Only
// readPngSize has to parse it, so the CRC is left at zero; `extra` makes the
// bytes of each test photo different.
export function makePng(width: number, height: number, { firstChunk = "IHDR", extra = 0 } = {}): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write(firstChunk, 4, "latin1");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr.set([8, 2, 0, 0, 0], 16);
  return Buffer.concat([Buffer.from(PNG_SIGNATURE), ihdr, Buffer.from([extra & 0xff])]);
}

// GIF89a with a 10x10 logical screen: a real image, but not one the server keeps.
export const GIF_HEADER = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x0a, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x00]);

export function b64(data: Buffer) {
  return data.toString("base64");
}
