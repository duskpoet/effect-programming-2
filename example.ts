import { serve } from "https://deno.land/std@0.74.0/http/server.ts";

const server = serve({ port: 8080 });

console.log("Listening on 8080");

const BASE = "http://localhost";
for await (const req of server) {
	req.respond({ status: 200, body: 'Hello, world!' });
}