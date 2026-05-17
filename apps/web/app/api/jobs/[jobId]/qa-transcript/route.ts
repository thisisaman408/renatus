import { NextResponse, type NextRequest } from 'next/server';
import { QaTranscriptRepository } from '@renatus/db';
import { requireDatabaseUrl } from '../../../../../lib/database-url';

/**
 * `/api/jobs/[jobId]/qa-transcript` — single transcript fetch for a Q&A job.
 *
 * Returns `{ transcript: null }` until the workflow has written the row, then
 * `{ transcript: { question, answer, citations } }`. The client polls this on
 * state changes; we don't push the transcript through the SSE stream because
 * it isn't an audit event (it's a separate signed artefact).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

interface Body {
  transcript: {
    question: string;
    answer: string;
    citations: Array<{
      filePath: string;
      line?: number;
      sha: string;
      snippet?: string;
    }>;
  } | null;
}

export async function GET(
  _req: NextRequest,
  context: RouteContext,
): Promise<NextResponse<Body | { error: string }>> {
  const { jobId } = await context.params;
  let databaseUrl: string;
  try {
    databaseUrl = requireDatabaseUrl();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  const qaRepo = new QaTranscriptRepository(databaseUrl);
  const transcript = await qaRepo.getByJob(jobId);
  if (!transcript) {
    return NextResponse.json<Body>({ transcript: null });
  }
  return NextResponse.json<Body>({
    transcript: {
      question: transcript.question,
      answer: transcript.answer,
      citations: transcript.citations,
    },
  });
}
