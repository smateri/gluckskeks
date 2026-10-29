import { getStore } from "@netlify/blobs";

// GET  /api/count  -> aktuellen Zählerstand lesen
// POST /api/count  -> Zähler um 1 erhöhen
export default async (req) => {
  const store = getStore({ name: "gluckskeks", consistency: "strong" });

  let count = Number(await store.get("count")) || 0;

  if (req.method === "POST") {
    count += 1;
    await store.set("count", String(count));
  }

  return Response.json(
    { count },
    { headers: { "Cache-Control": "no-store" } }
  );
};

export const config = { path: "/api/count" };
