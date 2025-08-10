# yt-chat-signaler

A Node.js client for connecting to the YouTube Live Chat signaler service to receive real-time events.

It is designed to be the backbone for bots, chat archives, or any application that needs to listen to YouTube live chat messages programmatically.

## Features

- ✅ Connect to multiple chat rooms simultaneously.
- ✅ Automatic reconnection with configurable exponential backoff.
- ✅ Automatic credential refreshing.
- ✅ Rich event-based API.
- ✅ Fully typed with TypeScript.

## Installation

```bash
npm install yt-chat-signaler
```

## Basic Usage

Here's a simple example of how to connect to a YouTube live chat and listen for events.

```javascript
import { Client } from 'yt-chat-signaler';

// The video ID of the YouTube live stream.
const videoId = 'YOUR_YOUTUBE_LIVE_VIDEO_ID';

const client = new Client({
  chats: [videoId],
});

client.on('connected', (chatData) => {
  console.log(`Successfully connected to chat for video: ${chatData.chatId}`);
});

client.on('data', ({ data, chatData }) => {
  console.log(`Received data from ${chatData.chatId}:`, JSON.stringify(data));
  // This is where you would parse the 'data' payload to extract chat messages.
});

client.on('error', (error) => {
  console.error('An error occurred:', error);
});

client.on('reconnecting', ({ attempts, waitTime }) => {
  console.log(`Attempting to reconnect... (Attempt #${attempts}, waiting ${waitTime}ms)`);
});

// Start the client
client.start();

// To stop listening to a specific chat
// client.stop(videoId);
```

## Client Configuration

You can pass an options object to the `Client` constructor to customize its behavior.

`new Client(options)`

| Option                    | Type     | Default                        | Description                                                                                             |
| ------------------------- | -------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `chats`                   | `string[]` | `[]`                           | **Required.** An array of YouTube video IDs for the live chats you want to join.                        |
| `apiKey`                  | `string` | (Internal YouTube Key)         | A custom YouTube API key.                                                                               |
| `userAgent`               | `string` | (Chrome on Linux User-Agent)   | A custom User-Agent string for HTTP requests.                                                           |
| `maxReconnectAttempts`    | `number` | `5`                            | Maximum number of reconnection attempts. Set to `0` or a negative number for infinite retries.          |
| `initialReconnectDelayMs` | `number` | `1000`                         | The initial time in milliseconds to wait before the first reconnection attempt.                         |
| `maxReconnectWaitMs`      | `number` | `30000`                        | The maximum time in milliseconds to wait between reconnection attempts. Caps the exponential backoff.   |

## Events

The client is an `EventEmitter` and will emit various events to notify you about the connection status.

-   **`connected`**: `(chatData: Chat)`
    -   Emitted when a connection to a chat is successfully established. `chatData` contains session information.

-   **`data`**: `(payload: { data: any, chatData: Chat, ... })`
    -   Emitted for most messages received from the signaler. The `data` property contains the raw event payload from YouTube, which you can parse to get chat messages, new members, etc.

-   **`reconnecting`**: `(payload: { attempts: number, waitTime: number })`
    -   Emitted when the client is attempting to reconnect after a disconnection.

-   **`error`**: `(error: Error)`
    -   Emitted when a connection error occurs or when the maximum number of reconnection attempts is reached.

-   **`part`**: `(chatData: Chat)`
    -   Emitted when the client disconnects from a chat, usually after `client.stop()` is called.

-   **`ping`**: `(payload: { tms: any, chatData: Chat })`
    -   Emitted when the server sends a PING message to keep the connection alive.

-   **`gsessoinId`**: `(gsessionid: string)`
    -   Emitted after obtaining a `gsessionid` from YouTube's servers.

-   **`sid`**: `(sidData: ConnectRPCData)`
    -   Emitted after obtaining the final Session ID (`SID`).

-   **`refreshCreds`**: `(payload: { gsessionid: string, key: string, chatData: Chat })`
    -   Emitted after the client successfully refreshes its credentials.

## Browser Usage

Directly using this package in a browser (e.g., in a React or Vue application) **will not work** due to CORS (Cross-Origin Resource Sharing) restrictions on YouTube's servers. These APIs are not designed for public, client-side access.

The correct way to use this package for a web application is to run it in a **server-side proxy**.

1.  **Backend (Node.js):** Your server runs `yt-chat-signaler` and connects to YouTube.
2.  **Frontend (Browser):** Your web app connects to *your* backend (using WebSockets, for example).
3.  **Flow:** Your backend receives chat events from YouTube and forwards them to your connected frontend clients.

This architecture is more secure and is the standard way to work with such APIs.

## License

[MIT](LICENSE)
