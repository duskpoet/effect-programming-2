import * as path from "node:path";
import { handleWs } from "./handleWs.ts";

const staticMatch: Set<string> = new Set();
function walkStaticFiles(root: string) {
  for (const f of Deno.readDirSync(path.resolve(Deno.cwd(), root))) {
    const c = path.join(root, f.name);
    if (f.isFile) {
      staticMatch.add(c);
    } else if (f.isDirectory) {
      walkStaticFiles(c);
    }
  }
}

walkStaticFiles("static");

console.log("Static files: ", staticMatch);

type MiddlewarePayload = {
  url: URL;
  req: Request;
};

type MiddlewareFn = (
  options: MiddlewarePayload,
) => Promise<Response | undefined>;

const index: MiddlewareFn = async ({ url }: MiddlewarePayload) => {
  if (url.pathname === "/") {
    return new Response(
      await Deno.readFile(path.resolve(Deno.cwd(), "static/index.html")),
    );
  }
};

const staticFiles: MiddlewareFn = async ({ url }) => {
  // remove head slash
  const fname = url.pathname.slice(1);
  if (staticMatch.has(fname)) {
    return new Response(await Deno.readFile(path.resolve(Deno.cwd(), fname)));
  }
};

const wsMiddleware: MiddlewareFn = async ({ url, req }) => {
  if (url.pathname === "/connect") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    socket.addEventListener("open", () => {
      handleWs(socket);
    });
    return response;
  }
};

const combineProcessors =
  (...fns: MiddlewareFn[]) =>
  async (options: MiddlewarePayload) => {
    for (const fn of fns) {
      const result = await fn(options);
      if (result) {
        return result;
      }
    }
  };

const processors = combineProcessors(index, staticFiles, wsMiddleware);

const BASE = "http://localhost";

Deno.serve({ port: 3000 }, async (req) => {
  const url = new URL(req.url, BASE);
  const result = await processors({ url, req });
  return result || new Response("Not found", { status: 404 });
});
