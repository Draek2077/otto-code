/** Thrown by request parsing/validation; the router maps it to a 400 response. */
export class BadRequestError extends Error {}

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) {
    throw new BadRequestError("request body is empty");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new BadRequestError("request body is not valid JSON");
  }
}
