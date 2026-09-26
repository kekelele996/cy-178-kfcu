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

  const submit = async () => {
    setError('');
    const content = reply.trim();
    if (!content) return;
    if (mode === 'farewell' && !window.confirm(LABELS.FAREWELL_CONFIRM)) return;
    setSubmitting(true);
    try {
      if (mode === 'farewell') {
        await LetterApi.farewell({ id, content });
      } else {
        await LetterApi.reply({ id, content });
      }
      setReply('');
      setMode('reply');
      await load();
    } catch (err) {
      // A farewell or reply raced with us — the thread is sealed now, refresh it
      if (err.status === 409) {
        setReply('');
        setMode('reply');
        await load();
      }
      setError(err.message);
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

  const sealed = data.sealed;
  const farewellMode = mode === 'farewell';

  return (
    <div className={`thread-wrap ${sealed ? 'sealed' : ''}`}>
      <div className="thread-head">
        <h2>
          对话链 #{id}
          {sealed && <span className="badge sealed">{LABELS.SEALED}</span>}
        </h2>
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
            className={`msg-bubble ${m.fromMe ? 'me' : 'them'} ${m.farewell ? 'farewell' : ''}`}
          >
            {m.farewell && <div className="msg-tag">✉ {LABELS.FAREWELL_TAG}</div>}
            <div>{m.content}</div>
            <div className="msg-time">{formatTime(m.createdAt)}</div>
          </div>
        ))}
      </div>

      {sealed ? (
        <div className="sealed-banner">🔒 {LABELS.SEALED_BANNER}</div>
      ) : (
        <div className="reply-box">
          <textarea
            className="reply-text"
            placeholder={farewellMode ? LABELS.FAREWELL_PLACEHOLDER : LABELS.REPLY_PLACEHOLDER}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            maxLength={2000}
          />
          <div className="reply-footer">
            <div className="error-text" style={{ margin: 'auto 0' }}>{error}</div>
            {!farewellMode && (
              <button
                className="secondary-btn"
                onClick={() => { setMode('farewell'); setError(''); }}
                disabled={submitting}
              >
                {LABELS.FAREWELL}
              </button>
            )}
            {farewellMode && (
              <button
                className="secondary-btn"
                onClick={() => { setMode('reply'); setError(''); }}
                disabled={submitting}
              >
                {LABELS.BACK}
              </button>
            )}
            <button
              className={`big-btn ${farewellMode ? 'farewell-btn' : ''}`}
              onClick={submit}
              disabled={submitting || !reply.trim()}
            >
              {submitting
                ? '寄出中…'
                : farewellMode
                  ? LABELS.SUBMIT_FAREWELL
                  : LABELS.SUBMIT_REPLY}
            </button>
          </div>
        </div>
      )}
      {sealed && error && <div className="error-text">{error}</div>}
    </div>
  );
}
