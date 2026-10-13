import { serve } from "@hono/node-server";
import app from "./src/index.js";

const port = Number(process.env.PORT || 3000);

const server = serve(
  {
    fetch: app.fetch,
    port,
    hostname: "0.0.0.0",
  },
  (info) => {
    console.log(`WLOC server listening on port ${info.port}`);
  }
);

process.on("SIGTERM", () => {
  server.close((err) => {
    if (err) console.error(err);
    process.exit(err ? 1 : 0);
  });
});
