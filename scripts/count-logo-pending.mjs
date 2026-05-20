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
const count = await col.countDocuments({ logo_pending: true });
console.log("logo_pending: true remaining:", count);
await client.close();
