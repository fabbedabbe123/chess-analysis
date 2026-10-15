import { useEffect } from 'react';
import { dismissNotice, useGame } from '@/stores/gameStore';
import { dismissConfirm, useUi } from '@/stores/uiStore';
import { Modal } from './Modal';

export function Notices() {
  const notice = useGame((s) => s.notice);
  const confirm = useUi((s) => s.confirm);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(dismissNotice, notice.kind === 'info' ? 4000 : 9000);
    return () => clearTimeout(t);
  }, [notice]);
  return (
    <>
      {notice && (
        <div className={`toast toast-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <span>{notice.text}</span>
          <button className="btn small" onClick={dismissNotice} aria-label="Dismiss">✕</button>
        </div>
      )}
      {confirm && (
        <Modal title="Are you sure?" onClose={dismissConfirm}>
          <p>{confirm.message}</p>
          <div className="row">
            <button className="btn danger" onClick={() => { const fn = confirm.onConfirm; dismissConfirm(); fn(); }}>{confirm.confirmLabel}</button>
            <button className="btn" onClick={dismissConfirm}>Cancel</button>
          </div>
        </Modal>
      )}
    </>
  );
}
