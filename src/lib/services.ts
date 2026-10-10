import { supabase } from '@/lib/supabase';
import { analyzeTranscript } from '@/lib/ai-engine';
import type { Meeting, TranscriptSegment } from '@/types';

export const SUPPORTED_RECORDING_TYPES = [
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave',
  'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/webm', 'audio/ogg',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
];
export const SUPPORTED_RECORDING_EXTENSIONS = ['mp3', 'wav', 'm4a', 'mp4', 'webm', 'mov', 'ogg'];
export const MAX_RECORDING_SIZE = 100 * 1024 * 1024; // 100 MB

export function validateRecordingFile(file: File): string | null {
  if (file.size === 0) return 'The selected file is empty.';
  if (file.size > MAX_RECORDING_SIZE) {
    const mb = Math.round(file.size / (1024 * 1024));
    return `This file is ${mb} MB. The maximum supported size is 100 MB.`;
  }
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const typeOk = SUPPORTED_RECORDING_TYPES.includes(file.type);
  const extOk = SUPPORTED_RECORDING_EXTENSIONS.includes(ext);
  if (!typeOk && !extOk) {
    return `Unsupported file format ".${ext || 'unknown'}". Supported formats: MP3, WAV, M4A, MP4, WEBM.`;
  }
  return null;
}

export type ProcessingStage =
  | 'idle'
  | 'uploading'
  | 'uploaded'
  | 'transcribing'
  | 'transcribed'
  | 'analyzing'
  | 'completed'
  | 'error';

export interface ProcessingState {
  stage: ProcessingStage;
  message: string;
  progress: number;
}

export async function uploadRecordingAndGetTranscript(
  meetingId: string,
  file: File,
  onStateChange: (state: ProcessingState) => void,
): Promise<void> {
  const fileError = validateRecordingFile(file);
  if (fileError) throw new Error(fileError);

  onStateChange({ stage: 'uploading', message: 'Uploading recording to secure storage...', progress: 10 });

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error('You must be signed in to upload a recording.');

  const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const storagePath = `${user.id}/${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from('meeting-recordings')
    .upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  onStateChange({ stage: 'uploaded', message: 'Recording saved securely. Running local transcription...', progress: 30 });

  const localTranscriptionUrl = (import.meta.env.VITE_LOCAL_TRANSCRIPTION_URL || 'http://localhost:8000').replace(/\/$/, '');
  const formData = new FormData();
  formData.append('file', file, file.name);

  onStateChange({ stage: 'transcribing', message: 'Running local Faster-Whisper transcription...', progress: 50 });

  const response = await fetch(`${localTranscriptionUrl}/api/transcribe/local`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    let message = 'Local speech-to-text failed. Please try another audio file or check the Python backend status.';
    try {
      const body = await response.json() as { detail?: string; error?: string };
      if (body.detail) message = body.detail;
      else if (body.error) message = body.error;
    } catch { /* fall back to default */ }
    throw new Error(message);
  }

  const result = await response.json() as {
    full_text?: string;
    segments?: TranscriptSegment[];
    language?: string;
  };

  if (!result.full_text?.trim()) {
    throw new Error('The recording was processed but no transcript text was returned.');
  }

  const transcriptText = result.full_text.trim();
  const transcriptSegments = (result.segments || []).map((segment) => ({
    speaker: segment.speaker || 'Speaker',
    text: String(segment.text || '').trim(),
    start: Number(segment.start || 0),
    end: Number(segment.end || 0),
  })).filter((segment) => segment.text.length > 0);

  const { data: meetingRecord, error: meetingLookupError } = await supabase
    .from('meetings')
    .select('title, participants, duration_minutes')
    .eq('id', meetingId)
    .maybeSingle();

  if (meetingLookupError || !meetingRecord) {
    throw new Error('The meeting record could not be loaded for analysis.');
  }

  await saveTranscript(meetingId, transcriptText, transcriptSegments);

  await supabase.from('meetings').update({
    recording_url: storagePath,
    status: 'completed',
    updated_at: new Date().toISOString(),
  }).eq('id', meetingId);

  onStateChange({ stage: 'transcribed', message: 'Transcript saved. Generating summary and action items...', progress: 75 });

  await analyzeAndStoreMeeting(
    meetingId,
    transcriptSegments,
    meetingRecord.title,
    meetingRecord.participants || [],
    meetingRecord.duration_minutes || 60,
  );

  onStateChange({ stage: 'analyzing', message: 'Local analysis complete. Loading meeting results...', progress: 90 });
  onStateChange({ stage: 'completed', message: 'Meeting analysis complete!', progress: 100 });
}

export async function downloadRecording(meetingId: string, recordingUrl: string | null, fallbackName: string): Promise<void> {
  if (!recordingUrl) throw new Error('No recording is available for this meeting.');
  const { data, error } = await supabase.storage
    .from('meeting-recordings')
    .createSignedLink(recordingUrl, 300);
  if (error || !data?.signedUrl) {
    throw new Error(`Could not generate a download link: ${error?.message || 'Unknown error'}`);
  }
  const a = document.createElement('a');
  a.href = data.signedUrl;
  a.download = fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function fetchMeetings() {
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .order('meeting_date', { ascending: false });
  if (error) throw error;
  return data as Meeting[];
}

export async function fetchMeeting(id: string) {
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Meeting | null;
}

export async function createMeeting(input: {
  title: string;
  description?: string;
  meeting_date: string;
  start_time?: string;
  end_time?: string;
  duration_minutes?: number;
  participants?: string[];
  agenda?: string;
  status?: string;
}) {
  const { data, error } = await supabase
    .from('meetings')
    .insert(input)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data as Meeting;
}

export async function updateMeeting(id: string, updates: Partial<Meeting>) {
  const { data, error } = await supabase
    .from('meetings')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data as Meeting;
}

export async function deleteMeeting(id: string) {
  const { error } = await supabase.from('meetings').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchTranscript(meetingId: string) {
  const { data, error } = await supabase
    .from('transcripts')
    .select('*')
    .eq('meeting_id', meetingId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveTranscript(meetingId: string, fullText: string, segments: TranscriptSegment[]) {
  const { data: existing } = await supabase
    .from('transcripts')
    .select('id')
    .eq('meeting_id', meetingId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from('transcripts')
      .update({ full_text: fullText, segments })
      .eq('id', existing.id)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('transcripts')
    .insert({ meeting_id: meetingId, full_text: fullText, segments })
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchSummary(meetingId: string) {
  const { data, error } = await supabase
    .from('summaries')
    .select('*')
    .eq('meeting_id', meetingId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchDecisions(meetingId: string) {
  const { data, error } = await supabase
    .from('decisions')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function fetchTopics(meetingId: string) {
  const { data, error } = await supabase
    .from('topics')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function fetchActionItems(filters?: { status?: string; meeting_id?: string }) {
  let query = supabase.from('action_items').select('*, meetings(title)').order('created_at', { ascending: false });
  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.meeting_id) query = query.eq('meeting_id', filters.meeting_id);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createActionItem(input: {
  meeting_id?: string | null;
  description: string;
  owner?: string;
  deadline?: string | null;
  priority?: string;
  status?: string;
  context?: string;
  ai_generated?: boolean;
}) {
  const { data, error } = await supabase
    .from('action_items')
    .insert(input)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateActionItem(id: string, updates: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('action_items')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteActionItem(id: string) {
  const { error } = await supabase.from('action_items').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchNotifications() {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function markNotificationRead(id: string) {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
  if (error) throw error;
}

export async function markAllNotificationsRead() {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('read', false);
  if (error) throw error;
}

export async function deleteNotification(id: string) {
  const { error } = await supabase.from('notifications').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchInsights(meetingId?: string) {
  let query = supabase.from('ai_insights').select('*').order('created_at', { ascending: false });
  if (meetingId) query = query.eq('meeting_id', meetingId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function fetchSentiment(meetingId: string) {
  const { data, error } = await supabase
    .from('sentiment_analysis')
    .select('*')
    .eq('meeting_id', meetingId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchChatSessions() {
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createChatSession(title?: string, contextMeetingId?: string) {
  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({ title: title || 'New Conversation', context_meeting_id: contextMeetingId || null })
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchChatMessages(sessionId: string) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function addChatMessage(sessionId: string, role: string, content: string, sources?: unknown[]) {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ session_id: sessionId, role, content, sources: sources || [] })
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteChatSession(id: string) {
  const { error } = await supabase.from('chat_sessions').delete().eq('id', id);
  if (error) throw error;
}

export async function analyzeAndStoreMeeting(meetingId: string, segments: TranscriptSegment[], meetingTitle: string, participants: string[], plannedDuration: number) {
  const result = analyzeTranscript(segments, meetingTitle, participants, plannedDuration, meetingId);

  // Save summary
  const { data: existingSummary } = await supabase
    .from('summaries')
    .select('id')
    .eq('meeting_id', meetingId)
    .maybeSingle();

  if (existingSummary) {
    await supabase.from('summaries').update({
      quick_summary: result.summary.quick_summary,
      detailed_summary: result.summary.detailed_summary,
      highlights: result.summary.highlights,
      key_points: result.summary.key_points,
      minutes: result.summary.minutes,
    }).eq('id', existingSummary.id);
  } else {
    await supabase.from('summaries').insert({
      meeting_id: meetingId,
      ...result.summary,
    });
  }

  // Clear and save decisions
  await supabase.from('decisions').delete().eq('meeting_id', meetingId);
  if (result.decisions.length > 0) {
    await supabase.from('decisions').insert(result.decisions);
  }

  // Clear and save topics
  await supabase.from('topics').delete().eq('meeting_id', meetingId);
  if (result.topics.length > 0) {
    await supabase.from('topics').insert(result.topics);
  }

  // Save action items (clear existing AI-generated ones first)
  await supabase.from('action_items').delete().eq('meeting_id', meetingId).eq('ai_generated', true);
  if (result.actionItems.length > 0) {
    await supabase.from('action_items').insert(result.actionItems);
  }

  // Save sentiment
  const { data: existingSentiment } = await supabase
    .from('sentiment_analysis')
    .select('id')
    .eq('meeting_id', meetingId)
    .maybeSingle();

  if (existingSentiment) {
    await supabase.from('sentiment_analysis').update({
      overall: result.sentiment.overall,
      positive_pct: result.sentiment.positive_pct,
      neutral_pct: result.sentiment.neutral_pct,
      negative_pct: result.sentiment.negative_pct,
      per_segment: result.sentiment.per_segment,
    }).eq('id', existingSentiment.id);
  } else {
    await supabase.from('sentiment_analysis').insert(result.sentiment);
  }

  // Save insights
  await supabase.from('ai_insights').delete().eq('meeting_id', meetingId);
  if (result.insights.length > 0) {
    await supabase.from('ai_insights').insert(result.insights);
  }

  // Update meeting status to completed
  await supabase.from('meetings').update({ status: 'completed' }).eq('id', meetingId);

  return result;
}

export async function fetchMeetingsWithTranscripts() {
  const { data: meetings, error } = await supabase
    .from('meetings')
    .select('id, title, meeting_date, participants')
    .order('meeting_date', { ascending: false });
  if (error) throw error;

  const { data: transcripts, error: tError } = await supabase
    .from('transcripts')
    .select('meeting_id, full_text');
  if (tError) throw tError;

  const transcriptMap = new Map<string, string>();
  for (const t of transcripts || []) {
    transcriptMap.set(t.meeting_id, t.full_text);
  }

  return (meetings || []).map((m) => ({
    ...m,
    transcript_text: transcriptMap.get(m.id) || '',
  }));
}
