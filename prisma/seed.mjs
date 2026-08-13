/**
 * Seeds the database from prisma/legacy-db.json (the JSON-file "database" the
 * site used before Prisma). Safe to re-run: it only fills empty tables.
 *
 *   node prisma/seed.mjs
 *
 * The first admin user comes from ADMIN_EMAIL / ADMIN_PASSWORD in .env.local,
 * falling back to the values below so a fresh clone still boots.
 */
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

// Load .env / .env.local without pulling in a dotenv dependency
for (const file of [".env", ".env.local"]) {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const prisma = new PrismaClient({
  adapter: new PrismaLibSql({
    url: process.env.DATABASE_URL || "file:./data/gostudy.db",
    authToken: process.env.DATABASE_AUTH_TOKEN,
  }),
});

const LEGACY = path.join(process.cwd(), "prisma", "legacy-db.json");

async function main() {
  const legacy = fs.existsSync(LEGACY)
    ? JSON.parse(fs.readFileSync(LEGACY, "utf8"))
    : null;

  // ── Admin user ──────────────────────────────────────────────
  const email = (process.env.ADMIN_EMAIL || "admin@gostudy.in").toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "cooder@123";
  if ((await prisma.adminUser.count()) === 0) {
    await prisma.adminUser.create({
      data: {
        name: process.env.ADMIN_NAME || "GoStudy Admin",
        email,
        passwordHash: await bcrypt.hash(password, 12),
        role: "owner",
      },
    });
    console.log(`✓ admin user  ${email}`);
  } else {
    console.log("· admin users already exist, skipped");
  }

  if (!legacy) {
    console.warn(
      `! ${path.relative(process.cwd(), LEGACY)} not found — seeded the admin user only, ` +
        "so the catalogue will be empty"
    );
    return;
  }

  // ── Settings + stats ────────────────────────────────────────
  const s = legacy.settings || {};
  if (!(await prisma.setting.findUnique({ where: { id: 1 } }))) {
    await prisma.setting.create({
      data: {
        id: 1,
        siteName: s.siteName ?? "GoStudy",
        tagline: s.tagline ?? "",
        logoUrl: s.logoUrl ?? "",
        heroTitle: s.heroTitle ?? "",
        heroText: s.heroText ?? "",
        promoMediaUrl: s.promoMediaUrl ?? "",
        promoMediaType: s.promoMediaType ?? "image",
        enquiryMode: s.enquiryMode ?? "both",
        whatsappNumber: s.whatsappNumber ?? "",
        legalName: s.legalName ?? "",
        gst: s.gst ?? "",
        contactEmail: s.contactEmail ?? "",
        contactPhone: s.contactPhone ?? "",
        contactAddress: s.contactAddress ?? "",
        mapsLink: s.mapsLink ?? "",
        instagramHandle: s.instagramHandle ?? "",
        instagramUrl: s.instagramUrl ?? "",
        facebookHandle: s.facebookHandle ?? "",
        facebookUrl: s.facebookUrl ?? "",
        stats: {
          create: (s.stats || []).map((st, i) => ({
            label: st.label,
            value: Number(st.value) || 0,
            suffix: st.suffix ?? "+",
            position: i,
          })),
        },
      },
    });
    console.log("✓ settings + stats");
  }

  // ── Price ranges ────────────────────────────────────────────
  if ((await prisma.priceRange.count()) === 0 && legacy.priceRanges?.length) {
    await prisma.priceRange.createMany({
      data: legacy.priceRanges.map((r, i) => ({
        label: r.label,
        min: r.min,
        max: r.max,
        position: i,
      })),
    });
    console.log(`✓ ${legacy.priceRanges.length} price ranges`);
  }

  // ── Categories + subcategories ──────────────────────────────
  // Legacy ids are reused so existing bookmarks like ?category=7 keep working.
  const subIdByKey = new Map(); // `${categoryId}::${name}` -> subcategory id
  if ((await prisma.category.count()) === 0) {
    for (const [i, c] of (legacy.categories || []).entries()) {
      await prisma.category.create({
        data: { id: c.id, name: c.name, position: i },
      });
      for (const [j, name] of (c.subcategories || []).entries()) {
        const sub = await prisma.subcategory.create({
          data: { name, position: j, categoryId: c.id },
        });
        subIdByKey.set(`${c.id}::${name}`, sub.id);
      }
    }
    console.log(`✓ ${legacy.categories?.length ?? 0} categories`);
  } else {
    for (const sub of await prisma.subcategory.findMany()) {
      subIdByKey.set(`${sub.categoryId}::${sub.name}`, sub.id);
    }
  }

  // ── Attributes + options ────────────────────────────────────
  const optionIdByKey = new Map(); // `${attrName}::${value}` -> option id
  if ((await prisma.attribute.count()) === 0) {
    for (const [i, a] of (legacy.attributes || []).entries()) {
      const attr = await prisma.attribute.create({
        data: { id: a.id, name: a.name, position: i },
      });
      for (const [j, value] of (a.options || []).entries()) {
        const opt = await prisma.attributeOption.create({
          data: { value, position: j, attributeId: attr.id },
        });
        optionIdByKey.set(`${a.name}::${value}`, opt.id);
      }
    }
    console.log(`✓ ${legacy.attributes?.length ?? 0} filters`);
  } else {
    const opts = await prisma.attributeOption.findMany({ include: { attribute: true } });
    for (const o of opts) optionIdByKey.set(`${o.attribute.name}::${o.value}`, o.id);
  }

  // ── Products ────────────────────────────────────────────────
  if ((await prisma.product.count()) === 0) {
    for (const [i, p] of (legacy.products || []).entries()) {
      const optionIds = Object.entries(p.attributes || {})
        .map(([name, value]) => optionIdByKey.get(`${name}::${value}`))
        .filter(Boolean);

      await prisma.product.create({
        data: {
          id: p.id,
          name: p.name,
          summary: p.summary ?? "",
          description: p.description ?? "",
          categoryId: p.categoryId ?? null,
          subcategoryId: p.subcategory
            ? subIdByKey.get(`${p.categoryId}::${p.subcategory}`) ?? null
            : null,
          pricingType: p.pricingType === "range" ? "range" : "fixed",
          priceMin: Number(p.priceMin) || 0,
          priceMax: p.pricingType === "range" ? Number(p.priceMax) || 0 : null,
          featured: !!p.featured,
          published: true,
          position: i,
          amazonUrl: p.marketplace?.amazon ?? "",
          flipkartUrl: p.marketplace?.flipkart ?? "",
          meeshoUrl: p.marketplace?.meesho ?? "",
          media: {
            create: (p.media || []).map((m, j) => ({
              url: m.url,
              type: m.type === "video" ? "video" : "image",
              position: j,
            })),
          },
          attributeValues: { create: optionIds.map((optionId) => ({ optionId })) },
        },
      });
    }
    console.log(`✓ ${legacy.products?.length ?? 0} products`);
  }

  // ── Enquiries ───────────────────────────────────────────────
  if ((await prisma.enquiry.count()) === 0 && legacy.enquiries?.length) {
    for (const e of legacy.enquiries) {
      await prisma.enquiry.create({
        data: {
          productId: e.productId ?? null,
          productName: e.productName ?? "",
          name: e.name,
          phone: e.phone,
          email: e.email ?? "",
          deliveryLocation: e.deliveryLocation ?? "",
          priceDemand: e.priceDemand ?? "",
          quantity: e.quantity ?? "",
          message: e.message ?? "",
          createdAt: e.createdAt ? new Date(e.createdAt) : new Date(),
        },
      });
    }
    console.log(`✓ ${legacy.enquiries.length} enquiries`);
  }
}

main()
  .then(() => console.log("Seed complete."))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
