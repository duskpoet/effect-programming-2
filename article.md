# Effect Programming in JavaScript

In the [previous article](https://duskpoet.github.io/about/blog/iterators-and-generators-1.html), I talked about iterators and generators in JavaScript but did not provide any practical examples. With this article, I aim to fill this gap and demonstrate the specific pattern using generators through a simple web application.

This article may also be helpful for those looking to understand how redux-saga works.

Additionally, I have been eager to explore **Deno** (an alternative to Node) and will be using it as the runtime environment for the code, so the examples will be in TypeScript this time.

TLDR - [Code](https://github.com/duskpoet/effect-programming-2)

## A bit about Deno

Since I've mentioned **Deno**, let me provide a brief overview of it. Deno is a runtime environment for executing JavaScript and TypeScript code, serving as an alternative to Node.js. Here are its main differences from Node:

- Native TypeScript support: Deno supports TypeScript natively, meaning you don't have to manually transpile TypeScript into JavaScript; Deno's subsystem takes care of this for you.
- Permission-based system: Deno's permissions are based on command-line flags, providing more control over what authority a script can have when running.
- Full URLs instead of package names: In Deno, you specify full URLs instead of package names, allowing you to use different versions of packages within the same program.
- Modern standard library: Deno comes with its own set of standard utilities that offer a more modern API compared to Node.js. For instance, all asynchronous operations return promises instead of relying on callbacks.

## The application
So, what will our web application look like:

It will be a chatbot capable of doing just a few things:

- Reporting the current time
- Adding numbers
- It will be able to interact with multiple users simultaneously

The web interface will be designed as follows:

![web interface ui](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/r2lnq7p9h92x84j889zd.png)

For creating a web server with WebSocket support in Deno, specialized libraries are not required. Standard functions will be sufficient for our task. But first...

## A bit more about generators
In the previous article, I introduced generators and iterators, but I covered only a fraction of what they are capable of. In this article, I won't cover all aspects either, but I'll focus on two features that will be useful for solving our initial task.

### Asynchronous Iterators
On each invocation, an iterator returns some value. If the value returned for each step is a promise, such an iterator is referred to as an asynchronous iterator. For such iterators, we can traverse them using a special kind of loop: _for await_. For this to work, the object we want to support traversal with this loop must have a special method called _Symbol.asyncIterator_, which returns an asynchronous iterator (generators created with the _async_ keyword return asynchronous iterators).

Example:
```javascript
async function* timer() {
  let i = 0;
  while (true) {
    yield new Promise(
      (resolve) => setTimeout(() => resolve(++i), 1000)
    );
  }
}

for await (const tick of timer()) {
  console.log(tick);
}
// 1 2 3 ... 
```

### yield*
In addition to the _yield_ operator used to return the current value of an iterator, there exists the _yield*_ operator. It takes an iterator as a parameter and sequentially returns all its values. Into a generator, it returns the output of the iterator (the first value for which _done_ is true, or in the case of a generator, the value passed to the _return_).

```typescript
function* concat<T>(...iterables: Iterable<T>[]) {
  for (const iter of iterables) {
    yield* iter;
  }
}

for (const i of concat([1, 2], [3, 4])) {
  console.log(i);
}
// 1 2 3 4
```

## The code
Creating an HTTP server listening on a specific port is straightforward in Deno:
```typescript
import { serve } from "https://deno.land/std@0.74.0/http/server.ts";

const server = serve({ port: 8080 });
console.log("Listening on 8080");

for await (const req of server) {
  req.respond({ status: 200, body: 'Hello, world!' });
}
```
[Github](https://github.com/duskpoet/effect-programming-2/blob/master/index.ts#L78)

As you can see, the server resulting from the serve function call is an asynchronous iterator. Each invocation of the _next_ method returns a promise that resolves when an incoming connection is received.

Next, we need two things from our server: serving static files and handling WebSocket connections. Let's create a simple helper that chains request handlers together, similar to middlewares in Express.

```typescript
type MiddlewarePayload = {
  url: URL;
  req: ServerRequest;
};

type MiddlewareFn = (options: MiddlewarePayload) => Promise<true | undefined>;

const combineProcessors = (...fns: MiddlewareFn[]) => async (options: MiddlewarePayload) => {
  for (const fn of fns) {
    const result = await fn(options);
    if (result) {
      return result;
    }
  }
}
```
[Github](https://github.com/duskpoet/effect-programming-2/blob/master/index.ts#L65)

Each handler passed into such a combiner should return a promise that resolves to true if it processed the request; otherwise, it resolves to _undefined_.

Ultimately, the request handling code will look like this:

```typescript
const processors = combineProcessors(index, staticFiles, wsMiddleware);

const server = serve({ port: 8080 });

console.log("Listening on 8080");

// The request's host is not important for our program,
// but it's required for the URL constructor
const BASE = "http://localhost";
for await (const req of server) {
  const url = new URL(req.url, BASE);
  const result = await processors({ url, req });
  if (!result) {
    req.respond({ status: 404 });
  }
}
```
[Github](https://github.com/duskpoet/effect-programming-2/blob/67e6cb76d5da7fb40f76f2b3867c3c666c68d327/index.ts#L79)


I won't explain the _index_ and _staticFiles_ functions here, as they handle serving static files and can be found on GitHub if you're interested. However, let's delve into the WebSocket connection handler in more detail.

## Channels
The concept of channels existed long before the birth of the JavaScript language. This model describes inter-process communication and messaging in an asynchronous environment. Native implementations of channels can be found in many modern programming languages, such as **Go**, **Rust**, **Kotlin**, **Clojure**, and others.

If you are familiar with the concept of streams, transitioning to channels will be relatively straightforward. A stream, like a channel, provides asynchronous access to sequential data. The main difference lies in their access models: a stream uses a subscription model (when a message arrives, call the handler), while channels use a blocking model (give me the next message, and don't proceed until it arrives). Here's an example of their usage:

```typescript
/** Streams **/
const stream = new Stream();
stream.subscribe(callback);
// Somewhere else in the code
stream.emit(data);

/** Channels **/
const ch = new Channel();
// Somewhere else in the code
ch.put(data);
// Somewhere else in the code
const data = await ch.take();
```

Here is how channels are implemented in our example:
```typescript
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
```
[Github](https://github.com/duskpoet/effect-programming-2/blob/67e6cb76d5da7fb40f76f2b3867c3c666c68d327/handleWs.ts#L4)

Explanation of what is happening here:

- There is an array `buffer`, where incoming messages are stored.
- There is an array `takers`, where functions to resolve promises are stored.
- On each put (put a message into the channel) and take (wait for and take a message from the channel) method call, a check is made to see if there is at least one message in the buffer and at least one taker. If so, the message is resolved, removed from the buffer, and the taker is removed from the takers array.
- There is also a helper `listen` method, which subscribes to all messages from the given socket and puts them into the channel.

Why did we need a channel in the first place? What's wrong with the subscription model? This will become evident later; for now, I'll just say that this allows us to write asynchronous code as if it were synchronous (which is precisely what _async/await_ were created for).

## What about generators?

Indeed, if you were expecting to see the practical application of generators earlier in the article, you might have been surprised. However, the time has come to explore the core concept.

As a reminder of what we aim to achieve and what we already have: we receive messages from users via a WebSocket into a channel, and in response, we send messages from the bot back to the user via WebSocket.

Let's define the shape of an "effect":
```typescript
type Effect = {
  type: string;
  [key: string]: any;
};
```

If you are familiar with the Flux or Redux architecture, you will recognize this structure — it's very similar to an action! In our case, the effect will serve a very similar purpose. In Redux, the following formula applies:
```typescript
const newState = reducer(state, action);
```

For us, it will work like this:
```typescript
while (true) {
  const { value: effect, done } = iter.next(current);
  // Code to handle the effect goes here
  if (done) break;
}

```

Here's the idea: let's represent our entire dialogue with users as a generator. This generator will yield effects and accept the results of handling these effects. We'll have a special code that runs the generator and also handles the effects. And here it is:

```typescript
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
```
[Github](https://github.com/duskpoet/effect-programming-2/blob/67e6cb76d5da7fb40f76f2b3867c3c666c68d327/handleWs.ts#L37)

This function is called when a new WebSocket connection is established.

We use two types of effects (though there could be as many as needed):

- _say_ effect - indicates that we need to send a response to the user.
- _listen_ effect - indicates that we need to wait for a message from the user.
Although the loop is infinite, it won't cause any blocking of the process, thanks to the presence of `await` inside the loop. This will interrupt the execution of the loop until a message is received in the channel. This is made possible by the use of channels.

Now let's take a look at how the actual dialogue looks:
```typescript
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
```
[Github](https://github.com/duskpoet/effect-programming-2/blob/67e6cb76d5da7fb40f76f2b3867c3c666c68d327/handleWs.ts#L64)

The dialogue is represented as a generator that yields different effects at each step. The _say_ effect is executed immediately, sending a message to the socket, and the generator's code continues without waiting for data from the external environment. The _listen_ effect suspends the generator's execution until a message is received, which is then immediately passed back to the generator.

The advantages of this approach are as follows:

- Conciseness: Generators provide a compact and readable representation of business logic, as long as the code does not become too deeply nested (which can be mitigated by decomposing generators).
- Convenience of decomposition: You can split the main generator's logic into multiple sub-generators using the _yield*_ operator, which simplifies code structuring.
- Simplicity of effects: Effects are simple structures, well-typed, easily constructed, and can be serialized and transmitted over the network (though the use case for this is not immediately clear).
- Isolation of dialogues: Each call to the generator returns a new iterator with its own closure, enabling multiple parallel dialogues without resource leaks (assuming no global variables are used inside the generator).

One major downside to this approach is that the types of returned values from the _yield_ operator are not automatically inferred. This is logical since the generator's code serves as a signature, and the type of what can be passed to the next of the created iterator is already inferred from it. Therefore, types for the yielded values have to be manually provided in our approach.

I want to highlight an important aspect of this approach: The code inside the generator (the dialogue description) is very abstract. It doesn't deal with message passing through channels, error handling for transmission, or anything specific to the execution environment. It represents pure business logic — precise and noiseless description of business processes.

In an ideal scenario, the generator should be a pure function. For a generator, this means that for the same input parameters, the returned iterators should be identical (the same sequence of input data generates the same sequence of output values). The purity of generators ensures the encapsulation of business logic, meaning it describes specific use case and doesn't rely on the execution environment. It also makes it easy to write tests for your business logic: you just need to check that the sequence of effects returned by the generator matches the expected sequence.

## Want to read more?

1. [js-csp](https://github.com/js-csp/js-csp). CSP in js implementation.
1. [redux-saga](https://redux-saga.js.org/). The most popular effects library in js
1. [Coroutines](https://www.wikiwand.com/en/Coroutine)

