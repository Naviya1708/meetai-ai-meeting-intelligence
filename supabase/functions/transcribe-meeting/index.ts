import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

interface TranscriptSegment {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

interface AiAnalysis {
  summary: {
    quick_summary: string;
    detailed_summary: string;
    highlights: string[];
    key_points: string[];
    minutes: string;
  };
  action_items: Array<{
    description: string;
    owner: string;
    deadline: string;
    priority: "low" | "medium" | "high" | "critical";
    context: string;
    source_speaker: string;
  }>;
  decisions: Array<{ text: string; context: string }>;
  topics: Array<{ title: string; discussion: string; type: "topic" | "subtopic" | "discussion" | "decision" }>;
  sentiment: {
    overall: "positive" | "neutral" | "negative";
    positive_pct: number;
    neutral_pct: number;
    negative_pct: number;
    per_segment: Array<{ text: string; sentiment: "positive" | "neutral" | "negative" }>;
  };
  insights: Array<{
    type: string;
    title: string;
    description: string;
    severity: "info" | "warning" | "critical";
  }>;
}

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "action_items", "decisions", "topics", "sentiment", "insights"],
  properties: {
    summary: {
      type: "object",
      additionalProperties: false,
      required: ["quick_summary", "detailed_summary", "highlights", "key_points", "minutes"],
      properties: {
        quick_summary: { type: "string" },
        detailed_summary: { type: "string" },
        highlights: { type: "array", items: { type: "string" } },
        key_points: { type: "array", items: { type: "string" } },
        minutes: { type: "string" },
      },
    },
    action_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "owner", "deadline", "priority", "context", "source_speaker"],
        properties: {
          description: { type: "string" },
          owner: { type: "string" },
          deadline: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
          context: { type: "string" },
          source_speaker: { type: "string" },
        },
      },
    },
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "context"],
        properties: { text: { type: "string" }, context: { type: "string" } },
      },
    },
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "discussion", "type"],
        properties: {
          title: { type: "string" },
          discussion: { type: "string" },
          type: { type: "string", enum: ["topic", "subtopic", "discussion", "decision"] },
        },
      },
    },
    sentiment: {
      type: "object",
      additionalProperties: false,
      required: ["overall", "positive_pct", "neutral_pct", "negative_pct", "per_segment"],
      properties: {
        overall: { type: "string", enum: ["positive", "neutral", "negative"] },
        positive_pct: { type: "number" },
        neutral_pct: { type: "number" },
        negative_pct: { type: "number" },
        per_segment: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text", "sentiment"],
            properties: {
              text: { type: "string" },
              sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
            },
          },
        },
      },
    },
    insights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "title", "description", "severity"],
        properties: {
          type: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          severity: { type: "string", enum: ["info", "warning", "critical"] },
        },
      },
    },
  },
};

function clampPercentages(sentiment: AiAnalysis["sentiment"]) {
  const values = [sentiment.positive_pct, sentiment.neutral_pct, sentiment.negative_pct]
    .map((value) => Math.max(0, Number(value) || 0));
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  return {
    positive_pct: Math.round((values[0] / total) * 100),
    neutral_pct: Math.round((values[1] / total) * 100),
    negative_pct: Math.round((values[2] / total) * 100),
  };
}

async function analyzeTranscriptWithOpenAI(
  openAiKey: string,
  meeting: { title: string; participants: string[]; duration_minutes: number },
  segments: TranscriptSegment[],
): Promise<AiAnalysis> {
  const transcriptForModel = segments
    .map((segment) => `[${segment.start.toFixed(2)}-${segment.end.toFixed(2)}] ${segment.speaker}: ${segment.text}`)
    .join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.1,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "meeting_analysis",
          strict: true,
          schema: analysisSchema,
        },
      },
      messages: [
        {
          role: "system",
          content: [
            "You analyze real meeting transcripts for a meeting-management application.",
            "Use ONLY information supported by the supplied transcript. Do not invent facts, tasks, owners, deadlines, decisions, topics, or insights.",
            "Action items must be genuine commitments or clearly requested tasks. If an owner or deadline is not stated, use Unassigned or an empty deadline.",
            "Deadlines must be returned as YYYY-MM-DD when the transcript gives a date that can be resolved from the meeting date; otherwise return an empty string.",
            "Summaries, decisions, topics, sentiment, and insights must reflect the actual meeting content.",
            "Keep the output concise enough for a meeting detail page.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Meeting title: ${meeting.title}`,
            `Meeting participants: ${(meeting.participants || []).join(", ") || "Not provided"}`,
            `Planned duration: ${meeting.duration_minutes || 0} minutes`,
            "",
            "TRANSCRIPT:",
            transcriptForModel,
          ].join("\n"),
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("OpenAI meeting analysis error", detail);
    throw new Error("AI analysis could not process the generated transcript.");
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI analysis returned no result.");

  let parsed: AiAnalysis;
  try {
    parsed = JSON.parse(content) as AiAnalysis;
  } catch (error) {
    console.error("AI analysis JSON parse error", error, content);
    throw new Error("AI analysis returned an invalid result.");
  }

  const percentages = clampPercentages(parsed.sentiment);
  parsed.sentiment = {
    ...parsed.sentiment,
    ...percentages,
    per_segment: Array.isArray(parsed.sentiment.per_segment) ? parsed.sentiment.per_segment : [],
  };

  return parsed;
}

async function saveTranscript(
  adminClient: ReturnType<typeof createClient>,
  meetingId: string,
  fullText: string,
  segments: TranscriptSegment[],
  language: string,
) {
  const { data: existing, error: existingError } = await adminClient
    .from("transcripts")
    .select("id")
    .eq("meeting_id", meetingId)
    .maybeSingle();
  if (existingError) throw existingError;

  const values = { full_text: fullText, segments, language };
  if (existing) {
    const { error } = await adminClient.from("transcripts").update(values).eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await adminClient.from("transcripts").insert({ meeting_id: meetingId, ...values });
    if (error) throw error;
  }
}

async function saveAnalysis(
  adminClient: ReturnType<typeof createClient>,
  meetingId: string,
  userId: string,
  analysis: AiAnalysis,
) {
  const { data: existingSummary, error: summaryLookupError } = await adminClient
    .from("summaries")
    .select("id")
    .eq("meeting_id", meetingId)
    .maybeSingle();
  if (summaryLookupError) throw summaryLookupError;

  if (existingSummary) {
    const { error } = await adminClient.from("summaries").update(analysis.summary).eq("id", existingSummary.id);
    if (error) throw error;
  } else {
    const { error } = await adminClient.from("summaries").insert({ meeting_id: meetingId, ...analysis.summary });
    if (error) throw error;
  }

  await adminClient.from("decisions").delete().eq("meeting_id", meetingId);
  if (analysis.decisions.length) {
    const { error } = await adminClient.from("decisions").insert(
      analysis.decisions.map((decision) => ({ meeting_id: meetingId, ...decision })),
    );
    if (error) throw error;
  }

  await adminClient.from("topics").delete().eq("meeting_id", meetingId);
  if (analysis.topics.length) {
    const { error } = await adminClient.from("topics").insert(
      analysis.topics.map((topic) => ({ meeting_id: meetingId, ...topic })),
    );
    if (error) throw error;
  }

  await adminClient.from("action_items").delete().eq("meeting_id", meetingId).eq("ai_generated", true);
  if (analysis.action_items.length) {
    const { error } = await adminClient.from("action_items").insert(
      analysis.action_items.map((item) => ({
        meeting_id: meetingId,
        user_id: userId,
        description: item.description,
        owner: item.owner || "Unassigned",
        deadline: item.deadline || null,
        priority: item.priority,
        status: "pending",
        context: item.context || "",
        ai_generated: true,
        source_speaker: item.source_speaker || null,
      })),
    );
    if (error) throw error;
  }

  const { data: existingSentiment, error: sentimentLookupError } = await adminClient
    .from("sentiment_analysis")
    .select("id")
    .eq("meeting_id", meetingId)
    .maybeSingle();
  if (sentimentLookupError) throw sentimentLookupError;

  const sentimentValues = {
    overall: analysis.sentiment.overall,
    positive_pct: analysis.sentiment.positive_pct,
    neutral_pct: analysis.sentiment.neutral_pct,
    negative_pct: analysis.sentiment.negative_pct,
    per_segment: analysis.sentiment.per_segment,
  };
  if (existingSentiment) {
    const { error } = await adminClient.from("sentiment_analysis").update(sentimentValues).eq("id", existingSentiment.id);
    if (error) throw error;
  } else {
    const { error } = await adminClient.from("sentiment_analysis").insert({ meeting_id: meetingId, ...sentimentValues });
    if (error) throw error;
  }

  await adminClient.from("ai_insights").delete().eq("meeting_id", meetingId);
  if (analysis.insights.length) {
    const { error } = await adminClient.from("ai_insights").insert(
      analysis.insights.map((insight) => ({ meeting_id: meetingId, user_id: userId, ...insight })),
    );
    if (error) throw error;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: jsonHeaders });
    }

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openAiKey = Deno.env.get("OPENAI_API_KEY");

    if (!authHeader || !supabaseUrl || !anonKey || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Authentication is required." }), { status: 401, headers: jsonHeaders });
    }
    if (!openAiKey) {
      return new Response(JSON.stringify({ error: "This Supabase function is deprecated for this project. Use the local Python transcription service instead: http://localhost:8000/api/transcribe/local. No paid API key is required in local mode." }), { status: 503, headers: jsonHeaders });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Your session is invalid or expired." }), { status: 401, headers: jsonHeaders });
    }

    const body = await req.json() as { meetingId?: string; storagePath?: string; fileName?: string; mimeType?: string };
    if (!body.meetingId || !body.storagePath || !body.fileName) {
      return new Response(JSON.stringify({ error: "meetingId, storagePath, and fileName are required." }), { status: 400, headers: jsonHeaders });
    }
    if (!body.storagePath.startsWith(`${user.id}/`)) {
      return new Response(JSON.stringify({ error: "You can only process your own recording." }), { status: 403, headers: jsonHeaders });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: meeting, error: meetingError } = await adminClient
      .from("meetings")
      .select("id, user_id, title, participants, duration_minutes")
      .eq("id", body.meetingId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (meetingError || !meeting) {
      return new Response(JSON.stringify({ error: "Meeting not found." }), { status: 404, headers: jsonHeaders });
    }

    const { data: file, error: downloadError } = await adminClient.storage
      .from("meeting-recordings")
      .download(body.storagePath);
    if (downloadError || !file) {
      return new Response(JSON.stringify({ error: "The uploaded recording could not be read." }), { status: 422, headers: jsonHeaders });
    }

    const formData = new FormData();
    const fileType = body.mimeType || file.type || "application/octet-stream";
    formData.append("file", new File([file], body.fileName, { type: fileType }));
    formData.append("model", "whisper-1");
    formData.append("response_format", "verbose_json");
    formData.append("timestamp_granularities[]", "segment");

    const transcriptionResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey}` },
      body: formData,
    });

    if (!transcriptionResponse.ok) {
      const detail = await transcriptionResponse.text();
      console.error("Speech-to-text provider error", detail);
      return new Response(JSON.stringify({ error: "Speech-to-text could not process this recording." }), { status: 502, headers: jsonHeaders });
    }

    const transcription = await transcriptionResponse.json() as {
      text?: string;
      language?: string;
      segments?: { id?: number; start?: number; end?: number; text?: string }[];
    };
    if (!transcription.text?.trim()) {
      return new Response(JSON.stringify({ error: "No speech was detected in this recording." }), { status: 422, headers: jsonHeaders });
    }

    const segments: TranscriptSegment[] = (transcription.segments || []).map((segment, index) => ({
      speaker: "Speaker",
      text: segment.text?.trim() || "",
      start: Number(segment.start || index * 10),
      end: Number(segment.end || (index + 1) * 10),
    })).filter((segment) => segment.text.length > 0);

    try {
      await saveTranscript(adminClient, meeting.id, transcription.text.trim(), segments, transcription.language || "en");
    } catch (error) {
      console.error("Transcript save error", error);
      return new Response(JSON.stringify({ error: "The transcript was generated but could not be saved." }), { status: 500, headers: jsonHeaders });
    }

    let analysis: AiAnalysis;
    try {
      analysis = await analyzeTranscriptWithOpenAI(openAiKey, {
        title: meeting.title,
        participants: meeting.participants || [],
        duration_minutes: meeting.duration_minutes || 60,
      }, segments);
      await saveAnalysis(adminClient, meeting.id, user.id, analysis);
    } catch (error) {
      console.error("Meeting analysis error", error);
      return new Response(JSON.stringify({ error: "The transcript was saved, but AI analysis could not be completed. Please try the analysis again." }), { status: 502, headers: jsonHeaders });
    }

    const { error: meetingUpdateError } = await adminClient.from("meetings").update({
      recording_url: body.storagePath,
      status: "completed",
      updated_at: new Date().toISOString(),
    }).eq("id", meeting.id).eq("user_id", user.id);
    if (meetingUpdateError) {
      console.error("Meeting update error", meetingUpdateError);
      return new Response(JSON.stringify({ error: "The transcript and analysis were saved, but the meeting could not be updated." }), { status: 500, headers: jsonHeaders });
    }

    return new Response(JSON.stringify({
      meetingId: meeting.id,
      transcript: {
        full_text: transcription.text.trim(),
        segments,
        language: transcription.language || "en",
      },
      analysis,
    }), { status: 200, headers: jsonHeaders });
  } catch (error) {
    console.error("Transcription function error", error);
    return new Response(JSON.stringify({ error: "Unexpected transcription error. Please try again." }), { status: 500, headers: jsonHeaders });
  }
});
