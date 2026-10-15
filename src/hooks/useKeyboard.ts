import { useEffect } from 'react';
import { goBack, goEnd, goForward, goStart, redo, undo } from '@/stores/gameStore';
import { flipBoard } from '@/stores/puzzleStore';
import { uiStore } from '@/stores/uiStore';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Global shortcuts: arrows navigate, Home/End jump, F flips, Ctrl+Z / Ctrl+Shift+Z undo / redo. */
export function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || uiStore.get().dialog !== null) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod || e.altKey) return;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          goBack();
          break;
        case 'ArrowRight':
          e.preventDefault();
          goForward();
          break;
        case 'Home':
          e.preventDefault();
          goStart();
          break;
        case 'End':
          e.preventDefault();
          goEnd();
          break;
        case 'f':
        case 'F':
          flipBoard();
          break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
