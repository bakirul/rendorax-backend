"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const cors_1 = __importDefault(require("cors"));
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const http_1 = require("http"); // 🚀 Node.js HTTP server
const socket_io_1 = require("socket.io"); // 🚀 Socket.io Server
const ws_1 = __importDefault(require("ws")); // 🚀 OpenAI Realtime WS Client
const generative_ai_1 = require("@google/generative-ai");
const upload_routes_1 = __importDefault(require("./src/routes/upload.routes"));
const media_routes_1 = __importDefault(require("./src/routes/media.routes"));
const connectionString = process.env.DATABASE_URL;
// PostgreSQL পুল এবং অ্যাডাপ্টার সেটআপ
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
// নতুন নিয়মে PrismaClient তৈরি
const prisma = new client_1.PrismaClient({ adapter });
const app = (0, express_1.default)();
app.locals.prisma = prisma;
const PORT = process.env.PORT || 4000;
const genAI = new generative_ai_1.GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
async function translateWithGemini(text, targetLang) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.0-pro" });
    const prompt = `Translate the following text to ${targetLang}. Return ONLY the translated text, nothing else. Text: ${text}`;
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
}
const allowedOrigins = [
    "http://localhost:3000",
    "https://rendorax-media-web.vercel.app",
    "https://rendorax.com",
    "https://www.rendorax.com"
];
app.use((0, cors_1.default)({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
}));
app.use(express_1.default.json());
// 🚀 HTTP সার্ভার তৈরি এবং Socket.io কনফিগারেশন
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    },
});
const clientLanguages = {};
// Map: roomId -> targetLang -> WebSocket
const openAIConnections = {};
io.on("connection", (socket) => {
    console.log(`🔌 New client connected: ${socket.id}`);
    // ইউজার কোনো নির্দিষ্ট ভিডিওর রুমে জয়েন করলে
    socket.on("join-video-room", (room) => {
        socket.join(room);
        console.log(`Client joined video room: ${room}`);
    });
    // গ্লোবাল লবিতে জয়েন করলে
    socket.on("join-lobby", (userId) => {
        socket.join("global-lobby");
    });
    // 🌐 Register preferred language for multiplexer
    socket.on("join-room-language", (lang) => {
        clientLanguages[socket.id] = lang;
        console.log(`🌐 Client ${socket.id} set language to ${lang}`);
    });
    // 🔴 ভিডিও প্লে ইভেন্ট ব্রডকাস্ট
    socket.on("video-play", (data) => {
        console.log(`▶️ PLAY signal received from front-end for room: ${data.room}`);
        socket.to(data.room).emit("video-play", data);
    });
    // 🔴 ভিডিও পজ ইভেন্ট ব্রডকাস্ট
    socket.on("video-pause", (data) => {
        socket.to(data.room).emit("video-pause", data);
    });
    // 🔴 ভিডিও সিক (টাইম চেঞ্জ) ইভেন্ট ব্রডকাস্ট
    socket.on("video-seek", (data) => {
        socket.to(data.room).emit("video-seek", data);
    });
    // 🔴 নতুন কমেন্ট ব্রডকাস্ট
    socket.on("new-comment", (data) => {
        socket.to(data.fileId).emit("comment-added", data);
    });
    // ==========================================
    // 🎥 WebRTC SIGNALING FOR VOICE/VIDEO CALLS (LiveSessionWidget)
    // ==========================================
    socket.on("join-call", (roomId, userId) => {
        socket.join(`call_${roomId}`);
        console.log(`📞 User ${userId} joined call room: call_${roomId}`);
        socket.to(`call_${roomId}`).emit("user-connected", userId, socket.id);
    });
    socket.on("webrtc-offer", (data) => {
        socket.to(data.targetSocketId).emit("webrtc-offer", {
            callerSocketId: socket.id,
            callerId: data.callerId,
            sdp: data.sdp,
        });
    });
    socket.on("webrtc-answer", (data) => {
        socket.to(data.targetSocketId).emit("webrtc-answer", {
            answererSocketId: socket.id,
            sdp: data.sdp,
        });
    });
    socket.on("webrtc-ice-candidate", (data) => {
        socket.to(data.targetSocketId).emit("webrtc-ice-candidate", {
            senderSocketId: socket.id,
            candidate: data.candidate,
        });
    });
    // ==========================================
    // ORIGINAL STANDARD WebRTC SIGNALING (Restored)
    // ==========================================
    socket.on("peer-signal", (data) => {
        if (data.targetSocketId) {
            socket.to(data.targetSocketId).emit("peer-signal", {
                senderSocketId: socket.id,
                ...data,
            });
        }
        else if (data.userToSignal) {
            socket.to(data.userToSignal).emit("user-joined", { signal: data.signal, callerID: data.callerID });
        }
        else if (data.callerID) {
            socket.to(data.callerID).emit("receiving-returned-signal", { signal: data.signal, id: socket.id });
        }
        else {
            socket.broadcast.emit("peer-signal", data);
        }
    });
    socket.on("replaceTrack", (data) => {
        if (data.targetSocketId) {
            socket.to(data.targetSocketId).emit("replaceTrack", data);
        }
        else {
            socket.broadcast.emit("replaceTrack", data);
        }
    });
    // ==========================================
    // 💻 WebRTC SIGNALING FOR LIVE SCREEN SHARE (Live Editing)
    // ==========================================
    socket.on("admin-started-timeline-share", (data) => {
        console.log(`🖥️ Admin forcefully started timeline share UI in room: ${data.roomId}`);
        socket.to(data.roomId).emit("admin-started-timeline-share", data);
    });
    socket.on("admin-stopped-timeline-share", (data) => {
        console.log(`🛑 Admin stopped timeline share UI in room: ${data.roomId}`);
        socket.to(data.roomId).emit("admin-stopped-timeline-share", data);
    });
    socket.on("timeline-client-ready", (data) => {
        console.log(`👥 Client ${socket.id} is ready for editor stream in room: ${data.roomId}`);
        socket.to(data.targetSocketId).emit("timeline-client-ready", {
            clientSocketId: socket.id,
        });
    });
    socket.on("timeline-webrtc-offer", (data) => {
        socket.to(data.targetSocketId).emit("timeline-webrtc-offer", {
            callerSocketId: socket.id,
            sdp: data.sdp,
        });
    });
    socket.on("timeline-webrtc-answer", (data) => {
        socket.to(data.targetSocketId).emit("timeline-webrtc-answer", {
            answererSocketId: socket.id,
            sdp: data.sdp,
        });
    });
    // 💬 LIVE SESSION CHAT MESSAGE HANDLER
    socket.on("send-chat-message", (data) => {
        console.log(`💬 Chat from ${data.senderName} in room ${data.fileId}: ${data.text}`);
        // Broadcast to the WebRTC call room
        socket.to(`call_${data.fileId}`).emit("receive-chat-message", data);
        // Broadcast to the standard live chat room as well (for backwards compatibility)
        socket.to(data.fileId).emit("receive-chat-message", data);
    });
    // ==========================================
    // 🎙️ REAL-TIME AUDIO TRANSLATION MULTIPLEXER (OpenAI Realtime API)
    // ==========================================
    function getOrInitOpenAIConnection(roomId, targetLang) {
        if (!openAIConnections[roomId])
            openAIConnections[roomId] = {};
        if (openAIConnections[roomId][targetLang] && openAIConnections[roomId][targetLang].readyState === ws_1.default.OPEN) {
            return openAIConnections[roomId][targetLang];
        }
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.error("Missing OPENAI_API_KEY in .env");
            return null;
        }
        const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";
        const ws = new ws_1.default(url, {
            headers: {
                "Authorization": "Bearer " + apiKey,
                "OpenAI-Beta": "realtime=v1",
            },
        });
        ws.on("open", () => {
            console.log(`🟢 OpenAI WS connected for room ${roomId}, lang ${targetLang}`);
            const sessionUpdate = {
                type: "session.update",
                session: {
                    modalities: ["audio", "text"],
                    instructions: `You are a real-time interpreter. The user is speaking a source language. You MUST translate the audio into the following target language: ${targetLang}. Output the translated text and speak it clearly in ${targetLang}. Do NOT respond to questions, just translate continuously.`,
                    voice: "alloy",
                    input_audio_format: "pcm16",
                    output_audio_format: "pcm16",
                    turn_detection: { type: "server_vad" }
                }
            };
            ws.send(JSON.stringify(sessionUpdate));
        });
        ws.on("message", (data) => {
            try {
                const eventObj = JSON.parse(data.toString());
                // 1. Audio Delta (TTS)
                if (eventObj.type === "response.audio.delta" && eventObj.delta) {
                    const chunkBuf = Buffer.from(eventObj.delta, 'base64');
                    const socketsInRoom = io.sockets.adapter.rooms.get(`call_${roomId}`);
                    if (socketsInRoom) {
                        for (const socketId of socketsInRoom) {
                            if (clientLanguages[socketId] === targetLang) {
                                io.sockets.sockets.get(socketId)?.emit("translated-audio-chunk", {
                                    chunk: chunkBuf
                                });
                            }
                        }
                    }
                }
                // 2. Transcript Delta (Live Captions)
                if (eventObj.type === "response.audio_transcript.delta" && eventObj.delta) {
                    const socketsInRoom = io.sockets.adapter.rooms.get(`call_${roomId}`);
                    if (socketsInRoom) {
                        for (const socketId of socketsInRoom) {
                            if (clientLanguages[socketId] === targetLang) {
                                io.sockets.sockets.get(socketId)?.emit("live-caption", {
                                    text: eventObj.delta,
                                    lang: targetLang
                                });
                            }
                        }
                    }
                }
            }
            catch (e) { }
        });
        ws.on("close", () => {
            console.log(`🔴 OpenAI WS closed for room ${roomId}, lang ${targetLang}`);
            if (openAIConnections[roomId] && openAIConnections[roomId][targetLang]) {
                delete openAIConnections[roomId][targetLang];
            }
        });
        openAIConnections[roomId][targetLang] = ws;
        return ws;
    }
    socket.on("audio-chunk", (data) => {
        const { roomId, chunk, senderLanguage } = data;
        // Find all distinct target languages needed in the room
        const targetLanguages = new Set();
        const socketsInRoom = io.sockets.adapter.rooms.get(`call_${roomId}`);
        if (socketsInRoom) {
            for (const socketId of socketsInRoom) {
                const lang = clientLanguages[socketId];
                // If client language is different from sender, they need translation
                if (lang && lang !== senderLanguage) {
                    targetLanguages.add(lang);
                }
            }
        }
        // Convert raw ArrayBuffer (PCM16) to Base64 for OpenAI
        const base64Audio = Buffer.from(chunk).toString('base64');
        // Fan-out audio to each language-specific OpenAI WS
        targetLanguages.forEach(targetLang => {
            const ws = getOrInitOpenAIConnection(roomId, targetLang);
            if (ws && ws.readyState === ws_1.default.OPEN) {
                ws.send(JSON.stringify({
                    type: "input_audio_buffer.append",
                    audio: base64Audio
                }));
            }
        });
    });
    socket.on("translate-speech", async ({ text, targetLang }) => {
        try {
            const translatedText = await translateWithGemini(text, targetLang);
            io.emit("receive-translated-speech", { original: text, translated: translatedText });
        }
        catch (error) {
            console.error("Translation Error:", error);
        }
    });
    socket.on("disconnect", () => {
        console.log(`❌ Client disconnected: ${socket.id}`);
        io.emit("user-disconnected", socket.id);
    });
});
app.use("/api/upload", upload_routes_1.default);
app.use("/api/media", media_routes_1.default);
// Health Check
app.get("/api/health", (req, res) => {
    res.json({ status: "Studio Backend is Running" });
});
// Get Projects
app.get("/api/projects", async (req, res) => {
    try {
        const projects = await prisma.project.findMany();
        res.json(projects);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to fetch projects" });
    }
});
// 🚀 app.listen এর বদলে httpServer.listen হবে
httpServer.listen(PORT, () => {
    console.log(`🚀 Rendorax API & WebSocket running on http://localhost:${PORT}`);
});
