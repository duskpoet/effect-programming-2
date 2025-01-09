Deno.serve(
  { port: 8080 },
  () => new Response("Hello, world!", { status: 200 }),
);

console.log("Listening on 8080");

