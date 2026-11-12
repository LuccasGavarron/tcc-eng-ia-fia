import { defineConfig, loadEnv } from "vite";

// Em desenvolvimento, serve /api/analise com a mesma função do Vercel.
export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return {
    plugins: [{
      name: "api-local",
      configureServer(server) {
        server.middlewares.use("/api/analise", async (req, res) => {
          const { POST } = await server.ssrLoadModule("/api/analise.js");
          let body = ""; for await (const c of req) body += c;
          const r = await POST(new Request("http://local/api/analise", { method: "POST", body }));
          res.statusCode = r.status; res.setHeader("content-type", "application/json"); res.end(await r.text());
        });
      },
    }],
  };
});
