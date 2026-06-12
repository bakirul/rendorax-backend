"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const http_1 = require("http"); // 🚀 Node.js HTTP server
const socket_io_1 = require("socket.io"); // 🚀 Socket.io Server
dotenv_1.default.config();
const connectionString = process.env.DATABASE_URL;
// PostgreSQL পুল এবং অ্যাডাপ্টার সেটআপ
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
// নতুন নিয়মে PrismaClient তৈরি
const prisma = new client_1.PrismaClient({ adapter });
const app = (0, express_1.default)();
const PORT = process.env.PORT || 4000;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// 🚀 HTTP সার্ভার তৈরি এবং Socket.io কনফিগারেশন
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: "*", // ফ্রন্টএন্ড থেকে কানেকশন অ্যালাউ করার জন্য
        methods: ["GET", "POST"],
    },
});
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
    // 💻 WebRTC SIGNALING FOR LIVE SCREEN SHARE (Live Editing)
    // ==========================================
    socket.on("editor-start-live-stream", (data) => {
        console.log(`🖥️ Editor started live stream in room: ${data.roomId}`);
        socket.to(data.roomId).emit("editor-start-live-stream", {
            roomId: data.roomId,
            editorSocketId: socket.id,
        });
    });
    socket.on("editor-stop-live-stream", (data) => {
        console.log(`🛑 Editor stopped live stream in room: ${data.roomId}`);
        socket.to(data.roomId).emit("editor-stop-live-stream", data);
    });
    socket.on("client-ready-for-stream", (data) => {
        console.log(`👥 Client ${socket.id} is ready for editor stream: ${data.targetSocketId}`);
        socket.to(data.targetSocketId).emit("client-ready-for-stream", {
            clientSocketId: socket.id,
        });
    });
    socket.on("screen-webrtc-offer", (data) => {
        socket.to(data.targetSocketId).emit("screen-webrtc-offer", {
            callerSocketId: socket.id,
            sdp: data.sdp,
        });
    });
    socket.on("screen-webrtc-answer", (data) => {
        socket.to(data.targetSocketId).emit("screen-webrtc-answer", {
            answererSocketId: socket.id,
            sdp: data.sdp,
        });
    });
    socket.on("disconnect", () => {
        console.log(`❌ Client disconnected: ${socket.id}`);
        io.emit("user-disconnected", socket.id);
    });
});
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
    console.log(`🚀 Studio API & WebSocket running on http://localhost:${PORT}`);
});
