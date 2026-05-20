import { MongoClient } from "mongodb";
import { readFileSync } from "fs";

const env = {};
readFileSync(".env.local", "utf8").split("\n").forEach((l) => {
  const i = l.indexOf("=");
  if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
});

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const col = client.db("RawDB").collection("brand_migration");

const count = await col.countDocuments({
  step: 4,
  brand_logo_png_url: { $exists: true, $nin: [null, ""] },
});

console.log("Step 4 with brand_logo_png_url:", count);
await client.close();
