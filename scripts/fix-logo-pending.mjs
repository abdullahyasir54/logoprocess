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

const filter = {
  logo_pending: true,
  brand_logo_png_url: { $exists: true, $nin: [null, ""] },
  og_image_jpg_url: { $exists: true, $nin: [null, ""] },
};

const preview = await col.countDocuments(filter);
console.log(`Matched docs: ${preview}`);

const result = await col.updateMany(filter, { $unset: { logo_pending: "" } });
console.log(`Updated: ${result.modifiedCount}`);

await client.close();
