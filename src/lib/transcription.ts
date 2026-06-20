import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import OpenAI from "openai";
import { mergeAndReindexShiftedSrts } from "./srtTimeShift";

const WHISPER_MAX_BYTES = 25 * 1024 * 1024;
const CHUNK_DURATION_SECONDS = 60 * 60;
const CHUNK_DURATION_MS = CHUNK_DURATION_SECONDS * 1000;
const BASE_AUDIO_BITRATE_KBPS = 32;

export interface TranscribeMediaInput {
  fileUrl: string;
  language?: string;
}

export interface TranscribeMediaResult {
  srt: string;
  language: string;
}

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

interface WhisperVerboseJsonResponse {
  segments?: WhisperSegment[];
  text?: string;
}

function formatSecondsToSrtTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1_000);
  const millis = totalMs % 1_000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function jsonToSrt(segments: WhisperSegment[]): string {
  const blocks: string[] = [];
  let index = 1;

  for (const segment of segments) {
    const text = segment.text?.trim();
    if (!text) continue;

    const startTime = formatSecondsToSrtTimestamp(segment.start);
    const endTime = formatSecondsToSrtTimestamp(segment.end);

    blocks.push(`${index}\n${startTime} --> ${endTime}\n${text}`);
    index += 1;
  }

  return blocks.join("\n\n");
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn("[TRANSCRIBE] Failed to delete temp file:", filePath, error);
    }
  }
}

async function cleanupTempFiles(filePaths: string[]): Promise<void> {
  await Promise.all(filePaths.map(safeUnlink));
}

function extractFullCompressedAudio(
  fileUrl: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(fileUrl)
      .noVideo()
      .audioChannels(1)
      .audioBitrate(BASE_AUDIO_BITRATE_KBPS)
      .format("mp3")
      .on("end", () => resolve())
      .on("error", (error) => reject(error))
      .save(outputPath);
  });
}

function getMediaDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (error, metadata) => {
      if (error) {
        reject(error);
        return;
      }

      const duration = metadata.format.duration;
      if (!duration || !Number.isFinite(duration) || duration <= 0) {
        reject(new Error("Unable to determine audio duration from extracted file."));
        return;
      }

      resolve(duration);
    });
  });
}

function sliceAudioSegment(
  sourcePath: string,
  outputPath: string,
  startSeconds: number,
  durationSeconds: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(sourcePath)
      .setStartTime(startSeconds)
      .duration(durationSeconds)
      .noVideo()
      .audioChannels(1)
      .audioBitrate(BASE_AUDIO_BITRATE_KBPS)
      .format("mp3")
      .on("end", () => resolve())
      .on("error", (error) => reject(error))
      .save(outputPath);
  });
}

function needsChunking(fileSizeBytes: number, durationSeconds: number): boolean {
  return (
    fileSizeBytes > WHISPER_MAX_BYTES ||
    durationSeconds > CHUNK_DURATION_SECONDS
  );
}

async function transcribeChunkWithWhisper(
  openai: OpenAI,
  chunkPath: string,
  language: string,
): Promise<string> {
  const { size } = await fs.promises.stat(chunkPath);
  if (size > WHISPER_MAX_BYTES) {
    throw new Error(
      `Audio chunk exceeds Whisper 25MB limit (${size} bytes): ${chunkPath}`,
    );
  }

  const response = (await openai.audio.transcriptions.create({
    file: fs.createReadStream(chunkPath),
    model: "whisper-large-v3",
    response_format: "verbose_json",
    ...(language ? { language } : {}),
  })) as WhisperVerboseJsonResponse;

  const segments = response.segments ?? [];
  const srt = jsonToSrt(segments);

  if (!srt) {
    throw new Error("Whisper returned an empty SRT transcript for a chunk.");
  }

  return srt;
}

async function sliceIntoHourlyChunks(
  baseAudioPath: string,
  durationSeconds: number,
  sessionId: string,
  tempFiles: string[],
): Promise<string[]> {
  const chunkCount = Math.ceil(durationSeconds / CHUNK_DURATION_SECONDS);
  const chunkPaths: string[] = [];

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const startSeconds = chunkIndex * CHUNK_DURATION_SECONDS;
    const segmentDuration = Math.min(
      CHUNK_DURATION_SECONDS,
      durationSeconds - startSeconds,
    );

    const chunkPath = path.join(
      os.tmpdir(),
      `rendorax-chunk-${sessionId}-${chunkIndex}.mp3`,
    );

    await sliceAudioSegment(
      baseAudioPath,
      chunkPath,
      startSeconds,
      segmentDuration,
    );

    chunkPaths.push(chunkPath);
    tempFiles.push(chunkPath);
  }

  return chunkPaths;
}

export async function transcribeMediaToSrt(
  input: TranscribeMediaInput,
): Promise<TranscribeMediaResult> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not configured on the server. Add it to rendorax-backend/.env.local (not rendorax-frontend/.env) and restart the backend.",
    );
  }

  const language = input.language?.trim() || "en";
  const sessionId = randomUUID();
  const baseAudioPath = path.join(
    os.tmpdir(),
    `rendorax-base-${sessionId}.mp3`,
  );
  const tempFiles = [baseAudioPath];
  const openai = new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });

  try {
    await extractFullCompressedAudio(input.fileUrl, baseAudioPath);

    const [{ size: baseSize }, durationSeconds] = await Promise.all([
      fs.promises.stat(baseAudioPath),
      getMediaDurationSeconds(baseAudioPath),
    ]);

    if (!needsChunking(baseSize, durationSeconds)) {
      const srt = await transcribeChunkWithWhisper(
        openai,
        baseAudioPath,
        language,
      );
      return { srt, language };
    }

    const chunkPaths = await sliceIntoHourlyChunks(
      baseAudioPath,
      durationSeconds,
      sessionId,
      tempFiles,
    );

    const chunkSrts: { srt: string; chunkIndex: number }[] = [];

    for (let chunkIndex = 0; chunkIndex < chunkPaths.length; chunkIndex += 1) {
      const chunkPath = chunkPaths[chunkIndex];
      const srt = await transcribeChunkWithWhisper(
        openai,
        chunkPath,
        language,
      );

      chunkSrts.push({ srt, chunkIndex });
    }

    const masterSrt = mergeAndReindexShiftedSrts(chunkSrts, CHUNK_DURATION_MS);

    if (!masterSrt.trim()) {
      throw new Error("Merged SRT transcript is empty.");
    }

    return { srt: masterSrt, language };
  } finally {
    await cleanupTempFiles(tempFiles);
  }
}
