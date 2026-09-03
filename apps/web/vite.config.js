import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

// Where the FastAPI service is listening in development.
const API_TARGET = process.env.VITE_API_TARGET ?? "http://127.0.0.1:8000";

const PREFERRED_PORT = Number(process.env.PORT) || 5173;

/*
  Can we actually listen on this port, on the interface Vite will use?

  "Free" is not the same question as "not in use". Windows reserves
  blocks of TCP ports for Hyper-V and the services built on it, and
  binding one of those fails with EACCES, permission denied, while
  nothing is listening on it at all. Which blocks are reserved changes
  on every boot, so a port that worked yesterday can refuse today.
*/
function bindStatus(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    /* Resolve the reason, not just a boolean. The two failures mean
       opposite things to whoever reads the log. EADDRINUSE is another
       process of your own, usually a dev server you forgot. EACCES is
       the OS refusing a port that nobody is using at all. Reporting one
       as the other sends people down the wrong path, which is the one
       thing a helpful message must not do. */
    probe.once("error", (err) => resolve(err.code || "EUNKNOWN"));
    probe.once("listening", () => probe.close(() => resolve(null)));
    /* The same host Vite defaults to, so the probe and the real listen
       resolve to the same interface. On Windows that is ::1, which is
       where the reservation bites. */
    probe.listen(port, "localhost");
  });
}

const WHY = {
  EADDRINUSE: "Something is already listening there, probably another dev server.",
  EACCES:
    "The OS refused it. On Windows that usually means a reserved range:\n" +
    "  netsh interface ipv4 show excludedportrange protocol=tcp",
};

/*
  The first port at or after the preferred one that will actually bind.

  Vite has its own fallback, but it only catches EADDRINUSE, so a
  reserved port kills the dev server outright rather than stepping past
  it. That is the whole reason `npm run dev` needed a flag to work on a
  machine whose reserved range happens to cover 5173.

  The span is wide because Windows reserves in blocks of around a
  hundred and often several in a row, so a handful of attempts can land
  inside the same wall it was trying to climb over.
*/
async function resolvePort(preferred, span = 400) {
  /* Editing this file restarts the dev server inside the same Node
     process, and the outgoing server still holds the port while the new
     config loads. Probing again would see its own predecessor, call the
     port taken, and move on, so every edit to this file would shift the
     dev server to a new port. Remember the first answer and reuse it:
     replacing a server on its own port is Vite's job and it does it
     correctly. process.env survives the config reload, module scope
     does not, which is why the answer is parked there. */
  const settled = Number(process.env.CLASSCONNECT_DEV_PORT);
  if (settled) return settled;

  let firstReason = null;
  for (let port = preferred; port < preferred + span; port += 1) {
    const reason = await bindStatus(port);
    if (reason === null) {
      if (port !== preferred) {
        console.log(
          `\n  Port ${preferred} is unavailable, using ${port} instead.` +
            `\n  ${WHY[firstReason] ?? `The OS reported ${firstReason}.`}\n`,
        );
      }
      process.env.CLASSCONNECT_DEV_PORT = String(port);
      return port;
    }
    // Why the preferred port was refused, which is what to report.
    if (firstReason === null) firstReason = reason;
  }
  /* Nothing in the whole span worked. Hand back the preferred port and
     let Vite report the real error, rather than inventing a confusing
     one here. */
  return preferred;
}

export default defineConfig(async ({ command }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(dir, "./src") },
  },
  server: {
    /* Honour PORT so the preview harness can assign a free port, and
       step past ports the OS will refuse to hand over.

       Only when actually serving. This config factory runs for builds
       too, and probing sockets to pick a dev server port during
       `vite build` is work for a value nothing reads. */
    port: command === 'serve' ? await resolvePort(PREFERRED_PORT) : PREFERRED_PORT,
    /*
      Proxy the API under the same origin as the app. This keeps CORS
      out of local development entirely, and it means the client can use
      relative paths that also work in production where both are served
      from one origin behind a reverse proxy.
    */
    proxy: {
      "/api": {
        target: API_TARGET,
        /*
          Forward the browser's own Host rather than rewriting it to the
          target. The API resolves which tenant a login page belongs to
          from that header, so rewriting it here would make every request
          look like it arrived at 127.0.0.1 and no tenant would ever
          resolve in development.

          changeOrigin exists for targets that do virtual hosting and
          reject an unexpected Host. This one does not, and a reverse
          proxy in production has to forward the real Host for the same
          reason, so this is the production-like setting as well.

          Try it with `horizon.localhost:5173`, which browsers resolve to
          loopback without touching the hosts file, and APP_DOMAIN set to
          `localhost` on the API.
        */
        changeOrigin: false,
      },
    },
  },
}));
