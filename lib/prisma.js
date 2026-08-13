import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const LOCAL_FALLBACK = "file:./data/gostudy.db";

/**
 * libSQL speaks both a local SQLite file and a hosted Turso database over HTTP,
 * so the only difference between development and production is DATABASE_URL.
 *
 * Because it is HTTP rather than a TCP connection, there is no pool to exhaust —
 * which is what makes it safe on serverless platforms like Vercel, where every
 * request may land in a fresh instance.
 */
function resolveUrl() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    // A serverless filesystem is ephemeral and read-only: silently falling back
    // to a local file would "work" and then lose every write. Fail loudly.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "DATABASE_URL is not set. Production needs a hosted libSQL/Turso database — " +
          "set DATABASE_URL (libsql://…) and DATABASE_AUTH_TOKEN in your host's environment variables."
      );
    }
    return LOCAL_FALLBACK;
  }

  // A file: database is wrong on serverless, where storage is discarded between
  // requests — but it is exactly right on Railway, Render or a VPS, where the
  // file sits on a mounted volume. Only refuse it where it genuinely cannot work.
  if (url.startsWith("file:") && process.env.VERCEL) {
    throw new Error(
      `DATABASE_URL points at a local file (${url}). Vercel discards this data between ` +
        "requests — point it at a hosted Turso database instead."
    );
  }

  return url;
}

function makeClient() {
  const url = resolveUrl();
  const adapter = new PrismaLibSql({
    url,
    // Turso requires a token; a local file must not be given one
    ...(url.startsWith("file:") ? {} : { authToken: process.env.DATABASE_AUTH_TOKEN }),
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// Next.js dev hot-reloads modules; without the global the client count climbs on
// every edit. In production each serverless instance gets exactly one.
const globalForPrisma = globalThis;

function getClient() {
  if (!globalForPrisma.__gostudyPrisma) {
    globalForPrisma.__gostudyPrisma = makeClient();
  }
  return globalForPrisma.__gostudyPrisma;
}

/**
 * Connecting is deferred to the first actual query. `next build` imports every
 * route to collect its metadata, and a build machine has no reason to hold
 * production database credentials — so construction here would fail the build
 * for no good reason.
 */
export const prisma = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getClient();
      const value = client[prop];
      return typeof value === "function" ? value.bind(client) : value;
    },
    has(_target, prop) {
      return prop in getClient();
    },
  }
);
