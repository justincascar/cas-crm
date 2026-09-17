import { dbPath, getDb } from "../src/lib/db/connection.ts";

getDb();
console.log("Database ready at", dbPath());
