import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4600);

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ service: "pulse-api" }));
});

server.listen(PORT, () => {
  console.log(`pulse-api listening on http://localhost:${PORT}`);
});
