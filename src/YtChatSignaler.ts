import EventEmitter from './lib/EventEmitter'
import type { Message } from './youtube/events'

// Base URL for the YouTube signaler API
const BASE_URL = "https://signaler-pa.youtube.com/punctual/multi-watch/channel"
// URL to choose the most appropriate server
const CHOOSE_SERVER_URL = "https://signaler-pa.youtube.com/punctual/v1/chooseServer"
// Default API key for YouTube's internal API
const API_KEY = 'AIzaSyDZNkyC-AtROwMBpLfevIvqYk-Gfi8ZOeo'
// Default User-Agent to mimic a real browser
const USER_AGENT = 'Mozilla/5.0 (X11 Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
// Interval to refresh credentials (4 minutes)
const REFRESH_INTERVAL_MS = 4 * 60 * 1000
// Default maximum number of reconnection attempts
const MAX_RECONNECT_ATTEMPTS = 5
// Default initial delay before trying to reconnect
const INITIAL_RECONNECT_DELAY_MS = 1000
// Default maximum time to wait between reconnection attempts (30 seconds)
const MAX_RECONNECT_WAIT_MS = 30000 // 30 seconds

type ConnectionConfigTuple = [
    command: 'c',
    sid: string,
    gsessionid: string,
    version: number,
    aid: number,
    timeoutMs: number,
]

type ConnectRPCData = {
    rpcAid: number
    cuhnkIndex: number
    command: 'c'
    sid: string
    gsessionid: string
    version: number
    aid: number
    timeoutMs: number
}

// Represents the state of a single chat connection
type Chat = {
    chatId: string
    running: boolean
    gsessionid: string
    nextRid: number
    SID: string
    AID: number
    credsToken: string
    reconnectAttempts: number
    refreshInterval?: ReturnType<typeof setInterval>
}

// Configuration options for the Client
export interface ClientOptions {
    // List of YouTube Live Chat IDs to connect to
    chats: string[]
    // User-Agent to use for requests
    userAgent?: string
    // API key for YouTube
    apiKey?: string
    // Maximum number of reconnection attempts. Set to 0 or a negative number for infinite retries
    maxReconnectAttempts?: number
    // Initial delay in milliseconds before the first reconnection attempt
    initialReconnectDelayMs?: number
    // Maximum wait time in milliseconds between reconnection attempts
    maxReconnectWaitMs?: number
}

export type ConnectionEvents = {
    connect: void
    close: { reason: string, code: number, wasCloseCalled: boolean }
    socketError: Event
    // Emitted when trying to reconnect
    reconnecting: { attempts: number, waitTime: number }
    pong: void
    // Emitted when the client parts from a chat
    part: Chat
    // Emitted when raw data is received from the server
    data: {
        messageLength: number
        sequence: number
        data: any
        chatData: Chat
    }
    // Emitted when credentials have been refreshed
    refreshCreds: { gsessionid: string, key: string, chatData: Chat }
    // Emitted when a gsessionid is obtained
    gsessoinId: string
    // Emitted when a SID is obtained
    sid: ConnectRPCData
    // Emitted when a chat connection is successfully established
    connected: Chat
    // Emitted on a PING from the server
    ping: { tms: any, chatData: Chat }
}

export type OtherEvents = {
    ircMessage: [ircMessage: {}]
    connectionError: [error: Error]
}

export type ChatEvents = {
    // Emitted when a chat message is received
    message: Message.Event
}

export type ClientEvents = ConnectionEvents & OtherEvents & ChatEvents

type ToTuples<T extends Record<string, any>> = {
    [K in keyof T]: T[K] extends any[] ? T[K] : T[K] extends void ? [] : [event: T[K]]
}

/**
 * A client for connecting to the YouTube Live Chat signaler
 * This client manages the connection, reconnection, and credential refreshing process
 */
export class YtChatSignaler extends EventEmitter<ToTuples<ClientEvents>> {
    private readonly userAgent: string
    private readonly apiKey: string
    private readonly maxReconnectAttempts: number
    private readonly initialReconnectDelayMs: number
    private readonly maxReconnectWaitMs: number
    private chats: Map<string, Chat> = new Map()
    private channelsPendingJoin: Set<string>

    /**
     * Creates an instance of the YouTube Live Chat Signaler Client
     * @param opts - The client configuration options
     */
    constructor(opts?: Partial<ClientOptions>) {
        super()
        this.userAgent = opts?.userAgent ?? USER_AGENT
        this.apiKey = opts?.apiKey ?? API_KEY
        this.channelsPendingJoin = new Set(opts?.chats ?? [])
        this.maxReconnectAttempts = opts?.maxReconnectAttempts ?? MAX_RECONNECT_ATTEMPTS
        this.initialReconnectDelayMs = opts?.initialReconnectDelayMs ?? INITIAL_RECONNECT_DELAY_MS
        this.maxReconnectWaitMs = opts?.maxReconnectWaitMs ?? MAX_RECONNECT_WAIT_MS
    }


    // Starts the client and initiates connections to the specified chats

    public async start() {
        for (const chatId of this.channelsPendingJoin) {
            this.join(chatId)
        }
    }

    /**
     * Stops the connection to a specific chat
     * @param chatId - The ID of the chat to disconnect from
     */
    public stop(chatId: string) {
        const chatData = this.chats.get(chatId)
        if (chatData) {
            chatData.running = false
            if (chatData.refreshInterval) {
                clearInterval(chatData.refreshInterval)
            }
            this.emit('part', chatData)
            this.chats.delete(chatId)
        }
    }

    /**
     * Joins a chat. This is called by start() for the initial chats
     * @param chatId - The ID of the chat to join
     */
    public async join(chatId: string) {
        if (this.chats.has(chatId)) {
            return
        }

        const chatData: Chat = {
            chatId,
            running: true,
            nextRid: Math.floor(1E5 * Math.random()),
            AID: 0,
            gsessionid: '',
            SID: '',
            credsToken: '',
            reconnectAttempts: 0,
        }
        this.chats.set(chatId, chatData)

        this.connect(chatId)
    }

    /**
     * Manages the main connection lifecycle for a chat
     * @param chatId - The ID of the chat to connect to
     */
    private async connect(chatId: string) {
        const chatData = this.chats.get(chatId)
        if (!chatData || !chatData.running) {
            return
        }

        try {
            await this.chooseServer(chatId)
            await this.getSID(chatId)
            await this.listen(chatId)
            chatData.reconnectAttempts = 0 // Reset on successful connection
        } catch (error) {
            this.handleConnectionError(chatId, error as Error)
        }
    }

    /**
     * Handles connection errors and schedules reconnection attempts
     * @param chatId - The ID of the chat that encountered an error
     * @param error - The error that occurred
     */
    private handleConnectionError(chatId: string, error: Error) {
        const chatData = this.chats.get(chatId)
        if (!chatData || !chatData.running) {
            return
        }

        this.emit('connectionError', error)

        // Stop trying if max attempts are reached (and not infinite)
        if (this.maxReconnectAttempts > 0 && chatData.reconnectAttempts >= this.maxReconnectAttempts) {
            this.emit('connectionError', new Error(`Failed to connect to ${chatId} after ${this.maxReconnectAttempts} attempts.`))
            this.stop(chatId)
            return
        }

        // Calculate exponential backoff with a cap
        const waitTime = this.initialReconnectDelayMs * Math.pow(2, chatData.reconnectAttempts)
        const finalWaitTime = Math.min(waitTime, this.maxReconnectWaitMs)
        chatData.reconnectAttempts++

        this.emit('reconnecting', { attempts: chatData.reconnectAttempts, waitTime: finalWaitTime })

        setTimeout(() => this.connect(chatId), finalWaitTime)
    }

    private createBaseHeaders() {
        return {
            'origin': 'https://www.youtube.com',
            'referer': 'https://www.youtube.com/',
            'User-Agent': this.userAgent,
        }
    }


    // Step 1: Choose the best server to connect to

    private async chooseServer(chatId: string) {
        const chatData = this.chats.get(chatId)
        if (!chatData) throw new Error('Chat data not found for chooseServer')

        const url = `${CHOOSE_SERVER_URL}?key=${this.apiKey}`
        const options: RequestInit = {
            method: 'POST',
            headers: {
                ...this.createBaseHeaders(),
                'Content-Type': 'application/json+protobuf',
            },
            body: `[[null,null,null,[9,5],null,[["youtube_live_chat_web"],[1],[[["chat~${chatId}"]]]]],null,null,0]`
        }

        const req = await fetch(url, options)
        if (!req.ok) throw new Error(`chooseServer failed: ${req.statusText}`)

        const data = await req.json() as [string, number]
        chatData.gsessionid = data[0]
        this.emit('gsessoinId', chatData.gsessionid)

        // Perform an OPTIONS request required by the protocol
        const rid = chatData.nextRid++
        const urlOptions = `${BASE_URL}?VER=8&gsessionid=${chatData.gsessionid}&key=${this.apiKey}&RID=${rid}&CVER=22&zx=${this.randomZX()}&t=1`
        await fetch(urlOptions, {
            method: 'OPTIONS',
            headers: {
                ...this.createBaseHeaders(),
                'access-control-request-headers': 'x-webchannel-content-type',
                'access-control-request-method': 'POST',
            }
        })
    }


    // Step 2: Get the Session ID (SID) for the connection

    private async getSID(chatId: string) {
        const chatData = this.chats.get(chatId)
        if (!chatData || !chatData.gsessionid) throw new Error('gsessionid not found for getSID')

        const encodedParams = new URLSearchParams({
            'count': '1',
            'ofs': '0',
            'req0___data__': `[[["1",[null,null,null,[9,5],null,[["youtube_live_chat_web"],[1],[[["chat~${chatId}"]]]],null,null,1],null,3]]]`
        })

        const rid = chatData.nextRid++
        const url = `${BASE_URL}?VER=8&gsessionid=${chatData.gsessionid}&key=${this.apiKey}&RID=${rid}&CVER=22&zx=${this.randomZX()}&t=1`
        const options = {
            method: 'POST',
            headers: {
                ...this.createBaseHeaders(),
                'Content-Type': 'application/x-www-form-urlencoded',
                'x-webchannel-content-type': 'application/json+protobuf'
            },
            body: encodedParams
        }

        const response = await fetch(url, options)
        if (!response.ok) throw new Error(`getSID failed: ${response.statusText}`)

        const text = await response.text()
        const lines = text.split('\n')
        if (lines.length < 2) throw new Error("Invalid response from getSID.")

        const aid = Number(lines[0])
        const sidData = JSON.parse(lines[1])
        const configData: ConnectionConfigTuple = sidData[0][1]
        const sid = configData[1]

        if (!sid) throw new Error("Could not extract SID from response.")

        chatData.SID = sid
        this.emit('sid', {
            rpcAid: aid,
            cuhnkIndex: sidData[0][0],
            sid,
            timeoutMs: configData[5],
            aid: configData[4],
            command: configData[0],
            gsessionid: configData[2],
            version: configData[3]
        })
    }


    // Step 3: Start long-polling to listen for chat events

    private async listen(chatId: string): Promise<void> {
        const chatData = this.chats.get(chatId)
        if (!chatData || !chatData.SID || !chatData.gsessionid) {
            throw new Error('SID or gsessionid not found for listen')
        }

        const params = {
            'VER': '8',
            'gsessionid': chatData.gsessionid,
            'SID': chatData.SID,
            'RID': 'rpc',
            'TYPE': 'xmlhttp',
            'AID': String(chatData.AID),
            'zx': this.randomZX(),
            't': '1',
            'CI': '0',
            'key': this.apiKey
        }
        const url = `${BASE_URL}?${new URLSearchParams(params)}`

        const headers = {
            ...this.createBaseHeaders(),
            "accept": "text/event-stream",
            "accept-language": "pt-BR,ptq=0.9,en-USq=0.8,enq=0.7",
        }

        chatData.AID++
        const response = await fetch(url, { method: "GET", headers })

        if (!response.ok || !response.body) {
            throw new Error(`Listen request failed: ${response.statusText}`)
        }

        this.startCredentialRefresh(chatId)

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
            if (!this.chats.has(chatId)) { // Stop if chat was removed
                reader.cancel()
                break
            }

            const { done, value } = await reader.read()

            if (done) {
                // If the loop finishes, the connection was closed by the server
                throw new Error("Stream closed by server.");
            }

            buffer += decoder.decode(value)
            buffer = this.processBuffer(buffer, chatId)
        }
    }


    // Processes the raw buffer from the stream, handling chunked messages

    private processBuffer(buffer: string, chatId: string): string {
        while (true) {
            const jsonStartIndex = buffer.indexOf('[')
            if (jsonStartIndex === -1) return buffer

            const lengthPrefixStr = buffer.substring(0, jsonStartIndex)
            const messageLength = parseInt(lengthPrefixStr, 10)

            if (isNaN(messageLength)) {
                console.error("Invalid length prefix:", lengthPrefixStr)
                return buffer.substring(jsonStartIndex)
            }

            const totalMessageLength = lengthPrefixStr.length + messageLength
            if (buffer.length < totalMessageLength) return buffer

            const messageJsonStr = buffer.substring(jsonStartIndex, totalMessageLength)
            this.handleMessage(messageJsonStr, chatId, messageLength)

            buffer = buffer.substring(totalMessageLength)
        }
    }


    // Parses a single message JSON and emits the appropriate event

    private handleMessage(jsonStr: string, chatId: string, messageLength: number) {
        const chatData = this.chats.get(chatId)
        if (!chatData) return

        try {
            const parsedMessage = JSON.parse(jsonStr)
            const sequence = parsedMessage[0][0]
            chatData.AID = sequence

            const credsTokenArr = parsedMessage[0]?.[1]?.[0]?.[2]
            if (sequence === 1 && typeof credsTokenArr?.[0] === 'string') {
                chatData.credsToken = credsTokenArr[0]
                this.emit('connected', chatData)
            } else if (isPingEvent(parsedMessage?.[0])) {
                this.emit('ping', { tms: parsedMessage[0][1][0][0][0][1][2][0], chatData })
            } else {
                this.emit('data', { data: parsedMessage, messageLength, sequence, chatData })
            }
        } catch (e) {
            console.error("Error parsing JSON:", e)
            console.error("JSON with error:", jsonStr)
        }
    }


    // Starts a timer to periodically refresh the connection credentials

    private startCredentialRefresh(chatId: string) {
        const chatData = this.chats.get(chatId)
        if (!chatData || chatData.refreshInterval) return

        chatData.refreshInterval = setInterval(async () => {
            const currentChatData = this.chats.get(chatId)
            if (!currentChatData || !currentChatData.running) {
                if (currentChatData?.refreshInterval) clearInterval(currentChatData.refreshInterval)
                return
            }

            try {
                await fetch(`https://signaler-pa.youtube.com/punctual/v1/refreshCreds?key=${this.apiKey}&gsessionid=${currentChatData.gsessionid}`, {
                    method: "POST",
                    headers: {
                        ...this.createBaseHeaders(),
                        "accept": "*/*",
                        "content-type": "application/json+protobuf",
                    },
                    body: `["${currentChatData.credsToken}"]`,
                })
                this.emit('refreshCreds', {
                    gsessionid: currentChatData.gsessionid,
                    key: this.apiKey,
                    chatData: currentChatData
                })
            } catch (error) {
                this.emit('connectionError', new Error(`Failed to refresh credentials for ${chatId}: ${error}`))
            }
        }, REFRESH_INTERVAL_MS)
    }


    // Generates a random string required by the YouTube API

    private randomZX() {
        return Math.floor(2147483648 * Math.random()).toString(36) +
            Math.abs(Math.floor(2147483648 * Math.random()) ^ Date.now()).toString(36)
    }
}

/**
 * Checks if a received event is a PING event
 * @param event - The event payload
 * @returns True if the event is a PING, false otherwise
 */
function isPingEvent(event: any): boolean {
    const payload = event?.[1]?.[0]?.[0]?.[0]?.[1]
    return (
        Array.isArray(payload) &&
        payload[0] === null &&
        payload[1] === null &&
        typeof payload[2]?.[0] === 'string'
    )
}
