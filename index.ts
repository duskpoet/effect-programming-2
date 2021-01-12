import {
  serve, ServerRequest,
} from "https://deno.land/std@0.74.0/http/server.ts";
import * as path from "https://deno.land/std@0.74.0/path/mod.ts";
import {
  acceptWebSocket,
} from "https://deno.land/std@0.74.0/ws/mod.ts";
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
  req: ServerRequest;
};

type MiddlewareFn = (options: MiddlewarePayload) => Promise<true | undefined>;

const index: MiddlewareFn = async ({ url, req }: MiddlewarePayload) => {
  if (url.pathname === "/") {
    req.respond({
      body: await Deno.readFile(
        path.resolve(Deno.cwd(), "static/index.html"),
      ),
    });
    return true;
  }
}

const staticFiles: MiddlewareFn = async ({url, req}) => {
  // remove head slash
  const fname = url.pathname.slice(1);
  if (staticMatch.has(fname)) {
    req.respond({
      body: await Deno.readFile(
        path.resolve(Deno.cwd(), fname)
      ),
    });
    return true;
  }
}

const wsMiddleware: MiddlewareFn = async ({ url, req }) => {
  if (url.pathname === '/connect') {
    const sock = await acceptWebSocket({
      conn: req.conn,
      bufReader: req.r,
      bufWriter: req.w,
      headers: req.headers,
    });
    handleWs(sock);
    return true;
  }
}

const combineProcessors = (...fns: MiddlewareFn[]) => async (options: MiddlewarePayload) => {
  for (const fn of fns) {
    const result = await fn(options);
    if (result) {
      return result;
    }
  }
}

const processors = combineProcessors(index, staticFiles, wsMiddleware);

const server = serve({ port: 8080 });

console.log("Listening on 8080");

// для нашей программы не важен host запроса,
// но он нужен для URL
const BASE = "http://localhost";
for await (const req of server) {
  const url = new URL(req.url, BASE);
  const result = await processors({ url, req });
  if (!result) {
    req.respond({ status: 404 });
  }
}