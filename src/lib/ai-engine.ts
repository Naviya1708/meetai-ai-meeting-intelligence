import type { TranscriptSegment, ActionItem, Decision, Topic, Summary, SentimentAnalysis, AiInsight } from '@/types';

const POSITIVE_WORDS = ['great', 'excellent', 'good', 'happy', 'excited', 'progress', 'completed', 'success', 'achieved', 'agreed', 'love', 'fantastic', 'wonderful', 'perfect', 'glad', 'thanks', 'appreciate', 'well', 'smooth', 'delighted'];
const NEGATIVE_WORDS = ['issue', 'problem', 'concern', 'blocked', 'delay', 'fail', 'failed', 'stuck', 'difficult', 'worried', 'bad', 'frustrated', 'confused', 'unclear', 'pending', 'overdue', 'missed', 'bug', 'error', 'broken', 'risk', 'unfortunately'];
const NEUTRAL_WORDS = ['discuss', 'plan', 'review', 'update', 'schedule', 'think', 'consider', 'maybe', 'perhaps', 'should', 'could', 'would', 'next', 'today', 'meeting', 'team', 'project'];

const ACTION_PATTERNS = [
  /\b(I|we|you|they|let'?s|please|need to|have to|should|must|will|going to|todo|to do)\b/i,
  /\b(assign|complete|finish|review|send|prepare|update|create|build|test|deploy|fix|implement|design|check|verify|set up|configure|integrate|research|investigate|follow up|reach out|contact|schedule|plan|draft|write|submit)\b/i,
];

const DEADLINE_PATTERNS = [
  { regex: /\bby (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, type: 'weekday' },
  { regex: /\bby (end of (?:this )?week|end of (?:this )?month|tomorrow|today|next week|next month)\b/i, type: 'relative' },
  { regex: /\bby (january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{1,2})?/i, type: 'month' },
  { regex: /\bby (next|this) (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, type: 'weekday' },
  { regex: /\b(in|within) (\d+) (days?|weeks?)\b/i, type: 'duration' },
  { regex: /\bby (friday|monday|tuesday|wednesday|thursday)\b/i, type: 'weekday' },
];

const DECISION_PATTERNS = [
  /\b(we (?:have )?decided|decision (?:is|was|made)|agreed (?:to|that|on)|concluded|finalized|approved|we will go with|let'?s go with|we'?ll use|moving forward with|we'?re going with)\b/i,
];

const PRIORITY_KEYWORDS: Record<string, string[]> = {
  critical: ['critical', 'urgent', 'asap', 'immediately', 'blocker', 'production down', 'security'],
  high: ['high priority', 'important', 'must', 'before', 'deadline', 'due', 'key', 'essential'],
  low: ['low priority', 'when you have time', 'no rush', 'optional', 'nice to have', 'if possible'],
};

function detectDeadline(text: string): string | null {
  const now = new Date();
  const dayMap: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

  for (const pattern of DEADLINE_PATTERNS) {
    const match = text.match(pattern.regex);
    if (!match) continue;

    if (pattern.type === 'weekday') {
      const dayName = (match[match.length - 1] || match[1]).toLowerCase();
      const targetDay = dayMap[dayName];
      if (targetDay === undefined) continue;
      const today = now.getDay();
      let diff = targetDay - today;
      if (diff <= 0) diff += 7;
      const deadline = new Date(now);
      deadline.setDate(now.getDate() + diff);
      return deadline.toISOString().split('T')[0];
    }

    if (pattern.type === 'relative') {
      const phrase = match[1].toLowerCase();
      const deadline = new Date(now);
      if (phrase.includes('tomorrow')) deadline.setDate(now.getDate() + 1);
      else if (phrase.includes('today')) { /* today */ }
      else if (phrase.includes('end of') && phrase.includes('week')) {
        const diff = (5 - now.getDay() + 7) % 7 || 5;
        deadline.setDate(now.getDate() + diff);
      } else if (phrase.includes('end of') && phrase.includes('month')) {
        deadline.setMonth(now.getMonth() + 1, 0);
      } else if (phrase.includes('next week')) {
        deadline.setDate(now.getDate() + 7);
      } else if (phrase.includes('next month')) {
        deadline.setMonth(now.getMonth() + 1);
      }
      return deadline.toISOString().split('T')[0];
    }

    if (pattern.type === 'duration') {
      const num = parseInt(match[2]);
      const unit = match[3].toLowerCase();
      const deadline = new Date(now);
      if (unit.startsWith('day')) deadline.setDate(now.getDate() + num);
      else if (unit.startsWith('week')) deadline.setDate(now.getDate() + num * 7);
      return deadline.toISOString().split('T')[0];
    }

    if (pattern.type === 'month') {
      const monthName = match[1].toLowerCase();
      const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
      const monthIdx = months.indexOf(monthName);
      if (monthIdx === -1) continue;
      const day = match[2] ? parseInt(match[2]) : 15;
      const deadline = new Date(now.getFullYear(), monthIdx, day);
      if (deadline < now) deadline.setFullYear(now.getFullYear() + 1);
      return deadline.toISOString().split('T')[0];
    }
  }
  return null;
}

function detectPriority(text: string): 'low' | 'medium' | 'high' | 'critical' {
  const lower = text.toLowerCase();
  for (const [level, keywords] of Object.entries(PRIORITY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return level as 'low' | 'medium' | 'high' | 'critical';
  }
  return 'medium';
}

function detectOwner(text: string, participants: string[]): string {
  const lower = text.toLowerCase();
  for (const p of participants) {
    const firstName = p.split(' ')[0];
    if (firstName && lower.includes(firstName.toLowerCase())) return p;
  }
  const assignMatch = text.match(/\b(?:assign(?:ed)? to|owner is|responsible:?)\s+([A-Z][a-z]+)/);
  if (assignMatch) return assignMatch[1];
  return 'Unassigned';
}

function isActionSentence(sentence: string): boolean {
  return ACTION_PATTERNS.some((pattern) => pattern.test(sentence));
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 10);
}

function analyzeSentimentText(text: string): 'positive' | 'neutral' | 'negative' {
  const lower = text.toLowerCase();
  let score = 0;
  for (const w of POSITIVE_WORDS) if (lower.includes(w)) score += 1;
  for (const w of NEGATIVE_WORDS) if (lower.includes(w)) score -= 1;
  if (score > 0) return 'positive';
  if (score < 0) return 'negative';
  return 'neutral';
}

export interface AnalysisResult {
  summary: Omit<Summary, 'id' | 'meeting_id' | 'created_at'>;
  actionItems: Omit<ActionItem, 'id' | 'user_id' | 'created_at' | 'updated_at'>[];
  decisions: Omit<Decision, 'id' | 'created_at'>[];
  topics: Omit<Topic, 'id' | 'created_at'>[];
  sentiment: Omit<SentimentAnalysis, 'id' | 'created_at'>;
  insights: Omit<AiInsight, 'id' | 'user_id' | 'created_at'>[];
}

export function analyzeTranscript(
  segments: TranscriptSegment[],
  meetingTitle: string,
  participants: string[],
  plannedDurationMinutes: number,
  meetingId: string
): AnalysisResult {
  const fullText = segments.map((s) => s.text).join(' ');
  const sentences = splitSentences(fullText);

  // --- Summary ---
  const firstN = sentences.slice(0, 3).join(' ');
  const quickSummary = `This meeting covered ${meetingTitle.toLowerCase()}. ${firstN}`;
  const detailedSummary = sentences.slice(0, Math.min(12, sentences.length)).join(' ');

  // Highlights — sentences with positive sentiment or decision keywords
  const highlights = sentences
    .filter((s) => {
      const lower = s.toLowerCase();
      return DECISION_PATTERNS.some((p) => p.test(s)) ||
        POSITIVE_WORDS.some((w) => lower.includes(w)) ||
        lower.includes('highlight') || lower.includes('key') || lower.includes('important');
    })
    .slice(0, 6);

  // Key points — sentences containing topic keywords
  const keyPoints = sentences
    .filter((s) => {
      const lower = s.toLowerCase();
      return NEUTRAL_WORDS.some((w) => lower.includes(w)) && s.length > 20;
    })
    .slice(0, 8);

  // Minutes
  const minutes = `MEETING MINUTES\n\nMeeting: ${meetingTitle}\nDate: ${new Date().toLocaleDateString()}\nParticipants: ${participants.join(', ')}\n\n1. CALL TO ORDER\nThe meeting was called to discuss ${meetingTitle.toLowerCase()}.\n\n2. DISCUSSION POINTS\n${keyPoints.map((p, i) => `   ${i + 1}. ${p}`).join('\n')}\n\n3. DECISIONS MADE\n${decisionsFromSentences(sentences).map((d, i) => `   ${i + 1}. ${d}`).join('\n')}\n\n4. ACTION ITEMS\n${actionItemsFromSentences(sentences, participants, meetingId).map((a, i) => `   ${i + 1}. ${a.description} — Owner: ${a.owner}, Deadline: ${a.deadline || 'TBD'}`).join('\n')}\n\n5. ADJOURNMENT\nThe meeting was adjourned.\n`;

  // --- Decisions ---
  const decisionSentences = decisionsFromSentences(sentences);

  // --- Action Items ---
  const actionItems = actionItemsFromSentences(sentences, participants, meetingId);

  // --- Topics ---
  const topicKeywords = extractTopics(fullText);
  const topics = topicKeywords.map((t) => ({
    meeting_id: meetingId,
    title: t.title,
    parent_id: null,
    type: 'topic' as const,
    discussion: t.discussion,
  }));

  // --- Sentiment ---
  const perSegment = segments.map((seg) => ({
    text: seg.text,
    sentiment: analyzeSentimentText(seg.text),
  }));
  const positiveCount = perSegment.filter((s) => s.sentiment === 'positive').length;
  const negativeCount = perSegment.filter((s) => s.sentiment === 'negative').length;
  const neutralCount = perSegment.filter((s) => s.sentiment === 'neutral').length;
  const total = perSegment.length || 1;
  const overall = positiveCount > negativeCount && positiveCount > neutralCount ? 'positive' :
    negativeCount > positiveCount && negativeCount > neutralCount ? 'negative' : 'neutral';

  // --- Insights ---
  const insights: Omit<AiInsight, 'id' | 'user_id' | 'created_at'>[] = [];

  // Duration insight
  if (plannedDurationMinutes > 0) {
    const actualDuration = segments.length > 0
      ? Math.max(...segments.map((s) => s.end)) / 60
      : plannedDurationMinutes;
    if (actualDuration > plannedDurationMinutes * 1.1) {
      insights.push({
        meeting_id: meetingId,
        type: 'duration',
        title: 'Meeting exceeded planned duration',
        description: `This meeting ran approximately ${Math.round(actualDuration)} minutes, which is ${Math.round(actualDuration - plannedDurationMinutes)} minutes longer than planned (${plannedDurationMinutes} min). Consider tightening the agenda or scheduling a follow-up.`,
        severity: 'warning',
      });
    }
  }

  // Action item insights
  const pendingItems = actionItems.filter((a) => a.status === 'pending');
  if (pendingItems.length >= 3) {
    insights.push({
      meeting_id: meetingId,
      type: 'tasks',
      title: 'Multiple action items need attention',
      description: `${pendingItems.length} action items were identified in this meeting. Ensure owners are notified and deadlines are tracked.`,
      severity: 'info',
    });
  }

  const itemsWithDeadlines = actionItems.filter((a) => a.deadline);
  const soonDeadlines = itemsWithDeadlines.filter((a) => {
    if (!a.deadline) return false;
    const days = Math.round((new Date(a.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days <= 3 && days >= 0;
  });
  if (soonDeadlines.length > 0) {
    insights.push({
      meeting_id: meetingId,
      type: 'deadline',
      title: 'Action items approaching deadlines',
      description: `${soonDeadlines.length} action item(s) have deadlines within the next 3 days. Follow up with owners to ensure timely completion.`,
      severity: 'warning',
    });
  }

  // Sentiment insight
  if (negativeCount > positiveCount && negativeCount > total * 0.3) {
    insights.push({
      meeting_id: meetingId,
      type: 'sentiment',
      title: 'Meeting sentiment leaned negative',
      description: `${Math.round((negativeCount / total) * 100)}% of discussion segments had negative sentiment. Key concerns may need to be addressed before the next meeting.`,
      severity: 'warning',
    });
  }

  // Follow-up suggestion
  if (pendingItems.length > 0 || decisionSentences.length === 0) {
    insights.push({
      meeting_id: meetingId,
      type: 'followup',
      title: 'A follow-up meeting may be useful',
      description: pendingItems.length > 0
        ? `${pendingItems.length} action items require follow-up. Consider scheduling a check-in meeting to review progress.`
        : 'No clear decisions were recorded. A follow-up discussion may help finalize next steps.',
      severity: 'info',
    });
  }

  // Participation insight
  if (participants.length > 0 && segments.length > 0) {
    const speakerSet = new Set(segments.map((s) => s.speaker));
    if (speakerSet.size < participants.length) {
      const silent = participants.filter((p) => !speakerSet.has(p));
      if (silent.length > 0) {
        insights.push({
          meeting_id: meetingId,
          type: 'participation',
          title: 'Some participants did not speak',
          description: `${silent.join(', ')} did not contribute to the recorded discussion. Consider inviting them to share input in future meetings.`,
          severity: 'info',
        });
      }
    }
  }

  return {
    summary: {
      quick_summary: quickSummary,
      detailed_summary: detailedSummary,
      highlights,
      key_points: keyPoints,
      minutes,
    },
    actionItems,
    decisions: decisionSentences.map((text) => ({ meeting_id: meetingId, text, context: '' })),
    topics,
    sentiment: {
      meeting_id: meetingId,
      overall,
      positive_pct: Math.round((positiveCount / total) * 100),
      neutral_pct: Math.round((neutralCount / total) * 100),
      negative_pct: Math.round((negativeCount / total) * 100),
      per_segment: perSegment,
    },
    insights,
  };
}

function decisionsFromSentences(sentences: string[]): string[] {
  return sentences.filter((s) => DECISION_PATTERNS.some((p) => p.test(s))).slice(0, 10);
}

function actionItemsFromSentences(
  sentences: string[],
  participants: string[],
  meetingId: string
): Omit<ActionItem, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] {
  const items: Omit<ActionItem, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] = [];
  const seen = new Set<string>();

  for (const sentence of sentences) {
    if (!isActionSentence(sentence)) continue;
    const clean = sentence.trim();
    if (seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());

    const deadline = detectDeadline(sentence);
    const priority = detectPriority(sentence);
    const owner = detectOwner(sentence, participants);

    items.push({
      meeting_id: meetingId,
      description: clean,
      owner,
      deadline,
      priority,
      status: 'pending',
      context: '',
      ai_generated: true,
      source_speaker: null,
    });
  }

  return items.slice(0, 15);
}

function extractTopics(text: string): { title: string; discussion: string }[] {
  const lower = text.toLowerCase();
  const topicKeywords: Record<string, string[]> = {
    'API Development': ['api', 'endpoint', 'rest', 'graphql', 'backend'],
    'UI/UX Design': ['ui', 'ux', 'design', 'interface', 'wireframe', 'prototype'],
    'Authentication': ['login', 'auth', 'authentication', 'password', 'session', 'jwt'],
    'Database': ['database', 'schema', 'migration', 'query', 'table', 'sql'],
    'Testing': ['test', 'testing', 'qa', 'unit test', 'integration test', 'bug'],
    'Deployment': ['deploy', 'deployment', 'ci/cd', 'pipeline', 'release', 'production'],
    'Payment Integration': ['payment', 'stripe', 'checkout', 'billing', 'transaction'],
    'Performance': ['performance', 'optimization', 'speed', 'latency', 'cache'],
    'Security': ['security', 'vulnerability', 'encryption', 'secure'],
    'Project Planning': ['sprint', 'milestone', 'roadmap', 'timeline', 'deadline'],
  };

  const found: { title: string; discussion: string }[] = [];
  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      const sentences = splitSentences(text);
      const relevant = sentences.filter((s) =>
        keywords.some((kw) => s.toLowerCase().includes(kw))
      ).slice(0, 2).join(' ');
      found.push({ title: topic, discussion: relevant || 'Discussed during the meeting.' });
    }
  }

  if (found.length === 0) {
    found.push({ title: 'General Discussion', discussion: 'Various topics were covered during the meeting.' });
  }

  return found;
}

// Speaker analytics
export function computeSpeakerStats(segments: TranscriptSegment[]) {
  const speakerMap: Record<string, { words: number; segments: number; duration: number }> = {};
  let totalWords = 0;
  let totalDuration = 0;

  for (const seg of segments) {
    if (!speakerMap[seg.speaker]) {
      speakerMap[seg.speaker] = { words: 0, segments: 0, duration: 0 };
    }
    const wordCount = seg.text.split(/\s+/).length;
    speakerMap[seg.speaker].words += wordCount;
    speakerMap[seg.speaker].segments += 1;
    speakerMap[seg.speaker].duration += (seg.end - seg.start) || 0;
    totalWords += wordCount;
    totalDuration += (seg.end - seg.start) || 0;
  }

  return Object.entries(speakerMap)
    .map(([speaker, stats]) => ({
      speaker,
      words: stats.words,
      segments: stats.segments,
      duration: stats.duration,
      participationPct: totalWords > 0 ? Math.round((stats.words / totalWords) * 100) : 0,
      durationPct: totalDuration > 0 ? Math.round((stats.duration / totalDuration) * 100) : 0,
    }))
    .sort((a, b) => b.words - a.words);
}

// Deadline risk prediction
export function predictDeadlineRisk(item: {
  deadline: string | null;
  status: string;
  priority: string;
  created_at: string;
}): { risk: 'low' | 'medium' | 'high'; explanation: string } {
  if (item.status === 'completed') {
    return { risk: 'low', explanation: 'Task is already completed.' };
  }

  if (!item.deadline) {
    if (item.priority === 'critical' || item.priority === 'high') {
      return { risk: 'medium', explanation: 'High-priority task with no deadline. A target date should be set.' };
    }
    return { risk: 'low', explanation: 'No deadline set. Risk is low unless priority increases.' };
  }

  const days = Math.round((new Date(item.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  if (days < 0) {
    return { risk: 'high', explanation: `Task is ${Math.abs(days)} day(s) past its deadline and still ${item.status}.` };
  }

  const ageDays = Math.round((Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60 * 24));

  if (days <= 1) {
    return { risk: 'high', explanation: `Deadline is within ${days === 0 ? 'today' : '1 day'} and the task is still ${item.status}.` };
  }
  if (days <= 3 && (item.priority === 'high' || item.priority === 'critical')) {
    return { risk: 'high', explanation: `High-priority task due in ${days} days with status "${item.status}".` };
  }
  if (days <= 3) {
    return { risk: 'medium', explanation: `Task due in ${days} days, currently ${item.status}.` };
  }
  if (ageDays > 14 && item.status === 'pending') {
    return { risk: 'medium', explanation: `Task has been pending for ${ageDays} days. May need attention.` };
  }
  return { risk: 'low', explanation: `Task has ${days} days remaining and is ${item.status}.` };
}

// Recurring blocker detection
export function detectRecurringBlockers(
  meetings: { id: string; title: string; meeting_date: string; transcript_text: string }[]
): { blocker: string; occurrences: number; meetings: { id: string; title: string; date: string }[] }[] {
  const blockerKeywords = ['blocked', 'blocker', 'stuck', 'pending', 'issue', 'problem', 'not working', 'waiting on', 'delayed', 'can\'t proceed'];
  const blockerPhrases: Record<string, { count: number; meetings: { id: string; title: string; date: string }[] }> = {};

  for (const meeting of meetings) {
    const sentences = splitSentences(meeting.transcript_text);
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      if (!blockerKeywords.some((kw) => lower.includes(kw))) continue;
      // Extract key phrase — first 5-6 words
      const words = sentence.split(/\s+/).slice(0, 6).join(' ');
      const key = words.length > 20 ? words.substring(0, 40) : words;
      if (!blockerPhrases[key]) {
        blockerPhrases[key] = { count: 0, meetings: [] };
      }
      const exists = blockerPhrases[key].meetings.some((m) => m.id === meeting.id);
      if (!exists) {
        blockerPhrases[key].count += 1;
        blockerPhrases[key].meetings.push({ id: meeting.id, title: meeting.title, date: meeting.meeting_date });
      }
    }
  }

  return Object.entries(blockerPhrases)
    .filter(([, info]) => info.count >= 2)
    .map(([blocker, info]) => ({ blocker, occurrences: info.count, meetings: info.meetings }))
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 10);
}

// Simple text-based semantic search for RAG
export function semanticSearch(
  query: string,
  meetings: { id: string; title: string; meeting_date: string; transcript_text: string; participants: string[] }[]
): { meetingId: string; meetingTitle: string; meetingDate: string; snippet: string; score: number }[] {
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const stopWords = new Set(['the', 'and', 'for', 'are', 'was', 'were', 'what', 'when', 'which', 'who', 'did', 'about', 'how', 'that', 'this', 'with', 'from', 'have', 'has', 'been', 'they', 'them', 'their', 'there', 'here', 'were', 'will', 'would', 'could', 'should', 'been', 'discuss', 'discussed', 'meeting']);

  const results: { meetingId: string; meetingTitle: string; meetingDate: string; snippet: string; score: number }[] = [];

  for (const meeting of meetings) {
    const text = meeting.transcript_text.toLowerCase();
    let score = 0;
    const matchedTerms: string[] = [];

    for (const term of queryTerms) {
      if (stopWords.has(term)) continue;
      if (text.includes(term)) {
        score += 1;
        matchedTerms.push(term);
      }
      // Partial match bonus
      if (text.includes(term.substring(0, Math.min(4, term.length)))) {
        score += 0.5;
      }
    }

    // Title match bonus
    const titleLower = meeting.title.toLowerCase();
    for (const term of queryTerms) {
      if (titleLower.includes(term)) score += 2;
    }

    if (score === 0) continue;

    // Extract best snippet
    const sentences = splitSentences(meeting.transcript_text);
    let bestSnippet = '';
    let bestSnippetScore = 0;
    for (const sentence of sentences) {
      const sentLower = sentence.toLowerCase();
      let sScore = 0;
      for (const term of matchedTerms) {
        if (sentLower.includes(term)) sScore += 1;
      }
      if (sScore > bestSnippetScore) {
        bestSnippetScore = sScore;
        bestSnippet = sentence;
      }
    }
    if (!bestSnippet && sentences.length > 0) bestSnippet = sentences[0];

    results.push({
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      meetingDate: meeting.meeting_date,
      snippet: bestSnippet,
      score,
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 5);
}

// Generate RAG answer from search results
export function generateRagAnswer(query: string, results: { meetingId: string; meetingTitle: string; meetingDate: string; snippet: string }[]): string {
  if (results.length === 0) {
    return "I couldn't find any meeting transcripts related to your question. Try rephrasing your query or ensure meetings have been transcribed.";
  }

  const topResults = results.slice(0, 3);
  let answer = `Based on ${topResults.length} relevant meeting${topResults.length > 1 ? 's' : ''}, here's what I found:\n\n`;

  for (const result of topResults) {
    answer += `**${result.meetingTitle}** (${result.meetingDate})\n`;
    answer += `"${result.snippet}"\n\n`;
  }

  // Simple synthesis
  const queryLower = query.toLowerCase();
  if (queryLower.includes('who') && queryLower.includes('assign')) {
    answer += 'Based on the transcripts, the relevant action items and assignments are referenced above. Check the Action Items page for full details.';
  } else if (queryLower.includes('decide') || queryLower.includes('decision')) {
    answer += 'The key decisions from these meetings are summarized above. Visit the meeting detail pages to see the full list of decisions.';
  } else if (queryLower.includes('when')) {
    answer += 'The relevant discussions and their dates are listed above for reference.';
  } else {
    answer += 'The most relevant discussion points from these meetings are summarized above.';
  }

  return answer;
}

// Generate AI chat response
export function generateChatResponse(
  query: string,
  context: {
    pendingTasks: ActionItem[];
    recentMeetings: { id: string; title: string; meeting_date: string }[];
    meetings: { id: string; title: string; meeting_date: string; transcript_text: string }[];
  }
): { response: string; sources: { meeting_id: string; meeting_title: string; snippet: string }[] } {
  const lower = query.toLowerCase();
  const sources: { meeting_id: string; meeting_title: string; snippet: string }[] = [];

  // Pending tasks query
  if (lower.includes('pending') && (lower.includes('task') || lower.includes('action'))) {
    const pending = context.pendingTasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');
    if (pending.length === 0) {
      return { response: 'You have no pending tasks right now. Great job staying on top of things!', sources: [] };
    }
    let response = `You have ${pending.length} pending task(s):\n\n`;
    pending.slice(0, 8).forEach((task, i) => {
      response += `${i + 1}. **${task.description}**\n   Owner: ${task.owner} | Priority: ${task.priority} | Deadline: ${task.deadline || 'Not set'}\n`;
    });
    return { response, sources: [] };
  }

  // Decisions query
  if (lower.includes('decision')) {
    const searchResults = semanticSearch(query, context.meetings);
    if (searchResults.length > 0) {
      let response = 'Here are the meetings where decisions were discussed:\n\n';
      searchResults.slice(0, 3).forEach((r) => {
        response += `**${r.meetingTitle}** (${r.meetingDate})\n"${r.snippet}"\n\n`;
        sources.push({ meeting_id: r.meetingId, meeting_title: r.meetingTitle, snippet: r.snippet });
      });
      return { response, sources };
    }
    return { response: 'I couldn\'t find specific decision discussions. Try searching for a specific topic.', sources: [] };
  }

  // Summary query
  if (lower.includes('summar') || lower.includes('yesterday') || lower.includes('last meeting')) {
    if (context.recentMeetings.length === 0) {
      return { response: 'No recent meetings found to summarize.', sources: [] };
    }
    const recent = context.recentMeetings[0];
    const meetingData = context.meetings.find((m) => m.id === recent.id);
    if (meetingData) {
      const sentences = splitSentences(meetingData.transcript_text);
      const summary = sentences.slice(0, 5).join(' ');
      sources.push({ meeting_id: recent.id, meeting_title: recent.title, snippet: summary });
      return {
        response: `**${recent.title}** (${recent.meeting_date})\n\n${summary}\n\nThis meeting covered the key discussion points listed above.`,
        sources,
      };
    }
  }

  // Default — semantic search
  const searchResults = semanticSearch(query, context.meetings);
  if (searchResults.length > 0) {
    let response = `Here's what I found related to your question:\n\n`;
    searchResults.slice(0, 3).forEach((r) => {
      response += `**${r.meetingTitle}** (${r.meetingDate})\n"${r.snippet}"\n\n`;
      sources.push({ meeting_id: r.meetingId, meeting_title: r.meetingTitle, snippet: r.snippet });
    });
    response += 'Check the meeting detail pages for more comprehensive information.';
    return { response, sources };
  }

  return { response: 'I couldn\'t find relevant information. Try asking about specific tasks, meetings, or topics.', sources: [] };
}
