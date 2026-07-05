import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { authEnabled, checkPassword, issueSessionToken } from "../lib/auth.js";

export const authRoute = new Hono()
  .get("/status", (c) => c.json({ enabled: authEnabled() }))
  .post("/login", zValidator("json", z.object({ password: z.string().min(1) })), async (c) => {
    if (!authEnabled()) return c.json({ ok: true, note: "auth disabled (LP_ADMIN_PASSWORD not set)" });
    const { password } = c.req.valid("json");
    if (!checkPassword(password)) {
      // Small fixed delay blunts brute-force attempts without a rate-limiter.
      await new Promise((r) => setTimeout(r, 750));
      return c.json({ ok: false, error: "wrong password" }, 401);
    }
    setCookie(c, "lp_session", issueSessionToken(), {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    return c.json({ ok: true });
  })
  .post("/logout", (c) => {
    deleteCookie(c, "lp_session", { path: "/" });
    return c.json({ ok: true });
  });
