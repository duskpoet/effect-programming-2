import { WebSocket } from "https://deno.land/std@0.74.0/ws/mod.ts";
import { format } from "https://deno.land/std@0.74.0/datetime/mod.ts";

class Channel {
  private takers: Array<(payload: string) => void> = [];
  private buffer: string[] = [];

  private callTakers() {
    while (this.takers.length > 0 && this.buffer.length > 0) {
      const taker = this.takers.shift()!;
      const payload = this.buffer.shift()!;
      taker(payload);
    }
  }

  take() {
    const p = new Promise<string>((resolve) => {
      this.takers.push(resolve);
    });
    this.callTakers();
    return p;
  }

  put(message: string) {
    this.buffer.push(message);
    this.callTakers();
  }
  async listen(sock: WebSocket) {
    for await (const event of sock) {
      if (typeof event === "string") {
        this.put(event);
      }
    }
  }
}

export async function handleWs(sock: WebSocket) {
  const incoming = new Channel();
  incoming.listen(sock);

  let current: string = "";
  const iter = dialog();
  while (true) {
    const { value: effect, done } = iter.next(current);
    if (!effect) {
      break;
    }
    switch (effect.type) {
      case "say": {
        sock.send(effect.text);
        break;
      }
      case "listen": {
        current = await incoming.take();
        break;
      }
    }
    if (done) {
      break;
    }
  }
}

const say = (text: string) => ({ type: "say", text } as const);
const listen = () => ({ type: "listen" } as const);

function* dialog() {
  yield say('Welcome to "Do what I say BOT"');
  while (true) {
    const message: string = yield listen();
    if (message.toLowerCase().includes("time")) {
      yield say(`It is ${format(new Date(), "HH:mm:ss")}`);
    } else if (message.toLowerCase().includes("sum")) {
      yield* sumSubDialog();
    } else {
      yield say(`I don't know what to say!`);
    }
  }
}

function* sumSubDialog() {
  yield say("Okay, what numbers should we sum?");
  let result = 0;
  let message = yield listen();
  while (true) {
    const num = Number(message);
    if (isNaN(num)) {
      break;
    } else {
      result += num;
    }
    yield say("Got it!");
    message = yield listen();
  }
  yield say(`The result is: ${result}`);
}
