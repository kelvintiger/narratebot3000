// TEMPORARY diagnostic: writes 8 chunks 300ms apart to check whether Vercel streams Node responses. Delete after use.
export default async function handler(req, res) {
  res.setHeader('content-type', 'text/plain');
  res.status(200);
  for (let i = 0; i < 8; i++) {
    res.write(`chunk ${i} at ${Date.now()}\n`);
    await new Promise((r) => setTimeout(r, 300));
  }
  res.end();
}
