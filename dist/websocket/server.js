"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// rendorax-backend/websocket/server.ts
const socket_io_1 = require("socket.io");
const redis_adapter_1 = require("@socket.io/redis-adapter");
const redis_1 = require("../redis");
const http_1 = require("http");
const httpServer = (0, http_1.createServer)();
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});
io.adapter((0, redis_adapter_1.createAdapter)(redis_1.redisPubClient, redis_1.redisSubClient));
io.on("connection", (socket) => {
    console.log(`[WebSocket] Client connected: ${socket.id}`);
    // --- EXISTING LOGIC ---
    socket.on("join-video-room", (fileId) => {
        socket.join(`video_${fileId}`);
        console.log(`[WebSocket] ${socket.id} joined room: video_${fileId}`);
    });
    socket.on("sync-timecode", (data) => {
        socket.to(`video_${data.fileId}`).emit("timecode-updated", data);
    });
    socket.on("new-comment", async (data) => {
        io.to(`video_${data.fileId}`).emit("comment-added", data);
    });
    // ==========================================
    // 🚀 NEW: LIVE GROUP CHAT (Ephemeral)
    // ==========================================
    socket.on("send-chat-message", (data) => {
        // Broadcast chat message to everyone in the room except the sender
        socket.to(`video_${data.fileId}`).emit("receive-chat-message", {
            ...data,
            timestamp: new Date().toISOString(),
            id: Math.random().toString(36).substring(7),
        });
    });
    // ==========================================
    // 🎥 NEW: WebRTC SIGNALING FOR VIDEO CALLS
    // ==========================================
    // When a user turns on their camera and joins the call
    socket.on("join-call", (roomId, userId) => {
        socket.join(`call_${roomId}`);
        // Notify others in the room that a new peer wants to connect
        socket.to(`call_${roomId}`).emit("user-connected", userId, socket.id);
    });
    // Step 1: Peer A sends an Offer to Peer B
    socket.on("webrtc-offer", (data) => {
        socket.to(data.targetSocketId).emit("webrtc-offer", {
            callerSocketId: socket.id,
            callerId: data.callerId,
            sdp: data.sdp,
        });
    });
    // Step 2: Peer B sends an Answer back to Peer A
    socket.on("webrtc-answer", (data) => {
        socket.to(data.targetSocketId).emit("webrtc-answer", {
            answererSocketId: socket.id,
            sdp: data.sdp,
        });
    });
    // Step 3: Exchange ICE Candidates (Network Routing Info)
    socket.on("webrtc-ice-candidate", (data) => {
        socket.to(data.targetSocketId).emit("webrtc-ice-candidate", {
            senderSocketId: socket.id,
            candidate: data.candidate,
        });
    });
    // Disconnect Handling
    socket.on("disconnect", () => {
        console.log(`[WebSocket] Client disconnected: ${socket.id}`);
        // Notify all rooms this socket was part of that they left the call
        io.emit("user-disconnected", socket.id);
    });
});
httpServer.listen(3001, () => {
    console.log(`[WebSocket Server] Running on port 3001 with Redis & WebRTC Signaling enabled.`);
});
