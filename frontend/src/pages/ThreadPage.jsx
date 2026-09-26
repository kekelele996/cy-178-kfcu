import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LABELS } from '../config/constants.js';
import { LetterApi } from '../services/letterApi.js';

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ThreadPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [mode, setMode] = useState('reply'); // 'reply' | 'farewell'
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const thread = await LetterApi.thread(id);
      setData(thread);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleConflict = (err) => {
    // A farewell or reply raced with the other side: refresh to reflect
    // whatever was committed first.
    setError(err.message || LABELS.SEALED_BANNER);
    load();
  };

  const submitReply = async () => {
    setError('');
    if (!reply.trim()) return;
    setSubmitting(true);
    try {
      await LetterApi.reply({ id, content: reply.trim() });
      setReply('');
      load();
    } catch (err) {
      if (err.status === 409) handleConflict(err);
      else setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const submitFarewell = async () => {
    setError('');
    if (!reply.trim()) return;
    if (!window.confirm(LABELS.FAREWELL_CONFIRM)) return;
    setSubmitting(true);
    try {
      await LetterApi.farewell({ id, content: reply.trim() });
      setReply('');
      setMode('reply');
      load();
    } catch (err) {
      if (err.status === 409) handleConflict(err);
      else setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleFavorite = async () => {
    try {
      await LetterApi.toggleFavorite(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="loading">加载对话中…</div>;
  if (!data) return <div className="empty-state">{error || '无法加载对话'}</div>;

  return (
    <div className="thread-wrap">
      <div className="thread-head">
        <h2>对话链 #{id}</h2>
        <div>
          <button
            className={`icon-btn ${data.favorited ? 'on' : ''}`}
            onClick={toggleFavorite}
          >
            {data.favorited ? `★ ${LABELS.UNFAVORITE}` : `☆ ${LABELS.FAVORITE}`}
          </button>
          <button
            className="icon-btn"
            style={{ marginLeft: 8 }}
            onClick={() => navigate(-1)}
          >
            {LABELS.BACK}
          </button>
        </div>
      </div>

      <div className="message-list">
        {data.messages.map((m) => (
          <div
            key={m.id}
            className={`msg-bubble ${m.fromMe ? 'me' : 'them'} ${m.kind === 'farewell' ? 'farewell' : ''}`}
          >
            {m.kind === 'farewell' && <div className="farewell-tag">✦ {LABELS.FAREWELL_TAG}</div>}
            <div>{m.content}</div>
            <div className="msg-time">{formatTime(m.createdAt)}</div>
          </div>
        ))}
      </div>

      {data.sealed ? (
        <div className="sealed-box">
          <div className="sealed-title">🔒 {LABELS.SEALED_BADGE}</div>
          <div className="sealed-text">
            {data.sealedByMe ? LABELS.SEALED_BY_ME : LABELS.SEALED_BANNER}
          </div>
        </div>
      ) : mode === 'farewell' ? (
        <div className="reply-box farewell-box">
          <div className="farewell-hint">✦ {LABELS.FAREWELL_HINT}</div>
          <textarea
            className="reply-text"
            placeholder={LABELS.REPLY_PLACEHOLDER}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            maxLength={2000}
            autoFocus
          />
          <div className="reply-footer">
            <div className="error-text" style={{ margin: 'auto 0' }}>{error}</div>
            <div>
              <button
                className="icon-btn"
                style={{ marginRight: 10 }}
                onClick={() => { setMode('reply'); setError(''); }}
                disabled={submitting}
              >
                {LABELS.BACK}
              </button>
              <button
                className="big-btn farewell-btn"
                onClick={submitFarewell}
                disabled={submitting || !reply.trim()}
              >
                {submitting ? '封存中…' : LABELS.SUBMIT_FAREWELL}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="reply-box">
          <textarea
            className="reply-text"
            placeholder={LABELS.REPLY_PLACEHOLDER}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            maxLength={2000}
          />
          <div className="reply-footer">
            <div className="error-text" style={{ margin: 'auto 0' }}>{error}</div>
            <div>
              <button
                className="icon-btn farewell-trigger"
                style={{ marginRight: 10 }}
                onClick={() => { setMode('farewell'); setError(''); }}
                disabled={submitting}
              >
                ✦ {LABELS.SEND_FAREWELL}
              </button>
              <button
                className="big-btn"
                onClick={submitReply}
                disabled={submitting || !reply.trim()}
              >
                {submitting ? '寄出中…' : LABELS.SUBMIT_REPLY}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
