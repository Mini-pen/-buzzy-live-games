import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";

import { z } from "zod";

/** * Skip huge JSON blobs (e.g. data exports) mistaken for quiz packs. */
export const MAX_QUIZ_PACK_JSON_BYTES = 520_000;

/** * HTTPS, localhost http, or absolute same-origin path (e.g. `/games/…`). */
export const optionalPublicUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((s) => !s.includes(".."), {
    message: "PUBLIC_URL_REJECTED",
  })
  .refine((s) => !/^\s*javascript:/iu.test(s), {
    message: "PUBLIC_URL_REJECTED",
  })
  .refine(
    (s) =>
      s.startsWith("/") ||
      /^https:\/\/[^/\s]+/iu.test(s) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/\S+/iu.test(s),
    {
      message: "PUBLIC_URL_REJECTED",
    },
  );

const questionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  choices: z.array(z.string()).min(2),
  correctIndex: z.number().int().nonnegative(),
  points: z.number().int().positive(),
  imageUrl: optionalPublicUrlSchema.optional(),
});

export const quizRoundSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    questions: z.array(questionSchema).min(1),
  })
  .strict();

/** * Classic video segment (`videoUrl`). No `kind` field (legacy packs). */
export const videoRoundSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    videoUrl: z.string().min(1),
  })
  .strict();

/** * Buzzer-only prompts; index is host-advanced, optional soft cap for player display. */
export const freeBuzzRoundSchema = z
  .object({
    kind: z.literal("free_buzz"),
    id: z.string().min(1),
    title: z.string().min(1),
    playerPrompt: z.string().min(1),
    plannedQuestionCount: z.number().int().positive().nullable().optional(),
  })
  .strict();

const imageBuzzSlideSchema = z.object({
  id: z.string().min(1),
  imageUrl: optionalPublicUrlSchema,
  /** * Optional caption; when absent the client shows a generic oral-answer hint. */
  prompt: z.string().min(1).optional(),
});

/** * One image per step; players buzz and answer out loud (no on-screen choices). */
export const imageBuzzRoundSchema = z
  .object({
    kind: z.literal("image_buzz"),
    id: z.string().min(1),
    title: z.string().min(1),
    slides: z.array(imageBuzzSlideSchema).min(1),
  })
  .strict();

/** * Path suffix must look like an audio asset (streaming URLs without suffix may use localhost HTTP for dev). */
function pathnameEndsWithKnownAudioSuffix(pathWithoutQuery: string): boolean {
  const p = pathWithoutQuery.trim();
  return /\.(?:mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/iu.test(p);
}

export const audioPublicUrlSchema = optionalPublicUrlSchema.superRefine((s, ctx) => {
  if (/^http:\/\/(localhost|127\.0\.0\.1)/iu.test(s)) return;
  const qIx = s.indexOf("?");
  const withoutQuery = qIx >= 0 ? s.slice(0, qIx) : s;
  let pathPortion = withoutQuery;
  try {
    if (!s.startsWith("/")) pathPortion = new URL(s).pathname;
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "AUDIO_PUBLIC_URL_REJECTED" });
    return;
  }
  if (!pathnameEndsWithKnownAudioSuffix(pathPortion)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "AUDIO_PUBLIC_URL_REJECTED" });
  }
});

const audioBlindTrackSchema = z.object({
  id: z.string().min(1),
  audioUrl: audioPublicUrlSchema,
  revealTitle: z.string().min(1),
  revealArtist: z.string().min(1).optional(),
});

export const audioBlindRoundSchema = z
  .object({
    kind: z.literal("audio_blind"),
    id: z.string().min(1),
    title: z.string().min(1),
    tracks: z.array(audioBlindTrackSchema).min(1),
  })
  .strict();

export const roundSchema = z.union([
  freeBuzzRoundSchema,
  imageBuzzRoundSchema,
  audioBlindRoundSchema,
  videoRoundSchema,
  quizRoundSchema,
]);

export type QuizRound = z.infer<typeof quizRoundSchema>;
export type VideoRound = z.infer<typeof videoRoundSchema>;
export type FreeBuzzRound = z.infer<typeof freeBuzzRoundSchema>;
export type ImageBuzzRound = z.infer<typeof imageBuzzRoundSchema>;
export type AudioBlindRound = z.infer<typeof audioBlindRoundSchema>;
export type PackRound = z.infer<typeof roundSchema>;
export type QuizQuestion = z.infer<typeof questionSchema>;

/** * Legacy video round: has `videoUrl` and no explicit `kind`. */
export function isVideoRound(r: PackRound): r is VideoRound {
  return "videoUrl" in r && !("kind" in r);
}

export function isFreeBuzzRound(r: PackRound): r is FreeBuzzRound {
  return (r as { kind?: string }).kind === "free_buzz";
}

export function isImageBuzzRound(r: PackRound): r is ImageBuzzRound {
  return (r as { kind?: string }).kind === "image_buzz";
}

export function isAudioBlindRound(r: PackRound): r is AudioBlindRound {
  return (r as { kind?: string }).kind === "audio_blind";
}

export const quizPackSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  version: z.number().int().positive(),
  rounds: z.array(roundSchema).min(1),
});

export type QuizPack = z.infer<typeof quizPackSchema>;

function validatePackInvariants(parsed: QuizPack): void {
  for (const r of parsed.rounds) {
    if (isVideoRound(r) || isFreeBuzzRound(r) || isImageBuzzRound(r) || isAudioBlindRound(r)) continue;
    for (const q of r.questions) {
      if (q.correctIndex >= q.choices.length) {
        throw new Error(`Question ${q.id}: correctIndex out of bounds`);
      }
    }
  }
}

/** * Parses and validates a quiz JSON pack from disk. */
export async function loadQuizPackPath(absPath: string): Promise<QuizPack> {
  const raw = await readFile(absPath, "utf8");
  const json: unknown = JSON.parse(raw);
  const parsed = quizPackSchema.parse(json);
  validatePackInvariants(parsed);
  return parsed;
}

/** * Loads `basename` relative to packsDir (`foo` → `foo.json`; subfolders allowed). */
export async function loadQuizPackFile(packsDir: string, basename: string): Promise<QuizPack> {
  const normalized = basename.replace(/\\/gu, "/").replace(/^\//u, "").replace(/\.json$/iu, "");
  const filePath = path.join(packsDir, `${normalized}.json`);
  return loadQuizPackPath(filePath);
}

async function listJsonPackAbsolutePaths(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(inner: string): Promise<void> {
    let dirents: Dirent[];
    try {
      dirents = await readdir(inner, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of dirents) {
      const full = path.join(inner, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) results.push(full);
    }
  }

  await walk(dir);
  results.sort((a, b) => a.localeCompare(b));
  return results;
}

/** * Indexes packs by path relative to `packsDir` without `.json` (e.g. `guess_by_color/quiz_with_images`). */
export async function scanQuizPacks(packsDir: string): Promise<Map<string, QuizPack>> {
  const paths = await listJsonPackAbsolutePaths(packsDir);
  const out = new Map<string, QuizPack>();
  await Promise.all(
    paths.map(async (filePath): Promise<void> => {
      try {
        let byteSize = 0;
        try {
          const st = await stat(filePath);
          if (!st.isFile()) return;
          byteSize = st.size;
        } catch {
          return;
        }
        if (byteSize > MAX_QUIZ_PACK_JSON_BYTES) return;

        const rel = path.relative(packsDir, filePath).replace(/\\/gu, "/");
        const key = rel.replace(/\.json$/iu, "");
        const pack = await loadQuizPackPath(filePath);
        out.set(key, pack);
      } catch {
        /* malformed or non-quiz JSON ignored until explicitly referenced */
      }
    }),
  );
  return out;
}
