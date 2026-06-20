export interface SrtCue {
  startMs: number;
  endMs: number;
  text: string;
}

const SRT_TIME_PATTERN = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/;

export function parseSrtTimestampToMs(timestamp: string): number {
  const match = timestamp.trim().match(SRT_TIME_PATTERN);
  if (!match) {
    throw new Error(`Invalid SRT timestamp: "${timestamp}"`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4]);

  return hours * 3_600_000 + minutes * 60_000 + seconds * 1_000 + millis;
}

export function formatMsToSrtTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1_000);
  const millis = clamped % 1_000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function parseSrtCues(srt: string): SrtCue[] {
  const normalized = srt.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const cues: SrtCue[] = [];

  for (const block of normalized.split(/\n\n+/)) {
    const lines = block.split("\n").filter((line) => line.length > 0);
    if (lines.length < 2) continue;

    const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeLineIndex === -1) continue;

    const [startRaw, endRaw] = lines[timeLineIndex]
      .split("-->")
      .map((part) => part.trim());

    if (!startRaw || !endRaw) continue;

    const text = lines.slice(timeLineIndex + 1).join("\n").trim();
    if (!text) continue;

    cues.push({
      startMs: parseSrtTimestampToMs(startRaw),
      endMs: parseSrtTimestampToMs(endRaw),
      text,
    });
  }

  return cues;
}

export function shiftSrtCues(cues: SrtCue[], offsetMs: number): SrtCue[] {
  return cues.map((cue) => ({
    startMs: cue.startMs + offsetMs,
    endMs: cue.endMs + offsetMs,
    text: cue.text,
  }));
}

export function shiftSrtString(srt: string, offsetMs: number): SrtCue[] {
  return shiftSrtCues(parseSrtCues(srt), offsetMs);
}

export function serializeSrtCues(cues: SrtCue[]): string {
  return cues
    .map((cue, index) => {
      const start = formatMsToSrtTimestamp(cue.startMs);
      const end = formatMsToSrtTimestamp(cue.endMs);
      return `${index + 1}\n${start} --> ${end}\n${cue.text}`;
    })
    .join("\n\n");
}

export function mergeAndReindexShiftedSrts(
  chunkSrts: { srt: string; chunkIndex: number }[],
  chunkDurationMs: number,
): string {
  const merged: SrtCue[] = [];

  for (const { srt, chunkIndex } of chunkSrts) {
    const offsetMs = chunkIndex * chunkDurationMs;
    merged.push(...shiftSrtString(srt, offsetMs));
  }

  merged.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return serializeSrtCues(merged);
}
