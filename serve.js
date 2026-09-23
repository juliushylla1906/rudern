// Minimaler statischer Server fuer ./app (Web Bluetooth braucht localhost oder HTTPS)
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "app");
const port = process.env.PORT || 8080;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png" };

http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
  if (!p.startsWith(root)) return res.writeHead(403).end();
  fs.readFile(p, (err, data) => {
    if (err) return res.writeHead(404).end("not found");
    res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" }).end(data);
  });
}).listen(port, () => console.log(`http://localhost:${port}`));
