import { cache } from "react";
import { prisma } from "@/lib/prisma";

/**
 * Read helpers for the public site and the admin dashboard.
 *
 * They deliberately return the same shapes the UI used when the data lived in
 * data/db.json — `subcategory` as a plain name, `attributes` as a name → value
 * map, `marketplace` as one object — so the storage swap stayed invisible to
 * the components.
 *
 * Each is wrapped in React's `cache`, which memoises per request. The layout
 * needs the settings and the category menu on every page, and each page needs
 * some of the same data again — without this, rendering one page runs the same
 * query two or three times. `generateMetadata` and the product page asking for
 * the same product is the clearest case: one query now, not two.
 */

const PRODUCT_INCLUDE = {
  subcategory: true,
  media: { orderBy: { position: "asc" } },
  attributeValues: { include: { option: { include: { attribute: true } } } },
};

export function toProductView(p) {
  const attributes = {};
  for (const { option } of p.attributeValues ?? []) {
    attributes[option.attribute.name] = option.value;
  }
  return {
    id: p.id,
    name: p.name,
    summary: p.summary,
    description: p.description,
    categoryId: p.categoryId,
    subcategory: p.subcategory?.name ?? "",
    pricingType: p.pricingType,
    priceMin: p.priceMin,
    priceMax: p.priceMax,
    attributes,
    media: (p.media ?? []).map((m) => ({ url: m.url, type: m.type })),
    marketplace: {
      amazon: p.amazonUrl,
      flipkart: p.flipkartUrl,
      meesho: p.meeshoUrl,
    },
    featured: p.featured,
    published: p.published,
    position: p.position,
  };
}

export const getSettings = cache(async () => {
  const s =
    (await prisma.setting.findUnique({
      where: { id: 1 },
      include: { stats: { orderBy: { position: "asc" } } },
    })) ?? (await prisma.setting.create({ data: { id: 1 }, include: { stats: true } }));

  return {
    ...s,
    stats: s.stats.map(({ label, value, suffix }) => ({ label, value, suffix })),
  };
});

export const getCategories = cache(async () => {
  const cats = await prisma.category.findMany({
    orderBy: { position: "asc" },
    include: { subcategories: { orderBy: { position: "asc" } } },
  });
  return cats.map((c) => ({
    id: c.id,
    name: c.name,
    subcategories: c.subcategories.map((s) => s.name),
  }));
});

export const getAttributes = cache(async () => {
  const attrs = await prisma.attribute.findMany({
    orderBy: { position: "asc" },
    include: { options: { orderBy: { position: "asc" } } },
  });
  return attrs.map((a) => ({
    id: a.id,
    name: a.name,
    options: a.options.map((o) => o.value),
  }));
});

export const getPriceRanges = cache(async () => {
  const rows = await prisma.priceRange.findMany({ orderBy: { position: "asc" } });
  return rows.map(({ id, label, min, max }) => ({ id, label, min, max }));
});

/** Public catalogue — published products only. */
export const getProducts = cache(async () => {
  const rows = await prisma.product.findMany({
    where: { published: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    include: PRODUCT_INCLUDE,
  });
  return rows.map(toProductView);
});

/** Admin listing — includes unpublished drafts. */
export const getAllProducts = cache(async () => {
  const rows = await prisma.product.findMany({
    orderBy: [{ position: "asc" }, { id: "asc" }],
    include: PRODUCT_INCLUDE,
  });
  return rows.map(toProductView);
});

export const getProduct = cache(async (id) => {
  const p = await prisma.product.findUnique({
    where: { id },
    include: PRODUCT_INCLUDE,
  });
  return p ? toProductView(p) : null;
});

export const getFeaturedProducts = cache(async () => {
  const rows = await prisma.product.findMany({
    where: { published: true, featured: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    include: PRODUCT_INCLUDE,
  });
  return rows.map(toProductView);
});

export const getEnquiries = cache(async () => {
  return prisma.enquiry.findMany({ orderBy: { createdAt: "desc" } });
});

export const getAdminUsers = cache(async () => {
  return prisma.adminUser.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, role: true, createdAt: true, lastLoginAt: true },
  });
});
