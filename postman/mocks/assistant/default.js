const http = require("node:http");
http
  .createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/openai/v1/chat/completions") {
      res.writeHead(501).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks).toString());
    const input = JSON.parse(request.messages[1].content);
    const scenario = input.instruction;
    if (scenario === "hang") return;
    if (["429", "503", "html"].includes(scenario)) {
      res.writeHead(scenario === "html" ? 502 : Number(scenario), {
        "content-type": scenario === "html" ? "text/html" : "application/json",
      });
      res.end(scenario === "html" ? "<html>synthetic failure</html>" : "{}");
      return;
    }
    if (scenario === "malformed") {
      res.writeHead(200).end("not JSON");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        choices: [
          {
            finish_reason: scenario === "truncated" ? "length" : "stop",
            message: {
              content: JSON.stringify({
                answer: "Synthetic explanation; no facts invented.",
                refused: false,
                edits: [],
              }),
              refusal: scenario === "refusal" ? "synthetic refusal" : null,
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    );
  })
  .listen(process.env.PORT);
