/**
 * Image search endpoint — used by the authoring UI when picking a background
 * image. Aggregates Unsplash + Pexels + Pixabay + Wikimedia behind one query.
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { imageSearch } from "../workers/services.js";

const SearchQuerySchema = z.object({
  q: z.string().min(2),
  perProvider: z.coerce.number().int().positive().max(20).optional(),
  aspect: z.enum(["16:9", "1:1", "any"]).optional(),
});

export const searchRoute = new Hono()
  .get("/images", zValidator("query", SearchQuerySchema), async (c) => {
    const { q, perProvider, aspect } = c.req.valid("query");
    const results = await imageSearch.search(q, { perProvider, aspect });
    return c.json({ results });
  });
