import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { PageLoader, EmptyState, ErrorState, Spinner } from '@/components/ui/States';
import { formatDate, statusColor, formatStatus, generateMeetingId } from '@/lib/utils';
import { uploadRecordingAndGetTranscript, validateRecordingFile, type ProcessingState } from '@/lib/services';
import type { Meeting } from '@/types';
import {
  CalendarDays, Plus, Search, Trash2, Edit, FileText,
  Clock, Users, ArrowRight, Filter, ChevronDown, Upload, AlertCircle, CheckCircle2, Sparkles
} from 'lucide-react';

export function MeetingsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'date' | 'title' | 'duration'>('date');
  const [createOpen, setCreateOpen] = useState(false);
  const [editMeeting, setEditMeeting] = useState<Meeting | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  useEffect(() => { loadMeetings(); }, []);

  const loadMeetings = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('meetings')
        .select('*')
        .order('meeting_date', { ascending: false });
      if (error) throw error;
      setMeetings((data || []) as Meeting[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load meetings');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const { error } = await supabase.from('meetings').delete().eq('id', deleteId);
      if (error) throw error;
      setMeetings((prev) => prev.filter((m) => m.id !== deleteId));
      toast('Meeting deleted', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to delete meeting', 'error');
    } finally {
      setDeleteId(null);
    }
  };

  const filtered = meetings
    .filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (search && !m.title.toLowerCase().includes(search.toLowerCase()) &&
        !m.description?.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      if (sortBy === 'duration') return (b.duration_minutes || 0) - (a.duration_minutes || 0);
      return new Date(b.meeting_date).getTime() - new Date(a.meeting_date).getTime();
    });

  if (loading) return <PageLoader />;
  if (error) return <ErrorState description={error} onRetry={loadMeetings} />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Meetings</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage all your meetings in one place.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-sm font-medium rounded-lg transition-colors"
          >
            <Upload className="w-4 h-4" /> Upload Recording
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> New Meeting
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search meetings..."
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="appearance-none pl-4 pr-10 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          >
            <option value="all">All Status</option>
            <option value="scheduled">Scheduled</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
        <div className="relative">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'date' | 'title' | 'duration')}
            className="appearance-none pl-4 pr-10 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          >
            <option value="date">Sort by Date</option>
            <option value="title">Sort by Title</option>
            <option value="duration">Sort by Duration</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* Meetings list */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200">
          <EmptyState
            icon={CalendarDays}
            title="No meetings found"
            description={search || statusFilter !== 'all' ? "Try adjusting your filters." : "Create your first meeting to get started."}
            action={
              <button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
                <Plus className="w-4 h-4" /> New Meeting
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((m) => (
            <div key={m.id} className="bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-md hover:border-blue-200 transition-all group">
              <div className="flex items-start justify-between mb-3">
                <span className={`text-xs px-2 py-1 rounded-full border ${statusColor(m.status)}`}>
                  {formatStatus(m.status)}
                </span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setEditMeeting(m)}
                    className="p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 rounded-lg transition-colors"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeleteId(m.id)}
                    className="p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <Link to={`/app/meetings/${m.id}`}>
                <h3 className="text-base font-semibold text-slate-800 mb-2 group-hover:text-blue-700 transition-colors">{m.title}</h3>
                <p className="text-sm text-slate-500 mb-3 line-clamp-2">{m.description || 'No description'}</p>
                <div className="space-y-1.5 text-xs text-slate-500">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="w-3.5 h-3.5" /> {formatDate(m.meeting_date)}
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5" /> {m.start_time} - {m.end_time} ({m.duration_minutes} min)
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="w-3.5 h-3.5" /> {m.participants?.length || 0} participants
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* Upload recording modal */}
      <UploadRecordingModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onCompleted={(m) => {
          setMeetings((prev) => [m, ...prev.filter((x) => x.id !== m.id)]);
          setUploadOpen(false);
          navigate(`/app/meetings/${m.id}`);
        }}
      />

      {/* Create modal */}
      <MeetingFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(m) => { setMeetings((prev) => [m, ...prev]); setCreateOpen(false); toast('Meeting created', 'success'); }}
      />

      {/* Edit modal */}
      <MeetingFormModal
        open={!!editMeeting}
        meeting={editMeeting}
        onClose={() => setEditMeeting(null)}
        onSaved={(m) => {
          setMeetings((prev) => prev.map((x) => x.id === m.id ? m : x));
          setEditMeeting(null);
          toast('Meeting updated', 'success');
        }}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete meeting?"
        message="This will permanently delete the meeting and all its associated data (transcript, summary, action items, etc.)."
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

function UploadRecordingModal({ open, onClose, onCompleted }: { open: boolean; onClose: () => void; onCompleted: (m: Meeting) => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processState, setProcessState] = useState<ProcessingState>({ stage: 'idle', message: '', progress: 0 });

  const reset = () => {
    setTitle('');
    setSelectedFile(null);
    setProcessing(false);
    setProcessState({ stage: 'idle', message: '', progress: 0 });
  };

  const handleFile = (file: File) => {
    const err = validateRecordingFile(file);
    if (err) { toast(err, 'error'); return; }
    setSelectedFile(file);
    if (!title) setTitle(file.name.replace(/\.[^/.]+$/, ''));
  };

  const startUpload = async () => {
    if (!title.trim()) { toast('Please enter a meeting title', 'error'); return; }
    if (!selectedFile) { toast('Please select a recording file', 'error'); return; }
    setProcessing(true);
    setProcessState({ stage: 'uploading', message: 'Uploading recording...', progress: 5 });
    try {
      const { data: meeting, error: createError } = await supabase
        .from('meetings')
        .insert({
          title: title.trim(),
          description: `Uploaded recording: ${selectedFile.name}`,
          meeting_date: new Date().toISOString().split('T')[0],
          start_time: new Date().toTimeString().slice(0, 5),
          end_time: new Date().toTimeString().slice(0, 5),
          duration_minutes: 60,
          participants: [],
          agenda: '',
          status: 'in_progress',
        })
        .select('*')
        .maybeSingle();
      if (createError || !meeting) throw new Error(`Failed to create meeting: ${createError?.message || 'Unknown error'}`);

      await uploadRecordingAndGetTranscript(meeting.id, selectedFile, (state) => setProcessState(state));

      const { data: finalMeeting } = await supabase
        .from('meetings')
        .select('*')
        .eq('id', meeting.id)
        .maybeSingle();
      toast('Recording uploaded and analyzed successfully!', 'success');
      onCompleted(finalMeeting as Meeting);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to process recording';
      setProcessState({ stage: 'error', message: msg, progress: 0 });
      toast(msg, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const stageSteps: { key: ProcessingState['stage']; label: string }[] = [
    { key: 'uploading', label: 'Uploading recording' },
    { key: 'uploaded', label: 'Saved to storage' },
    { key: 'transcribing', label: 'Local transcription' },
    { key: 'transcribed', label: 'Transcript ready' },
    { key: 'analyzing', label: 'Analyzing meeting' },
    { key: 'completed', label: 'Completed' },
  ];
  const stageOrder = ['idle', 'uploading', 'uploaded', 'transcribing', 'transcribed', 'analyzing', 'completed', 'error'];
  const currentIdx = stageOrder.indexOf(processState.stage);

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Upload Recorded Meeting" size="lg">
      <div className="space-y-4">
        {processState.stage === 'idle' || processState.stage === 'error' ? (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Meeting Title *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                placeholder="e.g., Weekly Team Standup Recording"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Recording File *</label>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center hover:border-blue-300 transition-colors"
              >
                <Upload className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-500 mb-2">Drag and drop a recording here, or</p>
                <p className="text-xs text-slate-500 mb-3">Free local transcription uses Faster-Whisper on your computer. No OpenAI credits are required.</p>
                <label className="inline-block">
                  <input
                    type="file"
                    accept=".mp3,.wav,.m4a,.mp4,.webm,.mov,.ogg,audio/*,video/*"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                  />
                  <span className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer">
                    Browse Files
                  </span>
                </label>
                {selectedFile && (
                  <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-left">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-600" />
                      <span className="text-sm font-medium text-blue-800 truncate">{selectedFile.name}</span>
                    </div>
                    <p className="text-xs text-blue-600 mt-1">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1.5">Supported: MP3, WAV, M4A, MP4, WEBM. Max 100 MB.</p>
            </div>
            {processState.stage === 'error' && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700">{processState.message}</p>
              </div>
            )}
            <button
              onClick={startUpload}
              disabled={processing || !title.trim() || !selectedFile}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Upload and Analyze Recording
            </button>
          </>
        ) : (
          <div className="py-6 space-y-4">
            <div className="space-y-3">
              {stageSteps.map((step) => {
                const stepIdx = stageOrder.indexOf(step.key);
                const isDone = currentIdx > stepIdx;
                const isActive = currentIdx === stepIdx;
                return (
                  <div key={step.key} className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                      isDone ? 'bg-green-100 text-green-600' :
                      isActive ? 'bg-blue-100 text-blue-600' :
                      'bg-slate-100 text-slate-400'
                    }`}>
                      {isDone ? <CheckCircle2 className="w-4 h-4" /> :
                       isActive ? <Spinner className="w-4 h-4" /> :
                       <div className="w-2 h-2 rounded-full bg-current" />}
                    </div>
                    <span className={`text-sm ${isDone || isActive ? 'text-slate-700 font-medium' : 'text-slate-400'}`}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500">{processState.message}</span>
                <span className="text-xs font-medium text-slate-600">{processState.progress}%</span>
              </div>
              <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${processState.stage === 'error' ? 'bg-red-500' : 'bg-blue-500'}`}
                  style={{ width: `${processState.stage === 'error' ? 100 : processState.progress}%` }}
                />
              </div>
            </div>
            {processState.stage === 'error' && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700">{processState.message}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function MeetingFormModal({
  open,
  onClose,
  onSaved,
  meeting,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (m: Meeting) => void;
  meeting?: Meeting | null;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    meeting_date: new Date().toISOString().split('T')[0],
    start_time: '09:00',
    end_time: '10:00',
    duration_minutes: 60,
    participants: '',
    agenda: '',
    status: 'scheduled',
  });

  useEffect(() => {
    if (meeting) {
      setForm({
        title: meeting.title,
        description: meeting.description || '',
        meeting_date: meeting.meeting_date,
        start_time: meeting.start_time || '09:00',
        end_time: meeting.end_time || '10:00',
        duration_minutes: meeting.duration_minutes || 60,
        participants: (meeting.participants || []).join(', '),
        agenda: meeting.agenda || '',
        status: meeting.status,
      });
    } else {
      setForm({
        title: '',
        description: '',
        meeting_date: new Date().toISOString().split('T')[0],
        start_time: '09:00',
        end_time: '10:00',
        duration_minutes: 60,
        participants: '',
        agenda: '',
        status: 'scheduled',
      });
    }
  }, [meeting, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast('Please enter a meeting title', 'error');
      return;
    }
    setSaving(true);
    try {
      const participants = form.participants.split(',').map((p) => p.trim()).filter(Boolean);
      const payload = {
        title: form.title,
        description: form.description,
        meeting_date: form.meeting_date,
        start_time: form.start_time,
        end_time: form.end_time,
        duration_minutes: Number(form.duration_minutes) || 60,
        participants,
        agenda: form.agenda,
        status: form.status,
      };

      if (meeting) {
        const { data, error } = await supabase
          .from('meetings')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', meeting.id)
          .select('*')
          .maybeSingle();
        if (error) throw error;
        if (data) onSaved(data as Meeting);
      } else {
        const { data, error } = await supabase
          .from('meetings')
          .insert(payload)
          .select('*')
          .maybeSingle();
        if (error) throw error;
        if (data) onSaved(data as Meeting);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to save meeting', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={meeting ? 'Edit Meeting' : 'Create Meeting'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Title *</label>
          <input
            type="text"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            placeholder="e.g., Weekly Team Standup"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
            placeholder="Brief description of the meeting"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Date *</label>
            <input
              type="date"
              required
              value={form.meeting_date}
              onChange={(e) => setForm({ ...form, meeting_date: e.target.value })}
              className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Duration (min)</label>
            <input
              type="number"
              value={form.duration_minutes}
              onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })}
              className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Start Time</label>
            <input
              type="time"
              value={form.start_time}
              onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">End Time</label>
            <input
              type="time"
              value={form.end_time}
              onChange={(e) => setForm({ ...form, end_time: e.target.value })}
              className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Participants (comma-separated)</label>
          <input
            type="text"
            value={form.participants}
            onChange={(e) => setForm({ ...form, participants: e.target.value })}
            className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            placeholder="John Doe, Jane Smith"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Agenda</label>
          <textarea
            value={form.agenda}
            onChange={(e) => setForm({ ...form, agenda: e.target.value })}
            rows={3}
            className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
            placeholder="1. Topic one&#10;2. Topic two"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Status</label>
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          >
            <option value="scheduled">Scheduled</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-60">
            {saving ? <Spinner className="w-4 h-4" /> : null}
            {meeting ? 'Save Changes' : 'Create Meeting'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
